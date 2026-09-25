import { basename } from 'node:path';

import type { Audit, AuditConfig, Finding, Severity } from '@sentinel/contracts';

import type { LlmClient, LlmInspection, SnippetInspectionRequest } from './llm.js';
import { createDefaultLlmClient, truncateText } from './llm.js';
import type { RepositoryReader } from './repo-reader.js';
import { FsRepositoryReader, sanitizeRepoUrl } from './repo-reader.js';
import { emitAuditEvent } from '../sse/hub.js';
import { findAuditById } from '../store/audits.js';

/**
 * Audit Runner seam (ASD §6.1, plan US-4 Task 4.5 / US-5 Task 5.1).
 *
 * Decouples the agent engine from HTTP: the POST controller hands the audit
 * id to a runner; the runner emits contract events through the SSE hub.
 */
export interface AuditRunner {
  /**
   * Kicks off audit execution for the given audit id. Implementations must
   * never block the HTTP response — scheduling is theirs to decide
   * (both built-in runners use `setImmediate`).
   */
  run(auditId: string): void;
}

/** Tool identifiers used in TOOL_EXECUTION events (openapi examples). */
const TOOL_SOURCE_ACQUISITION = 'git-clone';
const TOOL_LLM_ANALYZE = 'llm-analyze';

/** Health score deductions per finding severity (PoC scoring model). */
const SEVERITY_DEDUCTIONS: Readonly<Record<Severity, number>> = {
  LOW: 3,
  MEDIUM: 8,
  HIGH: 15,
  CRITICAL: 25,
};

export interface SentinelAuditRunnerOptions {
  /** LLM abstraction; defaults to the primary+Ollama fallback chain. */
  readonly llmClient?: LlmClient;
  /** Repository source reader; defaults to the fs/git implementation. */
  readonly repositoryReader?: RepositoryReader;
  /** Scheduling seam; defaults to `setImmediate` (never blocks the response). */
  readonly schedule?: (callback: () => void) => void;
}

/**
 * Real Audit Runner (plan US-5, Tasks 5.1–5.3).
 *
 * Executes the audit pipeline — read repository → inspect snippets via the
 * LLM abstraction → emit findings — streaming every step as contract events
 * directly into the SSE hub (the hub is the validator of record and drives
 * the audit store). Failure semantics per NFR-A3 / Task 5.2:
 *
 *  - LLM throttle/unavailability → TOOL_EXECUTION `degraded` + Ollama
 *    fallback; both providers down → TOOL_EXECUTION `failed` + terminal
 *    AUDIT_COMPLETED `failed`;
 *  - repository read failure → failed tool event + terminal failed event;
 *  - any unexpected crash → terminal AUDIT_COMPLETED `failed` (top-level
 *    catch) so no stream is ever left open and no HTTP error ever surfaces.
 */
export class SentinelAuditRunner implements AuditRunner {
  private readonly llmClient: LlmClient;
  private readonly repositoryReader: RepositoryReader;
  private readonly schedule: (callback: () => void) => void;

  constructor(options: SentinelAuditRunnerOptions = {}) {
    this.llmClient = options.llmClient ?? createDefaultLlmClient();
    this.repositoryReader = options.repositoryReader ?? new FsRepositoryReader();
    this.schedule = options.schedule ?? setImmediate;
  }

  /** Async kickoff — the POST response is sent before any event is emitted. */
  run(auditId: string): void {
    this.schedule(() => {
      void this.execute(auditId);
    });
  }

  private async execute(auditId: string): Promise<void> {
    const audit = findAuditById(auditId);
    if (audit === undefined) {
      return; // Unknown id: nothing to stream into; not a runner concern.
    }

    try {
      await this.runAuditSteps(audit);
    } catch (error) {
      // Engine crash guard (Task 5.2): any unexpected failure still ends the
      // stream with a terminal failed event — the hub ignores emissions for
      // audits that are already terminal, so this is safe to call blindly.
      console.error(`[runner] audit ${audit.auditId} crashed: ${describeError(error)}`);
      this.emitTerminalFailure(audit.auditId, `Agent engine crashed: ${describeError(error)}`);
    }
  }

