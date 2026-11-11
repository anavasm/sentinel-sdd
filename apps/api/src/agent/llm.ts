import { isIP } from 'node:net';

import type { AuditConfig, Finding, Severity } from '@sentinel/contracts';

import { defaultSecretSanitizer } from './secret-sanitizer.js';
import type { SecretSanitizer } from './secret-sanitizer.js';

/**
 * LLM abstraction layer (ASD §6.1, §5.6 — plan US-5 Task 5.1 / CONCERN-004).
 *
 * The Agent Runner is the only component allowed to call the LLM, always
 * through this module. Local Ollama is the default. A remote HTTP provider is
 * constructed only when the server operator opts in with
 * `SENTINEL_ALLOW_EXTERNAL_LLM=true`; its failures degrade to local Ollama.
 * Provider problems are explicit results, surfaced as TOOL_EXECUTION events
 * (NFR-A3) instead of HTTP errors.
 *
 * Adapter tests use injected fetch implementations; real-provider validation
 * requires a separate smoke test.
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
 * Inspection result per snippet: `skipped` means content could not be
 * sanitized safely; `degraded` means the primary provider failed and the
 * Ollama fallback answered; `unavailable` means every provider failed.
 */
export type LlmInspection =
  | {
      readonly status: 'succeeded';
      readonly providerUsed: string;
      readonly finding: Finding | null;
    }
  | {
      readonly status: 'degraded';
      readonly providerUsed: string;
      readonly finding: Finding | null;
      readonly detail: string;
    }
  | { readonly status: 'skipped'; readonly detail: string }
  | { readonly status: 'unavailable'; readonly detail: string };

/** Seam every LLM adapter implements (Dependency Inversion — ASD §6.3.2). */
export interface LlmClient {
  /** Human-readable provider identifier used in tool events and logs. */
  readonly providerName: string;
  /**
   * Inspects one snippet. Provider problems are expected failures returned
   * as `unavailable` results, while unsafe snippets return `skipped`.
   * Implementations do not throw for these expected outcomes (NFR-A3).
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
  expectedFilePath?: string,
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
  if ('finding' in candidate) {
    if (candidate.finding === null && Object.keys(candidate).length === 1) {
      return null;
    }
    throw new LlmProviderError('invalid-response', 'LLM reply has an invalid finding wrapper');
  }
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
      throw new LlmProviderError(
        'invalid-response',
        `LLM reply is missing required field '${field}'`,
      );
    }
  }

  const severity = String(candidate.severity).toUpperCase();
  if (!VALID_SEVERITIES.includes(severity as Severity)) {
    throw new LlmProviderError(
      'invalid-response',
      'LLM replied with invalid severity',
    );
  }
  if (expectedFilePath !== undefined && candidate.filePath !== expectedFilePath) {
    throw new LlmProviderError('invalid-response', 'LLM reply does not match the inspected file');
  }
  if (
    candidate.lineNumber !== undefined &&
    (typeof candidate.lineNumber !== 'number' ||
      !Number.isSafeInteger(candidate.lineNumber) ||
      candidate.lineNumber < 1)
  ) {
    throw new LlmProviderError('invalid-response', 'LLM reply has an invalid line number');
  }
  if (
    candidate.cweId !== undefined &&
    (typeof candidate.cweId !== 'string' || candidate.cweId.trim() === '')
  ) {
    throw new LlmProviderError('invalid-response', 'LLM reply has an invalid CWE identifier');
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
  const focuses = [
    request.ruleSets.owaspTop10 && 'Look for indications of common OWASP-related vulnerabilities.',
    request.ruleSets.testQuality && 'Review available test code qualitatively; do not claim measured coverage.',
    request.ruleSets.codeSmellsPerformance && 'Look for code smells and potential performance issues; do not claim measured performance.',
  ].filter(Boolean);
  return [
    'Review the code for the enabled focuses. Reply with ONE JSON object only:',
    '{"ruleId":string,"title":string,"severity":"LOW"|"MEDIUM"|"HIGH"|"CRITICAL","filePath":string,',
    '"lineNumber":number,"cweId":string,"description":string,"beforeSnippet":string,"afterSnippet":string}',
    'If no issue is found reply {"finding":null}. Keep snippets short and use the exact file path provided.',
    ...focuses,
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
  /** Injectable sanitizer; defaults to the Secretlint recommended preset. */
  readonly sanitizer?: SecretSanitizer;
}

