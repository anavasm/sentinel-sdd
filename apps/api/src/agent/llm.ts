import type { AuditConfig, Finding, Severity } from '@sentinel/contracts';

/**
 * LLM abstraction layer (ASD §6.1, §5.6 — plan US-5 Task 5.1 / CONCERN-004).
 *
 * The Agent Runner is the only component allowed to call the LLM, always
 * through this module. `OllamaFallbackLlmClient` composes a primary free-tier
 * HTTP provider with a local Ollama fallback and classifies every failure as
 * an explicit result — provider problems degrade the audit (TOOL_EXECUTION
 * degraded/failed events, NFR-A3) instead of raising HTTP errors.
 *
 * Tests inject stub `LlmClient`s (ASD §10.3); the HTTP adapters are never
 * exercised by the suite.
 */

/** Code snippet handed to an LLM provider for inspection. */
export interface SnippetInspectionRequest {
  readonly filePath: string;
  readonly code: string;
  readonly ruleSets: NonNullable<AuditConfig['ruleSets']>;
  readonly severityThreshold: NonNullable<AuditConfig['severityThreshold']>;
}

/** Provider problems, classified per NFR-A3 semantics. */
export type LlmFailureKind = 'throttled' | 'unavailable' | 'invalid-response';

/** Error thrown by a provider adapter; expected failure → mapped to a result. */
export class LlmProviderError extends Error {
  readonly kind: LlmFailureKind;

  constructor(kind: LlmFailureKind, detail: string) {
    super(`${detail} (kind: ${kind})`);
    this.name = 'LlmProviderError';
    this.kind = kind;
  }
}

/**
 * Inspection result per snippet: `degraded` means the primary provider
 * failed and the Ollama fallback produced the answer; `unavailable` means
 * every provider failed — the runner turns this into a terminal failure.
 */
export type LlmInspection =
  | { readonly status: 'succeeded'; readonly providerUsed: string; readonly finding: Finding | null }
  | { readonly status: 'degraded'; readonly providerUsed: string; readonly finding: Finding | null; readonly detail: string }
  | { readonly status: 'unavailable'; readonly detail: string };

/** Seam every LLM adapter implements (Dependency Inversion — ASD §6.3.2). */
export interface LlmClient {
  /** Human-readable provider identifier used in tool events and logs. */
  readonly providerName: string;
  /**
   * Inspects one snippet. Provider problems are expected failures returned
   * as `unavailable` results — implementations never throw for provider
   * issues (NFR-A3: degradation is data, not an exception).
   */
  inspectSnippet(request: SnippetInspectionRequest): Promise<LlmInspection>;
}

/** Max snippet characters kept in events or prompts (NFR-S2 — no full dumps). */
export const MAX_SNIPPET_LENGTH = 2000;

const VALID_SEVERITIES: readonly Severity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

/**
 * Parses a raw LLM completion into a `Finding`.
 *
 * Models are instructed to answer with a single JSON object. The parser
 * extracts the first JSON object from the text, normalizes severity casing,
 * drops findings under the configured threshold, and rejects shapes missing
 * contract-required fields (Before/After snippets included — §5.5).
 */
