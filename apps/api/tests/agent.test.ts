import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AuditConfig,
  Finding,
  SentinelAISSEEventContract,
} from '@sentinel/contracts';

import type { LlmClient, LlmInspection, SnippetInspectionRequest } from '../src/agent/llm.js';
import {
  HttpLlmClient,
  LlmProviderError,
  OllamaFallbackLlmClient,
  parseFindingFromLlmText,
} from '../src/agent/llm.js';
import type { RepositoryReadResult, RepositoryReader } from '../src/agent/repo-reader.js';
import { FsRepositoryReader, sanitizeRepoUrl } from '../src/agent/repo-reader.js';
import { SentinelAuditRunner } from '../src/agent/runner.js';
import { validateSentinelEvent } from '../src/lib/validators.js';
import { resetSseHub, subscribeToAuditStream } from '../src/sse/hub.js';
import { createAudit, findAuditById, resetAuditStore } from '../src/store/audits.js';

/**
 * US-5 — Agent Runner integration (plan Tasks 5.1–5.4).
 *
 * The real SentinelAuditRunner is exercised end-to-end with a stub LLM
 * adapter (ASD §10.3: runner tested without real LLM calls) and the real
 * filesystem repository reader where cheap. Every emitted event must
 * validate against specs/events-schema.json; session state, findings, and
 * the terminal summary are asserted through the store and the REST API.
 */

function repoUrlConfig(): AuditConfig {
  return {
    repoUrl: 'https://github.com/example/vulnerable-app.git',
    ruleSets: { owaspTop10: true, testQuality: false, codeSmellsPerformance: true },
    severityThreshold: 'MEDIUM',
  };
}

function localPathConfig(localPath: string): AuditConfig {
  return {
    localPath,
    ruleSets: { owaspTop10: true, testQuality: false, codeSmellsPerformance: false },
    severityThreshold: 'LOW',
  };
}

function sqlInjectionFinding(filePath: string): Finding {
  return {
    ruleId: 'owasp-a03-injection',
    title: 'SQL Injection in user lookup',
    severity: 'HIGH',
    filePath,
    lineNumber: 7,
    cweId: 'CWE-89',
    description: 'User-supplied input is concatenated into a SQL query without parameterization.',
    beforeSnippet: "db.query(`SELECT * FROM users WHERE id = '${userId}'`);",
    afterSnippet: 'db.query("SELECT * FROM users WHERE id = ?", [userId]);',
  };
}

/** Collects every hub event for the audit (replay-then-close semantics). */
function collectEvents(auditId: string): SentinelAISSEEventContract[] {
  const events: SentinelAISSEEventContract[] = [];
  const subscription = subscribeToAuditStream(auditId, {
    onEvent(event) {
      events.push(event);
    },
    onClose() {},
  });
  if (subscription === null) {
    throw new Error(`no event channel for audit ${auditId}`);
  }
  return events;
}

/** Polls the store until the audit is terminal (or times out). */
async function waitForTerminal(auditId: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const status = findAuditById(auditId)?.status;
    if (status === 'completed' || status === 'failed') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`audit ${auditId} did not reach a terminal state in time`);
}

/** Seeds an audit in the store and kicks the given runner for it. */
function runAudit(runner: SentinelAuditRunner, config: AuditConfig): string {
  const audit = createAudit({ config });
  runner.run(audit.auditId);
  return audit.auditId;
}

function sampleInspectionRequest(): SnippetInspectionRequest {
  return {
    filePath: 'src/auth/queries.ts',
    code: "db.query(`SELECT * FROM users WHERE id = '${id}'`);",
    ruleSets: { owaspTop10: true, testQuality: false, codeSmellsPerformance: false },
    severityThreshold: 'LOW',
  };
}

/** Stub repository reader over an in-memory file set. */
function stubReader(files: readonly { filePath: string; content: string }[]): RepositoryReader {
  return {
    async read(): Promise<RepositoryReadResult> {
      return { ok: true, files };
    },
  };
}

/** Stub LLM adapter always returning the given finding (or none). */
function stubLlm(finding: Finding | null): LlmClient {
  return {
    providerName: 'stub-llm',
    async inspectSnippet(): Promise<LlmInspection> {
      return { status: 'succeeded', providerUsed: 'stub-llm', finding };
    },
  };
}

function clientReturning(result: LlmInspection, providerName: string): LlmClient {
  return { providerName, inspectSnippet: async () => result };
}

function neverCalledLlm(): LlmClient {
  return {
    providerName: 'never-called',
    async inspectSnippet(): Promise<LlmInspection> {
      throw new Error('LLM must not be called for this scenario');
    },
  };
}

