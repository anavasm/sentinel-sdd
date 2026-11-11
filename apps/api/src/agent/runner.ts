import { basename } from 'node:path';

import type { Audit, AuditConfig, Finding, Severity } from '@sentinel/contracts';

import type { LlmClient, LlmInspection, SnippetInspectionRequest } from './llm.js';
import { createDefaultLlmClient, MAX_SNIPPET_LENGTH, truncateText } from './llm.js';
import type { RepositoryReader } from './repo-reader.js';
import { FsRepositoryReader, sanitizeRepoUrl } from './repo-reader.js';
import { defaultSecretSanitizer } from './secret-sanitizer.js';
import type {
  SecretSanitizationResult,
  SecretSanitizer,
} from './secret-sanitizer.js';
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
  /** Content sanitizer; defaults to Secretlint's recommended rule preset. */
  readonly secretSanitizer?: SecretSanitizer;
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
  private readonly secretSanitizer: SecretSanitizer;
  private readonly schedule: (callback: () => void) => void;

  constructor(options: SentinelAuditRunnerOptions = {}) {
    this.llmClient = options.llmClient ?? createDefaultLlmClient();
    this.repositoryReader = options.repositoryReader ?? new FsRepositoryReader();
    this.secretSanitizer = options.secretSanitizer ?? defaultSecretSanitizer;
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
      const safeDetails = await this.sanitizeDiagnosticText(describeError(error));
      console.error(`[runner] audit ${audit.auditId} crashed: ${safeDetails}`);
      await this.emitTerminalFailure(audit.auditId, `Agent engine crashed: ${safeDetails}`);
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
    await this.emitToolEvent(audit.auditId, acquisitionTool, 'started', {
      input: sanitizedSourceInput(config),
    });

    const readResult = await this.repositoryReader.read(config);
    if (!readResult.ok) {
      await this.emitToolEvent(audit.auditId, acquisitionTool, 'failed', {
        error: readResult.error,
      });
      await this.emitTerminalFailure(audit.auditId, `Repository could not be read: ${readResult.error}`);
      return;
    }
    await this.emitToolEvent(audit.auditId, acquisitionTool, 'succeeded', {
      output: `${readResult.files.length} source file(s) read`,
    });
    const limitations = readResult.limitations;
    if (
      limitations !== undefined &&
      (limitations.fileLimitReached ||
        limitations.sensitivePathsSkipped > 0 ||
        limitations.unreadablePathsSkipped > 0 ||
        limitations.oversizedFilesSkipped > 0)
    ) {
      await this.emitToolEvent(auditId, acquisitionTool, 'degraded', {
        output: `Incomplete repository scan: file limit reached: ${limitations.fileLimitReached}; sensitive paths skipped: ${limitations.sensitivePathsSkipped}; unreadable paths skipped: ${limitations.unreadablePathsSkipped}; oversized files skipped: ${limitations.oversizedFilesSkipped}.`,
      });
    }

    // ── Step 2: LLM snippet inspection ─────────────────────────────────────
    this.emitThought(
      audit.auditId,
      `Analyzing ${readResult.files.length} source file(s) with ${this.llmClient.providerName}`,
      'analyze',
    );
    await this.emitToolEvent(audit.auditId, TOOL_LLM_ANALYZE, 'started', {
      input: { files: readResult.files.length, provider: this.llmClient.providerName },
    });

    const findings: Finding[] = [];
    let skippedSnippets = 0;
    let analyzedFiles = 0;
    const truncatedSnippets = readResult.files.filter(
      (file) => file.content.length > MAX_SNIPPET_LENGTH,
    ).length;
    if (truncatedSnippets > 0) {
      await this.emitToolEvent(auditId, TOOL_LLM_ANALYZE, 'degraded', {
        output: `${truncatedSnippets} source file(s) truncated to ${MAX_SNIPPET_LENGTH} characters for LLM review.`,
      });
    }
    for (const file of readResult.files) {
      const inspection = await this.inspectSnippet(config, file.filePath, file.content);
      if (inspection.status === 'skipped') {
        skippedSnippets += 1;
        continue;
      }
      if (inspection.status === 'unavailable') {
        // Both providers failed (NFR-A3): failed tool event + terminal event.
        await this.emitToolEvent(audit.auditId, TOOL_LLM_ANALYZE, 'failed', {
          error: inspection.detail,
        });
        await this.emitTerminalFailure(
          audit.auditId,
          `LLM analysis unavailable: ${inspection.detail}`,
        );
        return;
      }
      if (inspection.status === 'degraded') {
        // Provider throttle/failure → degraded outcome + fallback (CONCERN-004).
        await this.emitToolEvent(audit.auditId, TOOL_LLM_ANALYZE, 'degraded', {
          output: `Falling back to ${inspection.providerUsed}`,
          error: inspection.detail,
        });
      }
      analyzedFiles += 1;
      if (inspection.finding !== null) {
        const finding = await this.sanitizeFinding(inspection.finding);
        if (finding === null) {
          skippedSnippets += 1;
          continue;
        }
        this.emitFinding(audit.auditId, finding);
        findings.push(finding);
      }
    }
    if (skippedSnippets > 0) {
      await this.emitToolEvent(audit.auditId, TOOL_LLM_ANALYZE, 'degraded', {
        output: `${skippedSnippets} snippet(s) skipped because they could not be safely sanitized.`,
      });
    }
    if (analyzedFiles === 0) {
      await this.emitToolEvent(auditId, TOOL_LLM_ANALYZE, 'failed', {
        error: 'No source files could be safely analyzed.',
      });
      await this.emitTerminalFailure(auditId, 'No source files could be safely analyzed.');
      return;
    }
    await this.emitToolEvent(audit.auditId, TOOL_LLM_ANALYZE, 'succeeded', {
      output: `${findings.length} finding(s) across ${analyzedFiles} file(s) analyzed; ${skippedSnippets} snippet(s) skipped`,
    });

    // ── Step 3: terminal completion with generated summary ─────────────────
    emitAuditEvent(audit.auditId, {
      type: 'AUDIT_COMPLETED',
      timestamp: new Date().toISOString(),
      auditId,
      payload: {
        status: 'completed',
        healthScore: computeHealthScore(findings),
        summary: buildSummary(findings, analyzedFiles, enabledRuleSetNames(config).length, startedAtMs),
      },
    });
  }

  private async inspectSnippet(
    config: AuditConfig,
    filePath: string,
    code: string,
  ): Promise<LlmInspection> {
    const safeFilePath = await this.sanitizeContent(filePath, 'file-path.txt');
    const safeCode = await this.sanitizeContent(truncateText(code), filePath);
    if (!safeFilePath.ok || !safeCode.ok) {
      return {
        status: 'skipped',
        detail: 'Snippet skipped because it could not be safely sanitized.',
      };
    }

    const request: SnippetInspectionRequest = {
      filePath: safeFilePath.content,
      code: safeCode.content,
      ruleSets: config.ruleSets ?? {},
      severityThreshold: config.severityThreshold ?? 'LOW',
    };
    return this.llmClient.inspectSnippet(request);
  }

  private async sanitizeFinding(finding: Finding): Promise<Finding | null> {
    const sanitizedFinding = { ...finding };
    const fields = [
      'ruleId',
      'title',
      'filePath',
      'description',
      'beforeSnippet',
      'afterSnippet',
    ] as const;
    for (const field of fields) {
      const result = await this.sanitizeContent(
        sanitizedFinding[field],
        `finding-${field}.txt`,
      );
      if (!result.ok) {
        return null;
      }
      sanitizedFinding[field] = result.content;
    }
    if (sanitizedFinding.cweId !== undefined) {
      const result = await this.sanitizeContent(
        sanitizedFinding.cweId,
        'finding-cwe.txt',
      );
      if (!result.ok) {
        return null;
      }
      sanitizedFinding.cweId = result.content;
    }
    return sanitizedFinding;
  }

  private emitThought(auditId: string, content: string, step: string): void {
    emitAuditEvent(auditId, {
      type: 'AGENT_THOUGHT',
      timestamp: new Date().toISOString(),
      auditId,
      payload: { content, step },
    });
  }

  private async emitToolEvent(
    auditId: string,
    tool: string,
    status: 'started' | 'succeeded' | 'failed' | 'degraded',
    extras: { input?: Record<string, unknown>; output?: string; error?: string } = {},
  ): Promise<void> {
    const sanitizedInput =
      extras.input === undefined ? undefined : await this.sanitizeDiagnosticValue(extras.input);
    const sanitizedOutput =
      extras.output === undefined
        ? undefined
        : await this.sanitizeDiagnosticText(
            extras.output,
            tool === TOOL_LLM_ANALYZE && status === 'degraded'
              ? 'One or more snippets were skipped because sanitization failed.'
              : undefined,
          );
    const sanitizedError =
      extras.error === undefined ? undefined : await this.sanitizeDiagnosticText(extras.error);
    emitAuditEvent(auditId, {
      type: 'TOOL_EXECUTION',
      timestamp: new Date().toISOString(),
      auditId,
      payload: {
        tool,
        status,
        ...(sanitizedInput !== undefined ? { input: sanitizedInput } : {}),
        ...(sanitizedOutput !== undefined ? { output: sanitizedOutput } : {}),
        ...(sanitizedError !== undefined ? { error: truncateText(sanitizedError) } : {}),
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

  private async emitTerminalFailure(auditId: string, error: string): Promise<void> {
    const sanitizedError = await this.sanitizeDiagnosticText(error);
    emitAuditEvent(auditId, {
      type: 'AUDIT_COMPLETED',
      timestamp: new Date().toISOString(),
      auditId,
      payload: { status: 'failed', error: truncateText(sanitizedError) },
    });
  }

  private async sanitizeDiagnosticText(text: string, fallback?: string): Promise<string> {
    const result = await this.sanitizeContent(text, 'diagnostic.txt');
    return result.ok
      ? result.content
      : (fallback ?? 'Diagnostic details omitted because they were not safe.');
  }

  private async sanitizeContent(content: string, filePath: string): Promise<SecretSanitizationResult> {
    try {
      const result: unknown = await this.secretSanitizer.sanitize(content, filePath);
      if (typeof result !== 'object' || result === null || !('ok' in result)) {
        return { ok: false };
      }
      if (result.ok === false) {
        return { ok: false };
      }
      if (
        result.ok !== true ||
        !('content' in result) ||
        typeof result.content !== 'string' ||
        !('redacted' in result) ||
        typeof result.redacted !== 'boolean'
      ) {
        return { ok: false };
      }
      return {
        ok: true,
        content: result.content,
        redacted: result.redacted,
      };
    } catch {
      return { ok: false };
    }
  }

  private async sanitizeDiagnosticValue(value: unknown): Promise<unknown> {
    if (typeof value === 'string') {
      return this.sanitizeDiagnosticText(value);
    }
    if (Array.isArray(value)) {
      return Promise.all(value.map((item) => this.sanitizeDiagnosticValue(item)));
    }
    if (typeof value === 'object' && value !== null) {
      const sanitized: Record<string, unknown> = {};
      for (const [key, nestedValue] of Object.entries(value)) {
        sanitized[key] = await this.sanitizeDiagnosticValue(nestedValue);
      }
      return sanitized;
    }
    return value;
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
