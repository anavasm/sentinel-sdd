/**
 * Remediation API client tests (US-5): request shape (path, method, locator
 * body, signal forwarding) and the RFC 9457 Problem rejection path exercised
 * through the real createApiFetch transport.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiFetch, ApiProblemError, UnparseableProblemError } from '@sentinel/contracts';
import { createRemediationApi } from '../src/lib/remediationApi';
import { AUDIT_ID, findingEvent } from './mocks/fixtures';

const SAMPLE_FINDING = findingEvent(1, 'HIGH').payload;

function jsonResponse(status: number, body: unknown, contentType: string): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': contentType } });
}

describe('remediationApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the finding locator to the remediate endpoint and returns the result', async () => {
    const apiFetch = vi.fn().mockResolvedValue({
      status: 'applied',
      message: 'Patch applied to src/auth/queries.ts (1 hunk)',
    });
    const remediationApi = createRemediationApi(apiFetch);

    const result = await remediationApi.applyFix(AUDIT_ID, SAMPLE_FINDING);

    expect(result.status).toBe('applied');
    const [requestedPath, requestInit] = apiFetch.mock.calls[0] as [string, RequestInit];
    expect(requestedPath).toBe(`/audits/${AUDIT_ID}/findings/remediate`);
    expect(requestInit.method).toBe('POST');
    expect(requestInit.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(requestInit.body as string)).toEqual({
      ruleId: SAMPLE_FINDING.ruleId,
      filePath: SAMPLE_FINDING.filePath,
      lineNumber: SAMPLE_FINDING.lineNumber,
    });
  });

  it('omits lineNumber from the locator when the finding has none', async () => {
    const findingWithoutLine = { ...SAMPLE_FINDING };
    delete (findingWithoutLine as { lineNumber?: number }).lineNumber;
    const apiFetch = vi.fn().mockResolvedValue({ status: 'applied', message: 'ok' });

    const remediationApi = createRemediationApi(apiFetch);
    await remediationApi.applyFix(AUDIT_ID, findingWithoutLine);

    const [, requestInit] = apiFetch.mock.calls[0] as [string, RequestInit];
    const parsedBody = JSON.parse(requestInit.body as string) as Record<string, unknown>;
    expect(Object.hasOwn(parsedBody, 'lineNumber')).toBe(false);
  });

  it('forwards an AbortSignal to the transport when provided', async () => {
    const apiFetch = vi.fn().mockResolvedValue({ status: 'applied', message: 'ok' });
    const controller = new AbortController();

    const remediationApi = createRemediationApi(apiFetch);
    await remediationApi.applyFix(AUDIT_ID, SAMPLE_FINDING, { signal: controller.signal });

    const [, requestInit] = apiFetch.mock.calls[0] as [string, RequestInit];
    expect(requestInit.signal).toBe(controller.signal);
  });

  it('rejects with ApiProblemError carrying the RFC 9457 Problem on 409', async () => {
    const problem = {
      type: 'https://sentinel.dev/problems/patch-conflict',
      title: 'Patch conflict',
      status: 409,
      detail: 'File changed since the finding was generated',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(409, problem, 'application/problem+json')),
    );
    const remediationApi = createRemediationApi(createApiFetch('http://api.test'));

    await expect(remediationApi.applyFix(AUDIT_ID, SAMPLE_FINDING)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ApiProblemError &&
        error.problem.title === 'Patch conflict' &&
        error.problem.detail === 'File changed since the finding was generated',
    );
  });

  it('rejects with ApiProblemError on a 404 unknown finding', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          404,
          { type: 'https://sentinel.dev/problems/not-found', title: 'Finding not found', status: 404 },
          'application/problem+json',
        ),
      ),
    );
    const remediationApi = createRemediationApi(createApiFetch('http://api.test'));

    await expect(remediationApi.applyFix(AUDIT_ID, SAMPLE_FINDING)).rejects.toBeInstanceOf(
      ApiProblemError,
    );
  });

  it('wraps non-Problem error bodies in UnparseableProblemError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>gateway timeout</html>', { status: 502 })),
    );
    const remediationApi = createRemediationApi(createApiFetch('http://api.test'));

    await expect(remediationApi.applyFix(AUDIT_ID, SAMPLE_FINDING)).rejects.toBeInstanceOf(
      UnparseableProblemError,
    );
  });
});
