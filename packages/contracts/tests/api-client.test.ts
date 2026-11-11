import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ApiProblemError,
  createApiFetch,
  UnparseableProblemError,
} from '../src/api-client.ts';

describe('shared API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns JSON for a successful response and preserves request headers', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ auditId: 'aud_123' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await createApiFetch('http://localhost/api')<{ auditId: string }>('/audits');

    expect(result).toEqual({ auditId: 'aud_123' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost/api/audits',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  it('normalizes an RFC 9457 error response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      type: 'https://sentinel.dev/problems/not-found',
      title: 'Audit not found',
      status: 404,
    }), { status: 404 })));

    await expect(createApiFetch('http://localhost/api')('/audits/aud_missing'))
      .rejects.toMatchObject({
        constructor: ApiProblemError,
        problem: { status: 404 },
      });
  });

  it('reports an unparseable error body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not-json', { status: 502 })));

    await expect(createApiFetch('http://localhost/api')('/audits'))
      .rejects.toMatchObject({
        constructor: UnparseableProblemError,
        status: 502,
      });
  });

  it('rejects a non-Problem JSON error body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'bad gateway' }), {
      status: 502,
    })));

    await expect(createApiFetch('http://localhost/api')('/audits'))
      .rejects.toMatchObject({
        constructor: UnparseableProblemError,
        status: 502,
      });
  });
});