describe('US-5 — Agent Runner real implementation', () => {
  beforeEach(() => {
    resetAuditStore();
    resetSseHub();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('happy path — full event pipeline and terminal summary (US5-AC1/AC4)', () => {
    it('emits schema-valid events in order and completes the audit', async () => {
      const files = [
        { filePath: 'src/auth/queries.ts', content: 'const q = `SELECT ${id}`;' },
        { filePath: 'src/utils/index.ts', content: 'export const add = (a, b) => a + b;' },
      ];
      const runner = new SentinelAuditRunner({
        llmClient: stubLlm(null),
        repositoryReader: stubReader(files),
      });

      const auditId = runAudit(runner, localPathConfig('/tmp/any-repo'));
      await waitForTerminal(auditId);

      const events = collectEvents(auditId);

      // Complete, ordered pipeline: thought → read tool → thought → llm tool → terminal.
      expect(events.map((event) => event.type)).toEqual([
        'AGENT_THOUGHT',
        'TOOL_EXECUTION', // fs-scan started
        'TOOL_EXECUTION', // fs-scan succeeded
        'AGENT_THOUGHT',
        'TOOL_EXECUTION', // llm-analyze started
        'TOOL_EXECUTION', // llm-analyze succeeded
        'AUDIT_COMPLETED',
      ]);

      // Every event is in-contract and carries the monotonic hub sequence.
      for (const [index, event] of events.entries()) {
        expect(validateSentinelEvent(event), `event ${index} must validate`).toBe(true);
        expect(event.id).toBe(index + 1);
        expect(event.auditId).toBe(auditId);
      }

      // Tool trace: source acquisition started → succeeded, llm-analyze started → succeeded.
      const toolEvents = events.filter((event) => event.type === 'TOOL_EXECUTION') as Extract<
        SentinelAISSEEventContract,
        { type: 'TOOL_EXECUTION' }
      >[];
      expect(toolEvents.map((event) => event.payload.status)).toEqual([
        'started',
        'succeeded',
        'started',
        'succeeded',
      ]);
    });

    it('emits VULNERABILITY_FOUND with Before/After snippets and the hub stores the finding', async () => {
      const finding = sqlInjectionFinding('src/auth/queries.ts');
      const runner = new SentinelAuditRunner({
        llmClient: stubLlm(finding),
        repositoryReader: stubReader([{ filePath: 'src/auth/queries.ts', content: 'const q = 1;' }]),
      });

      const auditId = runAudit(runner, localPathConfig('/tmp/any-repo'));
      await waitForTerminal(auditId);

      const events = collectEvents(auditId);
      const findingEvents = events.filter((event) => event.type === 'VULNERABILITY_FOUND');
      expect(findingEvents).toHaveLength(1);
      const findingPayload = findingEvents[0]?.payload as Record<string, unknown>;
      // §5.5: findings without fixes are incomplete output — both snippets required.
      expect(findingPayload.beforeSnippet).toBeTruthy();
      expect(findingPayload.afterSnippet).toBeTruthy();
      expect(findingPayload.ruleId).toBe('owasp-a03-injection');
      expect(findingPayload.filePath).toBe('src/auth/queries.ts');

      const stored = findAuditById(auditId);
      expect(stored?.status).toBe('completed');
      expect(stored?.findings).toHaveLength(1);
      expect(stored?.findings?.[0]).toMatchObject({ ruleId: 'owasp-a03-injection', severity: 'HIGH' });
    });

    it('generates a terminal summary with severity counts, health score, and duration', async () => {
      const finding = sqlInjectionFinding('src/auth/queries.ts'); // HIGH
      const runner = new SentinelAuditRunner({
        llmClient: stubLlm(finding),
        repositoryReader: stubReader([{ filePath: 'src/auth/queries.ts', content: 'code' }]),
      });

      const auditId = runAudit(runner, repoUrlConfig());
      await waitForTerminal(auditId);

      const events = collectEvents(auditId);
      const terminal = events.at(-1);
      expect(terminal?.type).toBe('AUDIT_COMPLETED');
      const payload = terminal?.payload as Record<string, unknown>;
      expect(payload.status).toBe('completed');
      expect(payload.healthScore).toBe(85); // 100 − 15 (one HIGH)
      const summary = payload.summary as Record<string, unknown>;
      expect(summary.findings).toEqual({ LOW: 0, MEDIUM: 0, HIGH: 1, CRITICAL: 0 });
      expect(summary.rulesEvaluated).toBe(2); // owaspTop10 + codeSmellsPerformance enabled
      expect(summary.filesAnalyzed).toBe(1);
      expect(summary.durationSeconds).toBeGreaterThanOrEqual(0);

      // The hub mirrored the event summary into the store (GET semantics).
      const audit = findAuditById(auditId);
      expect(audit?.summary).toEqual(summary);
    });

    it('scores health 100 and reports zero findings when the LLM finds nothing', async () => {
      const runner = new SentinelAuditRunner({
        llmClient: stubLlm(null),
        repositoryReader: stubReader([{ filePath: 'clean.ts', content: 'export {};' }]),
      });

      const auditId = runAudit(runner, localPathConfig('/tmp/any-repo'));
      await waitForTerminal(auditId);

      const events = collectEvents(auditId);
      expect(events.some((event) => event.type === 'VULNERABILITY_FOUND')).toBe(false);
      const terminal = events.at(-1);
      expect(terminal?.payload.status).toBe('completed');
      expect(terminal?.payload.healthScore).toBe(100);
    });
  });

  describe('repository source acquisition (Task 5.1)', () => {
    it('reads files from a localPath directory (real fs reader)', async () => {
      const repoDir = await mkdtemp(join(tmpdir(), 'sentinel-agent-repo-'));
      try {
        await mkdir(join(repoDir, 'src'), { recursive: true });
        await writeFile(join(repoDir, 'src', 'queries.ts'), 'const q = `SELECT ${id}`;', 'utf8');
        await writeFile(join(repoDir, 'README.md'), '# not source', 'utf8');

        const reader = new FsRepositoryReader();
        const result = await reader.read(localPathConfig(repoDir));

        expect(result.ok).toBe(true);
        if (result.ok) {
          // Only auditable source extensions are picked up; README.md is skipped.
          expect(result.files.map((file) => file.filePath)).toEqual(['src/queries.ts']);
          expect(result.files[0]?.content).toContain('SELECT');
        }
      } finally {
        await rm(repoDir, { recursive: true, force: true });
      }
    });

    it('requests a shallow clone with the configured repo URL (injectable runGit)', async () => {
      const observedArgs: string[][] = [];
      const reader = new FsRepositoryReader({
        runGit: async (args) => {
          observedArgs.push([...args]);
          // Simulate the clone producing source inside the target directory.
          await writeFile(join(args.at(-1) ?? '', 'index.ts'), 'const x = 1;', 'utf8');
        },
      });

      const result = await reader.read(repoUrlConfig());

      expect(result.ok, result.ok ? '' : result.error).toBe(true);
      expect(observedArgs[0]?.slice(0, 3)).toEqual(['clone', '--depth', '1']);
      expect(observedArgs[0]?.at(3)).toBe(repoUrlConfig().repoUrl);
      if (result.ok) {
        expect(result.files.map((file) => file.filePath)).toEqual(['index.ts']);
      }
    });

    it('returns a failed result when the git clone fails', async () => {
      const reader = new FsRepositoryReader({
        runGit: async () => {
          throw new Error('Authentication failed');
        },
      });

      const result = await reader.read(repoUrlConfig());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Could not clone the repository');
      }
    });

    it('returns a failed result for an unreadable localPath directory', async () => {
      const reader = new FsRepositoryReader();

      const result = await reader.read(localPathConfig('/nonexistent/sentinel/repo-path'));

      expect(result.ok).toBe(false);
    });

    it('strips credentials from repo URLs before echoing them into events (NFR-S2)', () => {
      expect(sanitizeRepoUrl('https://user:secret-token@github.com/example/repo.git')).toBe(
        'https://github.com/example/repo.git',
      );
    });
  });

  describe('LLM parsing and provider adapters', () => {
    it('parses a JSON finding from an LLM reply (severity normalized)', () => {
      const raw = 'Sure! {"ruleId":"owasp-a03","title":"SQLi","severity":"high","filePath":"a.ts",'
        + '"description":"bad","beforeSnippet":"x","afterSnippet":"y"}';

      const finding = parseFindingFromLlmText(raw, 'LOW');

      expect(finding).not.toBeNull();
      expect(finding?.severity).toBe('HIGH');
    });

    it('drops findings below the configured severity threshold', () => {
      const raw = '{"ruleId":"r","title":"t","severity":"LOW","filePath":"a.ts",'
        + '"description":"d","beforeSnippet":"x","afterSnippet":"y"}';

      expect(parseFindingFromLlmText(raw, 'MEDIUM')).toBeNull();
      expect(parseFindingFromLlmText(raw, 'LOW')?.severity).toBe('LOW');
    });

    it('rejects replies that are not JSON objects with all required fields', () => {
      expect(() => parseFindingFromLlmText('no json at all', 'LOW')).toThrow(LlmProviderError);
      expect(() => parseFindingFromLlmText('{"ruleId":1}', 'LOW')).toThrow(/required field/);
    });

    it('maps an HTTP 429 to an unavailable inspection result (throttle, NFR-A3)', async () => {
      const client = new HttpLlmClient({
        endpoint: 'https://llm.example/v1/complete',
        model: 'test-model',
        fetchImpl: (async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch,
      });

      const result = await client.inspectSnippet(sampleInspectionRequest());

      expect(result.status, result.status === 'unavailable' ? result.detail : '').toBe('unavailable');
      if (result.status === 'unavailable') {
        expect(result.detail).toContain('429');
      }
    });

    it('maps a successful provider reply to a parsed finding', async () => {
      const providerReply = JSON.stringify(sqlInjectionFinding('src/auth/queries.ts'));
      const client = new HttpLlmClient({
        endpoint: 'https://llm.test/complete',
        model: 'test-model',
        fetchImpl: (async () =>
          new Response(JSON.stringify({ text: providerReply }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })) as unknown as typeof fetch,
      });

      const result = await client.inspectSnippet(sampleInspectionRequest());

      expect(result.status, result.status === 'unavailable' ? result.detail : '').toBe('succeeded');
    });

    it('maps a network failure to an unavailable inspection result', async () => {
      const client = new HttpLlmClient({
        endpoint: 'https://llm.test/complete',
        model: 'test-model',
        fetchImpl: (async () => {
          throw new Error('ECONNREFUSED');
        }) as unknown as typeof fetch,
      });

      const result = await client.inspectSnippet(sampleInspectionRequest());

      expect(result.status, result.status === 'unavailable' ? result.detail : '').toBe('unavailable');
      expect(result.status === 'unavailable' ? result.detail : '').toContain('unreachable');
    });
  });

  describe('resilient provider chain (CONCERN-004)', () => {
    function chainClient(result: LlmInspection, providerName: string): LlmClient {
      return { providerName, inspectSnippet: async () => result };
    }

    it('returns the primary result when the primary provider succeeds', async () => {
      const chain = new OllamaFallbackLlmClient({
        primary: chainClient({ status: 'succeeded', providerUsed: 'primary', finding: null }, 'primary'),
        fallback: chainClient({ status: 'unavailable', detail: 'fallback must not be called' }, 'fallback'),
      });

      const result = await chain.inspectSnippet(sampleInspectionRequest());

      expect(result).toEqual({ status: 'succeeded', providerUsed: 'primary', finding: null });
    });

    it('degrades to the Ollama fallback when the primary provider is unavailable', async () => {
      const chain = new OllamaFallbackLlmClient({
        primary: chainClient({ status: 'unavailable', detail: 'primary throttled' }, 'primary'),
        fallback: chainClient(
          { status: 'succeeded', providerUsed: 'fallback', finding: sqlInjectionFinding('f.ts') },
          'fallback',
        ),
      });

      const result = await chain.inspectSnippet(sampleInspectionRequest());

      expect(result.status).toBe('degraded');
      if (result.status === 'degraded') {
        expect(result.providerUsed).toBe('fallback');
        expect(result.detail).toContain('primary throttled');
        expect(result.finding).not.toBeNull();
      }
    });

    it('reports unavailable with combined details when both providers fail', async () => {
      const chain = new OllamaFallbackLlmClient({
        primary: chainClient({ status: 'unavailable', detail: 'primary down' }, 'primary'),
        fallback: chainClient({ status: 'unavailable', detail: 'ollama down' }, 'fallback'),
      });

      const result = await chain.inspectSnippet(sampleInspectionRequest());

      expect(result.status, result.status === 'unavailable' ? result.detail : '').toBe('unavailable');
      expect(result.status === 'unavailable' ? result.detail : '').toContain('primary down');
      expect(result.status === 'unavailable' ? result.detail : '').toContain('fallback failed: ollama down');
    });
  });

  describe('degradation and failure semantics inside the runner (US5-AC3, NFR-A3)', () => {
    it('emits a degraded TOOL_EXECUTION and completes when the primary provider fails but Ollama answers', async () => {
      const finding = sqlInjectionFinding('src/auth/queries.ts');
      const chain = new OllamaFallbackLlmClient({
        primary: clientReturning(
          { status: 'unavailable', detail: 'primary throttled (429)' },
          'primary',
        ),
        fallback: clientReturning(
          { status: 'succeeded', providerUsed: 'ollama', finding },
          'ollama',
        ),
      });
      const runner = new SentinelAuditRunner({
        llmClient: chain,
        repositoryReader: stubReader([{ filePath: 'src/auth/queries.ts', content: 'code' }]),
      });

      const auditId = runAudit(runner, localPathConfig('/tmp/any-repo'));
      await waitForTerminal(auditId);

      const events = collectEvents(auditId);
      const degraded = events.find(
        (event) =>
          event.type === 'TOOL_EXECUTION' &&
          (event.payload as Record<string, unknown>).status === 'degraded',
      );
      expect(degraded, 'a degraded TOOL_EXECUTION event must be emitted').toBeTruthy();
      expect(
        String((degraded?.payload as Record<string, unknown>).output),
      ).toContain('ollama');

      // Degradation never aborts the audit: findings + terminal completed.
      const terminal = events.at(-1);
      expect(terminal?.type).toBe('AUDIT_COMPLETED');
      expect(terminal?.payload.status).toBe('completed');
      expect(findAuditById(auditId)?.status).toBe('completed');
      expect(findAuditById(auditId)?.findings).toHaveLength(1);
      expect(validateSentinelEvent(degraded as SentinelAISSEEventContract)).toBe(true);
    });

    it('fails the audit via terminal event when both LLM providers are down', async () => {
      const chain = new OllamaFallbackLlmClient({
        primary: clientReturning({ status: 'unavailable', detail: 'primary down' }, 'primary'),
        fallback: clientReturning({ status: 'unavailable', detail: 'ollama down' }, 'fallback'),
      });
      const runner = new SentinelAuditRunner({
        llmClient: chain,
        repositoryReader: stubReader([{ filePath: 'src/auth/queries.ts', content: 'code' }]),
      });

      const auditId = runAudit(runner, localPathConfig('/tmp/any-repo'));
      await waitForTerminal(auditId);

      const events = collectEvents(auditId);
      const failedTool = events.find(
        (event) =>
          event.type === 'TOOL_EXECUTION' &&
          (event.payload as Record<string, unknown>).status === 'failed',
      );
      expect(failedTool, 'a failed TOOL_EXECUTION event must be emitted').toBeTruthy();

      const terminal = events.at(-1);
      expect(terminal?.type).toBe('AUDIT_COMPLETED');
      const payload = terminal?.payload as Record<string, unknown>;
      expect(payload.status).toBe('failed');
      expect(String(payload.error)).toContain('LLM analysis unavailable');

      const stored = findAuditById(auditId);
      expect(stored?.status).toBe('failed');
      expect(stored?.findings ?? []).toHaveLength(0);

      // Every event stays in-contract even on the failure path (US5-AC2).
      for (const [index, event] of events.entries()) {
        expect(validateSentinelEvent(event), `event ${index} must validate`).toBe(true);
      }
    });

    it('maps a repository read failure to a failed tool event + terminal failed event', async () => {
      const runner = new SentinelAuditRunner({
        llmClient: neverCalledLlm(),
        repositoryReader: {
          async read(): Promise<RepositoryReadResult> {
            return { ok: false, error: 'directory vanished mid-audit' };
          },
        },
      });

      const auditId = runAudit(runner, localPathConfig('/tmp/vanished'));
      await waitForTerminal(auditId);

      const events = collectEvents(auditId);
      const toolStatuses = events
        .filter((event) => event.type === 'TOOL_EXECUTION')
        .map((event) => (event.payload as Record<string, unknown>).status);
      expect(toolStatuses).toEqual(['started', 'failed']);

      const terminal = events.at(-1);
      expect(terminal?.type).toBe('AUDIT_COMPLETED');
      expect(terminal?.payload.status).toBe('failed');
      expect(findAuditById(auditId)?.status).toBe('failed');
    });

    it('survives an unexpected reader crash with a terminal failed event (no orphan streams)', async () => {
      const runner = new SentinelAuditRunner({
        llmClient: neverCalledLlm(),
        repositoryReader: {
          async read(): Promise<RepositoryReadResult> {
            throw new Error('unexpected engine crash');
          },
        },
      });

      const auditId = runAudit(runner, localPathConfig('/tmp/any-repo'));
      await waitForTerminal(auditId);

      const events = collectEvents(auditId);
      const terminal = events.at(-1);
      expect(terminal?.type).toBe('AUDIT_COMPLETED');
      const payload = terminal?.payload as Record<string, unknown>;
      expect(payload.status).toBe('failed');
      expect(String(payload.error)).toContain('Agent engine crashed');
      expect(String(payload.error)).toContain('unexpected engine crash');
      expect(findAuditById(auditId)?.status).toBe('failed');
    });
  });
});