export function parseFindingFromLlmText(
  rawText: string,
  severityThreshold: NonNullable<AuditConfig['severityThreshold']>,
): Finding | null {
  const jsonStart = rawText.indexOf('{');
  const jsonEnd = rawText.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd <= jsonStart) {
    throw new LlmProviderError('invalid-response', 'LLM reply contained no JSON object');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText.slice(jsonStart, jsonEnd + 1)) as unknown;
  } catch {
    throw new LlmProviderError('invalid-response', 'LLM reply was not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new LlmProviderError('invalid-response', 'LLM reply was not an object');
  }

  const candidate = parsed as Record<string, unknown>;
  const requiredFields = [
    'ruleId',
    'title',
    'severity',
    'filePath',
    'description',
    'beforeSnippet',
    'afterSnippet',
  ] as const;
  for (const field of requiredFields) {
    const value = candidate[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new LlmProviderError('invalid-response', `LLM reply is missing required field '${field}'`);
    }
  }

  const severity = String(candidate.severity).toUpperCase();
  if (!VALID_SEVERITIES.includes(severity as Severity)) {
    throw new LlmProviderError('invalid-response', `LLM replied with invalid severity '${severity}'`);
  }
  if (SEVERITY_RANK[severity as Severity] < SEVERITY_RANK[severityThreshold]) {
    return null; // Below the configured reporting threshold.
  }

  return {
    ruleId: candidate.ruleId as string,
    title: candidate.title as string,
    severity: severity as Severity,
    filePath: candidate.filePath as string,
    ...(typeof candidate.lineNumber === 'number' && Number.isInteger(candidate.lineNumber)
      ? { lineNumber: candidate.lineNumber }
      : {}),
    ...(typeof candidate.cweId === 'string' && (candidate.cweId as string).trim() !== ''
      ? { cweId: candidate.cweId as string }
      : {}),
    description: candidate.description as string,
    beforeSnippet: (candidate.beforeSnippet as string).slice(0, MAX_SNIPPET_LENGTH),
    afterSnippet: (candidate.afterSnippet as string).slice(0, MAX_SNIPPET_LENGTH),
  };
}

/** Builds the audit prompt for one snippet (rule sets drive the focus). */
export function buildSnippetPrompt(
  request: Pick<SnippetInspectionRequest, 'filePath' | 'code' | 'ruleSets'>,
): string {
  const enabledRuleSets = Object.entries(request.ruleSets)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .join(', ');
  return [
    'You are a static-analysis security auditor. Inspect the code and reply with ONE JSON object only:',
    '{"ruleId":string,"title":string,"severity":"LOW"|"MEDIUM"|"HIGH"|"CRITICAL","filePath":string,',
    '"lineNumber":number,"cweId":string,"description":string,"beforeSnippet":string,"afterSnippet":string}',
    'If no vulnerability is found reply {"finding":null}. Keep snippets short.',
    `Enabled rule sets: ${enabledRuleSets}`,
    `File: ${request.filePath}`,
    'Code:',
    truncateText(request.code),
  ].join('\n');
}

/** Truncates free-form text so no payload carries a full file dump (NFR-S2). */
export function truncateText(text: string, maxLength: number = MAX_SNIPPET_LENGTH): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/** Options for the fetch-backed adapters. */
export interface HttpLlmClientOptions {
  readonly endpoint: string;
  readonly model: string;
  readonly timeoutMs?: number;
  /** Injectable for adapter-level tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

/**
 * Free-tier HTTP provider adapter (primary). POSTs the prompt and expects a
 * text completion. Network/HTTP failures map to `LlmProviderError` kinds
 * (429 → throttled, other non-2xx → unavailable) so the fallback chain can
 * classify the degradation.
 */
export class HttpLlmClient implements LlmClient {
  readonly providerName: string = 'http-provider';

  protected readonly endpoint: string;
  protected readonly model: string;
  protected readonly timeoutMs: number;
  protected readonly fetchImpl: typeof fetch;

