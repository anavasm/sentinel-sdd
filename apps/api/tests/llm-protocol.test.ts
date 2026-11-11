import { describe, expect, it, vi } from 'vitest';

import {
  buildSnippetPrompt,
  createDefaultLlmClient,
  HttpLlmClient,
  OllamaFallbackLlmClient,
  OllamaLlmClient,
  parseFindingFromLlmText,
  type SnippetInspectionRequest,
} from '../src/agent/llm.js';
import { createSecretSanitizer } from '../src/agent/secret-sanitizer.js';

const request: SnippetInspectionRequest = {
  filePath: 'src/example.ts',
  code: 'export const value = 42;',
  ruleSets: { owaspTop10: false, testQuality: true, codeSmellsPerformance: true },
  severityThreshold: 'MEDIUM',
};

const finding = {
  ruleId: 'test',
  title: 'Potential issue',
  severity: 'HIGH',
  filePath: request.filePath,
  description: 'Review this code.',
  beforeSnippet: 'value',
  afterSnippet: 'value',
};

describe('LLM protocol and focus', () => {
  it('accepts a no-finding response and rejects malformed wrappers and locations', () => {
    expect(parseFindingFromLlmText('{"finding":null}', 'LOW')).toBeNull();
    expect(() => parseFindingFromLlmText('{"finding":null,"extra":1}', 'LOW')).toThrow();
    expect(() => parseFindingFromLlmText(JSON.stringify({ ...finding, lineNumber: 0 }), 'LOW')).toThrow();
    expect(() => parseFindingFromLlmText(JSON.stringify({ ...finding, cweId: 7 }), 'LOW')).toThrow();
    expect(parseFindingFromLlmText(JSON.stringify({ ...finding, severity: 'LOW' }), 'MEDIUM')).toBeNull();
    expect(() => parseFindingFromLlmText(
      JSON.stringify({ ...finding, severity: 'LOW', filePath: 'other.ts' }),
      'MEDIUM',
      request.filePath,
    )).toThrow(/inspected file/);
  });

  it('describes only the enabled qualitative review focuses', () => {
    const prompt = buildSnippetPrompt(request);
    expect(prompt).not.toContain('OWASP-related');
    expect(prompt).toContain('do not claim measured coverage');
    expect(prompt).toContain('do not claim measured performance');
    expect(prompt).toContain('{"finding":null}');
  });

  it('sends a non-streaming Ollama request using the configured model and handles no findings', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ response: '{"finding":null}' }), { status: 200 }),
    );
    const client = createDefaultLlmClient({
      env: { OLLAMA_URL: 'http://localhost:11434', OLLAMA_MODEL: 'test-model' },
      fetchImpl,
    });
    expect(await client.inspectSnippet(request)).toMatchObject({ status: 'succeeded', finding: null });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, options] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:11434/api/generate');
    expect(options?.method).toBe('POST');
    expect(JSON.parse(String(options?.body))).toMatchObject({
      model: 'test-model',
      stream: false,
      prompt: expect.stringContaining(request.code),
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects invalid provider output and mismatched finding paths', async () => {
    for (const response of ['not-json', JSON.stringify({ response: '{}' }), JSON.stringify({
      response: JSON.stringify({ ...finding, filePath: 'other.ts' }),
    })]) {
      const client = new OllamaLlmClient({
        fetchImpl: async () => new Response(response),
      });
      expect(await client.inspectSnippet(request)).toMatchObject({ status: 'unavailable' });
    }
    expect(() => createDefaultLlmClient({ env: { OLLAMA_MODEL: ' ' } })).toThrow(/OLLAMA_MODEL/);
  });

  it.each([429, 503])('falls back to Ollama on HTTP %i', async (status) => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) =>
      String(url).includes('primary')
        ? new Response('', { status })
        : new Response(JSON.stringify({ response: JSON.stringify(finding) })),
    );
    const client = createDefaultLlmClient({
      env: {
        SENTINEL_ALLOW_EXTERNAL_LLM: 'true',
        SENTINEL_LLM_ENDPOINT: 'https://primary.example/complete',
        SENTINEL_LLM_MODEL: 'primary-model',
      },
      fetchImpl,
    });
    expect(await client.inspectSnippet(request)).toMatchObject({ status: 'degraded', finding });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reports both providers unavailable on a timeout and fallback failure', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes('primary')) {
        throw new DOMException('Timed out', 'TimeoutError');
      }
      return new Response('', { status: 503 });
    });
    const client = createDefaultLlmClient({
      env: {
        SENTINEL_ALLOW_EXTERNAL_LLM: 'true',
        SENTINEL_LLM_ENDPOINT: 'https://primary.example/complete',
        SENTINEL_LLM_MODEL: 'primary-model',
      },
      fetchImpl,
    });
    expect(await client.inspectSnippet(request)).toMatchObject({ status: 'unavailable' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('never invokes fallback after prompt sanitization fails', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}'));
    const fallbackInspect = vi.fn(async () => ({
      status: 'succeeded' as const,
      providerUsed: 'fallback',
      finding: null,
    }));
    const client = new OllamaFallbackLlmClient({
      primary: new HttpLlmClient({
        endpoint: 'https://primary.example',
        model: 'primary',
        fetchImpl,
        sanitizer: createSecretSanitizer(async () => ({ ok: false })),
      }),
      fallback: { providerName: 'fallback', inspectSnippet: fallbackInspect },
    });
    expect(await client.inspectSnippet(request)).toMatchObject({ status: 'skipped' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fallbackInspect).not.toHaveBeenCalled();
  });
});