const DEFAULT_HTTP_TIMEOUT_MS = 30_000;
const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = 'llama3.2';
const ALLOW_EXTERNAL_LLM_ENV = 'SENTINEL_ALLOW_EXTERNAL_LLM';

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
  protected readonly sanitizer: SecretSanitizer;

  constructor(options: HttpLlmClientOptions) {
    this.endpoint = options.endpoint;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.sanitizer = options.sanitizer ?? defaultSecretSanitizer;
  }

  async inspectSnippet(request: SnippetInspectionRequest): Promise<LlmInspection> {
    let prompt;
    try {
      prompt = await this.sanitizer.sanitize(
        buildSnippetPrompt(request),
        request.filePath || 'prompt.txt',
      );
    } catch {
      return { status: 'skipped', detail: 'LLM request skipped because the prompt could not be safely sanitized.' };
    }
    if (!prompt.ok) {
      return { status: 'skipped', detail: 'LLM request skipped because the prompt could not be safely sanitized.' };
    }
    try {
      const raw = await this.complete(prompt.content);
      const finding = parseFindingFromLlmText(raw, request.severityThreshold, request.filePath);
      return { status: 'succeeded', providerUsed: this.providerName, finding };
    } catch (error) {
      // Expected provider failure → result, never an exception (NFR-A3).
      return {
        status: 'unavailable',
        detail:
          error instanceof LlmProviderError
            ? error.message
            : `LLM provider failed: ${String(error)}`,
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

/** Local Ollama adapter (`/api/generate`, non-streaming). */
export type OllamaLlmClientOptions = Omit<HttpLlmClientOptions, 'endpoint' | 'model'> & {
  readonly ollamaUrl?: string;
  readonly model?: string;
};

export class OllamaLlmClient extends HttpLlmClient {
  readonly providerName = 'ollama';

  constructor(options: OllamaLlmClientOptions = {}) {
    const {
      ollamaUrl = process.env.OLLAMA_URL ?? DEFAULT_OLLAMA_URL,
      model = process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL,
      ...httpOptions
    } = options;
    if (model.trim() === '') {
      throw new Error('OLLAMA_MODEL must not be empty.');
    }
    const baseUrl = parseHttpUrl(ollamaUrl, 'OLLAMA_URL');
    const ollamaPath = baseUrl.pathname.replace(/\/+$/, '');
    super({
      ...httpOptions,
      endpoint: `${baseUrl.origin}${ollamaPath}/api/generate`,
      model: model.trim(),
    });
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

export interface DefaultLlmClientOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
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
    if (fallbackResult.status === 'skipped') {
      return fallbackResult;
    }
    if (fallbackResult.status !== 'unavailable') {
      return { ...fallbackResult, status: 'degraded', detail: primaryResult.detail };
    }
    return {
      status: 'unavailable',
      detail: `${primaryResult.detail}; fallback failed: ${fallbackResult.detail}`,
    };
  }
}

/** Local-only by default; remote primary access requires explicit operator opt-in. */
export function createDefaultLlmClient(options: DefaultLlmClientOptions = {}): LlmClient {
  const env = options.env ?? process.env;
  const allowExternal = env[ALLOW_EXTERNAL_LLM_ENV] === 'true';
  const ollamaUrl = env.OLLAMA_URL ?? DEFAULT_OLLAMA_URL;
  const ollamaEndpoint = parseHttpUrl(ollamaUrl, 'OLLAMA_URL');

  if (!allowExternal && !isLoopbackHost(ollamaEndpoint.hostname)) {
    throw new Error('OLLAMA_URL must use a loopback host unless external LLM access is enabled.');
  }

  const fallback = new OllamaLlmClient({
    ollamaUrl,
    model: env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL,
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
  });
  const endpoint = env.SENTINEL_LLM_ENDPOINT?.trim();
  if (!allowExternal || endpoint === undefined || endpoint === '') {
    return fallback;
  }

  const model = env.SENTINEL_LLM_MODEL?.trim();
  if (model === undefined || model === '') {
    throw new Error('SENTINEL_LLM_MODEL is required when external LLM access is enabled.');
  }

  const remoteEndpoint = parseHttpUrl(endpoint, 'SENTINEL_LLM_ENDPOINT');
  return new OllamaFallbackLlmClient({
    primary: new HttpLlmClient({
      endpoint: remoteEndpoint.href,
      model,
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    }),
    fallback,
  });
}

function parseHttpUrl(value: string, settingName: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${settingName} must be an absolute HTTP or HTTPS URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${settingName} must be an HTTP or HTTPS URL.`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error(`${settingName} must not contain embedded credentials.`);
  }
  return url;
}

function isLoopbackHost(hostname: string): boolean {
  const normalizedHostname = hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (normalizedHostname === 'localhost') {
    return true;
  }
  if (isIP(normalizedHostname) === 4) {
    return normalizedHostname.startsWith('127.');
  }
  return isIP(normalizedHostname) === 6 && normalizedHostname === '::1';
}
