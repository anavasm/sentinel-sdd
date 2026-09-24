import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';

describe('US-1 scaffolding — app boots and serves /api/v1', () => {
  it('responds 200 with a JSON health payload on GET /api/v1/health', async () => {
    const app = createApp();

    const response = await request(app).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('does not expose the x-powered-by header', async () => {
    const app = createApp();

    const response = await request(app).get('/api/v1/health');

    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('returns the Express default 404 for unknown /api/v1 routes (US-2 adds Problem Details)', async () => {
    const app = createApp();

    const response = await request(app).get('/api/v1/audits');

    expect(response.status).toBe(404);
  });
});
