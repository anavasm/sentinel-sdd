import { readFileSync } from 'node:fs';

import { Ajv } from 'ajv';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { createApp } from '../src/app.js';

describe('US-1 scaffolding — app boots and serves /api/v1', () => {
  it('responds 200 with a JSON health payload on GET /api/v1/health', async () => {
    const app = createApp();

    const response = await request(app).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('conforms to the internal OpenAPI health response schema', async () => {
    const specification = parseYaml(
      readFileSync(new URL('../../../specs/openapi.yaml', import.meta.url), 'utf8'),
    ) as {
      servers: { url: string }[];
      paths: {
        '/health': {
          get: {
            'x-internal': boolean;
            responses: {
              '200': {
                content: { 'application/json': { schema: object } };
              };
            };
          };
        };
      };
    };
    const operation = specification.paths['/health'].get;
    const schema = operation.responses['200'].content['application/json'].schema;
    const validate = new Ajv({ allErrors: true }).compile(schema);
    const response = await request(createApp()).get('/api/v1/health');

    expect(new URL(specification.servers[0]?.url ?? '').pathname).toBe('/api/v1');
    expect(operation['x-internal']).toBe(true);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(validate(response.body), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({})).toBe(false);
    expect(validate({ status: 'unavailable' })).toBe(false);
    expect(validate({ status: 'ok', extra: true })).toBe(false);
  });

  it('does not expose the x-powered-by header', async () => {
    const app = createApp();

    const response = await request(app).get('/api/v1/health');

    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('returns RFC 9457 Problem Details for unknown /api/v1 routes (US-2 central handler)', async () => {
    const app = createApp();

    const response = await request(app).get('/api/v1/unknown');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body.status).toBe(404);
  });
});