  private async runAuditSteps(audit: Audit): Promise<void> {
    const startedAtMs = Date.now();
    const { auditId, config } = audit;

    this.emitThought(
      audit.auditId,
      `Starting audit of ${describeSource(config)} — rule sets: ${enabledRuleSetNames(config).join(', ')}`,
      'clone',
    );

    // ── Step 1: acquire the repository snapshot ────────────────────────────
    const acquisitionTool = config.repoUrl !== undefined ? TOOL_SOURCE_ACQUISITION : 'fs-scan';
    this.emitToolEvent(audit.auditId, acquisitionTool, 'started', {
      input: sanitizedSourceInput(config),
    });

    const readResult = await this.repositoryReader.read(config);
    if (!readResult.ok) {
      this.emitToolEvent(audit.auditId, acquisitionTool, 'failed', { error: readResult.error });
      this.emitTerminalFailure(audit.auditId, `Repository could not be read: ${readResult.error}`);
      return;
    }
    this.emitToolEvent(audit.auditId, acquisitionTool, 'succeeded', {
      output: `${readResult.files.length} source file(s) read`,
    });

    // ── Step 2: LLM snippet inspection ─────────────────────────────────────
    this.emitThought(
      audit.auditId,
      `Analyzing ${readResult.files.length} source file(s) with ${this.llmClient.providerName}`,
      'analyze',
    );
    this.emitToolEvent(audit.auditId, TOOL_LLM_ANALYZE, 'started', {
      input: { files: readResult.files.length, provider: this.llmClient.providerName },
    });

    const findings: Finding[] = [];
    for (const file of readResult.files) {
      const inspection = await this.inspectSnippet(config, file.filePath, file.content);
      if (inspection.status === 'unavailable') {
        // Both providers failed (NFR-A3): failed tool event + terminal event.
        this.emitToolEvent(audit.auditId, TOOL_LLM_ANALYZE, 'failed', { error: inspection.detail });
        this.emitTerminalFailure(audit.auditId, `LLM analysis unavailable: ${inspection.detail}`);
        return;
      }
      if (inspection.status === 'degraded') {
        // Provider throttle/failure → degraded outcome + fallback (CONCERN-004).
        this.emitToolEvent(audit.auditId, TOOL_LLM_ANALYZE, 'degraded', {
          output: `Falling back to ${inspection.providerUsed}`,
          error: inspection.detail,
        });
      }
      if (inspection.finding !== null) {
        this.emitFinding(audit.auditId, inspection.finding);
        findings.push(inspection.finding);
      }
    }
    this.emitToolEvent(audit.auditId, TOOL_LLM_ANALYZE, 'succeeded', {
      output: `${findings.length} finding(s) across ${readResult.files.length} file(s)`,
    });

    // ── Step 3: terminal completion with generated summary ─────────────────
    emitAuditEvent(audit.auditId, {
      type: 'AUDIT_COMPLETED',
      timestamp: new Date().toISOString(),
      auditId,
      payload: {
        status: 'completed',
        healthScore: computeHealthScore(findings),
        summary: buildSummary(findings, readResult.files.length, enabledRuleSetNames(config).length, startedAtMs),
      },
    });
  }

  private async inspectSnippet(
    config: AuditConfig,
    filePath: string,
    code: string,
  ): Promise<LlmInspection> {
    const request: SnippetInspectionRequest = {
      filePath,
      code: truncateText(code),
      ruleSets: config.ruleSets ?? {},
      severityThreshold: config.severityThreshold ?? 'LOW',
    };
    return this.llmClient.inspectSnippet(request);
  }

  private emitThought(auditId: string, content: string, step: string): void {
    emitAuditEvent(auditId, {
      type: 'AGENT_THOUGHT',
      timestamp: new Date().toISOString(),
      auditId,
      payload: { content, step },
    });
  }

  private emitToolEvent(
    auditId: string,
    tool: string,
    status: 'started' | 'succeeded' | 'failed' | 'degraded',
    extras: { input?: Record<string, unknown>; output?: string; error?: string } = {},
  ): void {
    emitAuditEvent(auditId, {
      type: 'TOOL_EXECUTION',
      timestamp: new Date().toISOString(),
      auditId,
      payload: {
        tool,
        status,
        ...(extras.input !== undefined ? { input: extras.input } : {}),
        ...(extras.output !== undefined ? { output: extras.output } : {}),
        ...(extras.error !== undefined ? { error: truncateText(extras.error) } : {}),
      },
    });
  }

  private emitFinding(auditId: string, finding: Finding): void {
    // VULNERABILITY_FOUND always carries Before/After snippets (§5.5) —
    // the Finding contract enforces both fields.
    emitAuditEvent(auditId, {
      type: 'VULNERABILITY_FOUND',
      timestamp: new Date().toISOString(),
      auditId,
      payload: finding,
    });
  }

  private emitTerminalFailure(auditId: string, error: string): void {
    emitAuditEvent(auditId, {
      type: 'AUDIT_COMPLETED',
      timestamp: new Date().toISOString(),
      auditId,
      payload: { status: 'failed', error: truncateText(error) },
    });
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Human-readable audit source for thought events. */
function describeSource(config: AuditConfig): string {
  return config.repoUrl !== undefined ? 'the remote repository' : 'the local repository';
}

/** Enabled rule set names, used in thoughts and the summary counters. */
function enabledRuleSetNames(config: AuditConfig): string[] {
  return Object.entries(config.ruleSets ?? {})
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
}

/**
 * Sanitized tool input (NFR-S2): credential-free repo URL or file-name-only
 * local path — never secrets, never full filesystem structure.
 */
function sanitizedSourceInput(config: AuditConfig): Record<string, unknown> {
  if (config.repoUrl !== undefined) {
    return { repoUrl: sanitizeRepoUrl(config.repoUrl) };
  }
  return { localPath: basename(config.localPath ?? '') };
}

/** Health score: 100 minus severity-weighted deductions, clamped to 0. */
function computeHealthScore(findings: readonly Finding[]): number {
  const deduction = findings.reduce(
    (total, finding) => total + SEVERITY_DEDUCTIONS[finding.severity],
    0,
  );
  return Math.max(0, 100 - deduction);
}

/** Final counters mirrored into the store summary (US5-AC1). */
function buildSummary(
  findings: readonly Finding[],
  filesAnalyzed: number,
  rulesEvaluated: number,
  startedAtMs: number,
): Record<string, unknown> {
  const counts: Record<Severity, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return {
    findings: counts,
    rulesEvaluated: rulesEvaluated,
    filesAnalyzed,
    durationSeconds: Math.max(0, Math.round((Date.now() - startedAtMs) / 1000)),
  };
}
