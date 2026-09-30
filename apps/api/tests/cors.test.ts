/**
 * CORS integration tests: preflight OPTIONS must return 204 with the requested
 * origin reflected for allowlisted MFE dev servers (5173/5174/5175) and no
 * Access-Control-Allow-Origin for foreign origins; actual requests carry the
 * header as well.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
] as const;

describe('CORS — preflight requests', () => {
  it.each(ALLOWED_ORIGINS)(
    'returns 204 preflight with Access-Control-Allow-Origin for %s',
    async (allowedOrigin) => {
      const app = createApp({ runner: null });

      const response = await request(app)
        .options('/api/v1/audits')
        .set('Origin', allowedOrigin)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type');

      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe(allowedOrigin);
      expect(response.headers['access-control-allow-methods']).toContain('POST');
      expect(response.headers['access-control-allow-headers'] ?? '').toContain('Last-Event-ID');
    },
  );

  it('permits all required request headers in the preflight response', async () => {
    const app = createApp({ runner: null });

    const response = await request(app)
      .options('/api/v1/audits')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type, Accept, Last-Event-ID');

    const allowHeaders = (response.headers['access-control-allow-headers'] ?? '').toLowerCase();
    expect(allowHeaders).toContain('content-type');
    expect(allowHeaders).toContain('accept');
    expect(allowHeaders).toContain('last-event-id');
  });

  it('withholds Access-Control-Allow-Origin from foreign origins', async () => {
    const app = createApp({ runner: null });

    const response = await request(app)
      .options('/api/v1/audits')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'POST');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('CORS — actual cross-origin requests', () => {
  it('stamps Access-Control-Allow-Origin on allowed GET requests', async () => {
    const app = createApp({ runner: null });

    const response = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:5174');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5174');
  });

  it('omits Access-Control-Allow-Origin on GET requests from disallowed origins', async () => {
    const app = createApp({ runner: null });

    const response = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'https://evil.example.com');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers OPTIONS preflight for the SSE stream route', async () => {
    const app = createApp({ runner: null });

    const response = await request(app)
      .options('/api/v1/audits/some-audit-id/events')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'Accept, Last-Event-ID');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});