  constructor(options: HttpLlmClientOptions) {
    this.endpoint = options.endpoint;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  async inspectSnippet(request: SnippetInspectionRequest): Promise<LlmInspection> {
    try {
      const raw = await this.complete(buildSnippetPrompt(request));
      const finding = parseFindingFromLlmText(raw, request.severityThreshold);
      return { status: 'succeeded', providerUsed: this.providerName, finding };
    } catch (error) {
      // Expected provider failure → result, never an exception (NFR-A3).
      return {
        status: 'unavailable',
        detail: error instanceof LlmProviderError ? error.message : `LLM provider failed: ${String(error)}`,
      };
    }
  }

  /** Single completion call; override point for provider-specific bodies. */
  protected async complete(prompt: string): Promise<string> {
    const response = await this.postJson({ model: this.model, prompt });
    const body = (await response.json().catch(() => null)) as { text?: unknown } | null;
    if (typeof body?.text !== 'string') {
      throw new LlmProviderError('invalid-response', 'LLM provider returned a non-text body');
    }
    return body.text;
  }

  /** Shared HTTP plumbing; maps transport/HTTP failures to provider errors. */
  protected async postJson(payload: Record<string, unknown>): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new LlmProviderError('unavailable', `LLM endpoint unreachable: ${String(error)}`);
    }
    if (response.status === 429) {
      throw new LlmProviderError('throttled', 'LLM provider throttled the request (429)');
    }
    if (!response.ok) {
      throw new LlmProviderError('unavailable', `LLM endpoint responded ${response.status}`);
    }
    return response;
  }
}

/** Default local Ollama endpoint (CONCERN-004 fallback). */
const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

/** Local Ollama adapter (`/api/generate`, non-streaming); the fallback leg. */
export class OllamaLlmClient extends HttpLlmClient {
  readonly providerName = 'ollama';

  constructor(options: Omit<HttpLlmClientOptions, 'endpoint' | 'model'> = {}) {
    const ollamaUrl = process.env.OLLAMA_URL ?? DEFAULT_OLLAMA_URL;
    super({ ...options, endpoint: `${ollamaUrl}/api/generate`, model: 'llama3.2' });
  }

  protected override async complete(prompt: string): Promise<string> {
    const response = await this.postJson({ model: this.model, prompt, stream: false });
    const body = (await response.json().catch(() => null)) as { response?: unknown } | null;
    if (typeof body?.response !== 'string') {
      throw new LlmProviderError('invalid-response', 'Ollama returned no response text');
    }
    return body.response;
  }
}

export interface OllamaFallbackLlmClientOptions {
  readonly primary: LlmClient;
  readonly fallback: LlmClient;
}

/**
 * Resilient LLM client: primary provider first; on any provider error
 * (throttle included) it degrades to the Ollama fallback (CONCERN-004).
 * Both down → `unavailable` result, which the runner surfaces as a failed
 * TOOL_EXECUTION plus a terminal AUDIT_COMPLETED — never an HTTP error
 * (NFR-A3).
 */
export class OllamaFallbackLlmClient implements LlmClient {
  readonly providerName = 'fallback-chain';

  private readonly primary: LlmClient;
  private readonly fallback: LlmClient;

  constructor(options: OllamaFallbackLlmClientOptions) {
    this.primary = options.primary;
    this.fallback = options.fallback;
  }

  async inspectSnippet(request: SnippetInspectionRequest): Promise<LlmInspection> {
    const primaryResult = await this.primary.inspectSnippet(request);
    if (primaryResult.status !== 'unavailable') {
      return primaryResult;
    }
    // Primary throttled/failed → degrade to the Ollama fallback (CONCERN-004).
    const fallbackResult = await this.fallback.inspectSnippet(request);
    if (fallbackResult.status !== 'unavailable') {
      return { ...fallbackResult, status: 'degraded', detail: primaryResult.detail };
    }
    return {
      status: 'unavailable',
      detail: `${primaryResult.detail}; fallback failed: ${fallbackResult.detail}`,
    };
  }
}

/** Production default: free-tier endpoint primary, local Ollama fallback. */
export function createDefaultLlmClient(): LlmClient {
  const endpoint = process.env.SENTINEL_LLM_ENDPOINT ?? 'https://api.free-tier-llm.example/v1/complete';
  const model = process.env.SENTINEL_LLM_MODEL ?? 'gpt-4o-mini';
  return new OllamaFallbackLlmClient({
    primary: new HttpLlmClient({ endpoint, model }),
    fallback: new OllamaLlmClient(),
  });
}
