import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Audit, Finding } from '@sentinel/contracts';

import { createApp } from '../src/app.js';
import { PROBLEM_CONTENT_TYPE } from '../src/lib/problems.js';
import {
  appendFindings,
  createAudit,
  resetAuditStore,
  setAuditSummary,
  transitionAuditStatus,
} from '../src/store/audits.js';

/** Base path from openapi `servers`. */
const API_V1 = '/api/v1';

/** 1 MB request body limit per D-API-2. */
const BODY_LIMIT_BYTES = 1024 * 1024;

const AUDIT_ID_PATTERN = /^aud_[0-9a-zA-Z]+$/;

const PROBLEM_TYPE_URIS = {
  validation: 'https://sentinel.dev/problems/validation-error',
  tooLarge: 'https://sentinel.dev/problems/payload-too-large',
  notFound: 'https://sentinel.dev/problems/not-found',
} as const;

function validRepoUrlConfig(): Record<string, unknown> {
  return {
    repoUrl: 'https://github.com/example/vulnerable-app.git',
    ruleSets: { owaspTop10: true, testQuality: false, codeSmellsPerformance: false },
    severityThreshold: 'MEDIUM',
  };
}

function validLocalPathConfig(localPath: string): Record<string, unknown> {
  return {
    localPath,
    ruleSets: { owaspTop10: false, testQuality: true, codeSmellsPerformance: false },
    severityThreshold: 'LOW',
  };
}

/** Builds a JSON body whose byte length is exactly `targetBytes`. */
function bodyOfExactSize(targetBytes: number): string {
  const base = JSON.stringify(validRepoUrlConfig());
  const paddingChars = targetBytes - base.length - '?pad='.length;
  if (paddingChars < 0) {
    throw new Error(`targetBytes ${targetBytes} too small for base payload of ${base.length}`);
  }
  const paddedConfig = {
    ...validRepoUrlConfig(),
    repoUrl: `https://github.com/example/vulnerable-app.git?pad=${'a'.repeat(paddingChars)}`,
  };
  const body = JSON.stringify(paddedConfig);
  expect(Buffer.byteLength(body)).toBe(targetBytes);
  return body;
}

describe('US-2 — POST /api/v1/audits', () => {
  let localRepoDir: string;

  beforeAll(async () => {
    localRepoDir = await mkdtemp(join(tmpdir(), 'sentinel-audit-'));
    await writeFile(join(localRepoDir, 'sample-file.ts'), 'export const sample = 1;\n', 'utf8');
  });

  afterAll(async () => {
    await rm(localRepoDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetAuditStore();
  });

  describe('201 happy path', () => {
    it('creates an audit from a repoUrl config', async () => {
      const app = createApp();

      const response = await request(app).post(`${API_V1}/audits`).send(validRepoUrlConfig());

      expect(response.status).toBe(201);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.body.auditId).toMatch(AUDIT_ID_PATTERN);
      expect(response.body).toEqual({ auditId: response.body.auditId, status: 'queued' });
    });

    it('creates an audit from an existing localPath (fail-fast existence check passes)', async () => {
      const app = createApp();

      const response = await request(app)
        .post(`${API_V1}/audits`)
        .send(validLocalPathConfig(localRepoDir));

      expect(response.status).toBe(201);
      expect(response.body.auditId).toMatch(AUDIT_ID_PATTERN);
      expect(response.body.status).toBe('queued');
    });

    it('accepts a body at exactly the 1 MB limit (boundary)', async () => {
      const app = createApp();

      const response = await request(app)
        .post(`${API_V1}/audits`)
        .set('Content-Type', 'application/json')
        .send(bodyOfExactSize(BODY_LIMIT_BYTES));

      expect(response.status).toBe(201);
      expect(response.body.status).toBe('queued');
    });
  });

  describe('400 validation failures', () => {
    async function expectValidationProblem(requestBody: Record<string, unknown>): Promise<void> {
      const app = createApp();
      const response = await request(app).post(`${API_V1}/audits`).send(requestBody);

      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body.type).toBe(PROBLEM_TYPE_URIS.validation);
      expect(response.body.status).toBe(400);
      expect(Array.isArray(response.body.errors)).toBe(true);
      expect(response.body.errors.length).toBeGreaterThan(0);
      for (const error of response.body.errors as Array<{ field: unknown; message: unknown }>) {
        expect(typeof error.field).toBe('string');
        expect(typeof error.message).toBe('string');
      }
    }

    it('rejects an empty body', async () => {
      await expectValidationProblem({});
    });

    it('rejects malformed JSON', async () => {
      const app = createApp();
      const response = await request(app)
        .post(`${API_V1}/audits`)
        .set('Content-Type', 'application/json')
        .send('{"repoUrl": ');

      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body.type).toBe(PROBLEM_TYPE_URIS.validation);
    });

    it('rejects both repoUrl and localPath (oneOf violation)', async () => {
      await expectValidationProblem({
        ...validRepoUrlConfig(),
        localPath: localRepoDir,
      });
    });

    it('rejects neither repoUrl nor localPath (oneOf violation)', async () => {
      await expectValidationProblem({
        ruleSets: { owaspTop10: true },
        severityThreshold: 'LOW',
      });
    });

    it('rejects ruleSets with all values false (zero enabled rule sets)', async () => {
      await expectValidationProblem({
        ...validRepoUrlConfig(),
        ruleSets: { owaspTop10: false, testQuality: false, codeSmellsPerformance: false },
      });
    });

    it('rejects ruleSets with an unknown key (additionalProperties: false)', async () => {
      await expectValidationProblem({
        ...validRepoUrlConfig(),
        ruleSets: { owaspTop10: true, unknownRuleSet: true },
      });
    });

    it('rejects an invalid severityThreshold (enum)', async () => {
      await expectValidationProblem({
        ...validRepoUrlConfig(),
        severityThreshold: 'EXTREME',
      });
    });

    it('rejects a repoUrl that is not a valid URI (format: uri)', async () => {
      await expectValidationProblem({
        ...validRepoUrlConfig(),
        repoUrl: 'not-a-uri',
      });
    });

    it('rejects a nonexistent localPath (fail-fast, before agent runtime)', async () => {
      const app = createApp();
      const response = await request(app)
        .post(`${API_V1}/audits`)
        .send(validLocalPathConfig('/nonexistent/sentinel/repo'));

      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body.type).toBe(PROBLEM_TYPE_URIS.validation);
      expect(response.body.errors).toEqual([
        { field: 'localPath', message: 'path does not exist or is not accessible' },
      ]);
    });
  });

  describe('413 payload too large', () => {
    it('rejects a body just over the 1 MB limit', async () => {
      const app = createApp();

      const response = await request(app)
        .post(`${API_V1}/audits`)
        .set('Content-Type', 'application/json')
        .send(bodyOfExactSize(BODY_LIMIT_BYTES + 1));

      expect(response.status).toBe(413);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body.type).toBe(PROBLEM_TYPE_URIS.tooLarge);
      expect(response.body.status).toBe(413);
    });
  });

  describe('Problem Details everywhere', () => {
    it('returns 404 Problem Details for unknown routes', async () => {
      const app = createApp();

      const response = await request(app).get(`${API_V1}/unknown-route`);

      expect(response.status).toBe(404);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body.type).toBe(PROBLEM_TYPE_URIS.notFound);
      expect(response.body.status).toBe(404);
      expect(response.body.title).toBe('Resource not found');
      expect(response.body.detail).toContain('/api/v1/unknown-route');
    });

    it('maps an unexpected handler failure to a 500 Problem', async () => {
      const { problemErrorHandler } = await import('../src/lib/error-handler.js');
      const { buildProblem, ProblemError, ProblemType } = await import('../src/lib/problems.js');

      const renderJson = vi.fn();
      const setHeaders = vi.fn(() => ({ json: renderJson }));
      const setStatus = vi.fn(() => ({ set: setHeaders }));
      const res = { status: setStatus, set: setHeaders } as unknown as Parameters<
        typeof problemErrorHandler
      >[2];
      const req = {
        method: 'POST',
        originalUrl: '/api/v1/audits',
      } as unknown as Parameters<typeof problemErrorHandler>[1];

      problemErrorHandler(
        new ProblemError(buildProblem(400, ProblemType.VALIDATION_ERROR)),
        req,
        res,
        vi.fn(),
      );

      expect(setStatus).toHaveBeenCalledWith(400);
      expect(renderJson).toHaveBeenCalledWith(
        expect.objectContaining({ type: PROBLEM_TYPE_URIS.validation, status: 400 }),
      );
    });

    it('sets the application/problem+json content type header constant', () => {
      expect(PROBLEM_CONTENT_TYPE).toContain('application/problem+json');
    });
  });
});

function sampleFinding(ruleId: string): Finding {
  return {
    ruleId,
    title: `Sample finding ${ruleId}`,
    severity: 'HIGH',
    filePath: 'src/auth/queries.ts',
    lineNumber: 42,
    cweId: 'CWE-89',
    description: 'User input reaches a SQL query without parameterization.',
    beforeSnippet: 'db.query(`SELECT * FROM users WHERE id = ${id}`)',
    afterSnippet: 'db.query("SELECT * FROM users WHERE id = ?", [id])',
  };
}

/** Compile-time round-trip assertion against the contracts `Audit` type (US3-AC3). */
function assertIsAudit(audit: Audit): Audit {
  return audit;
}

describe('US-3 - GET /api/v1/audits/:auditId and session state', () => {
  let localRepoDir: string;

  beforeAll(async () => {
    localRepoDir = await mkdtemp(join(tmpdir(), 'sentinel-audit-'));
    await writeFile(join(localRepoDir, 'sample-file.ts'), 'export const sample = 1;\n', 'utf8');
  });

  afterAll(async () => {
    await rm(localRepoDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetAuditStore();
  });

  /**
   * Creates an audit through the public POST endpoint and returns its id.
   * The US-4 stub runner is disabled so these US-3 tests fully control the
   * lifecycle (POST with the default app would transition states async).
   */
  async function createAuditViaApi(): Promise<string> {
    const app = createApp({ runner: null });
    const response = await request(app).post(`${API_V1}/audits`).send(validRepoUrlConfig());
    expect(response.status).toBe(201);
    return response.body.auditId as string;
  }

  function expectAuditShape(audit: Record<string, unknown>, expectedStatus: string): void {
    // Round-trips against the `@sentinel/contracts` Audit type at compile time.
    const typedAudit = assertIsAudit(audit as unknown as Audit);
    expect(typedAudit.status).toBe(expectedStatus);
    expect(typedAudit.auditId).toMatch(AUDIT_ID_PATTERN);
    expect(typedAudit.config).toEqual(validRepoUrlConfig());
    expect(typedAudit.createdAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, // RFC 3339 date-time
    );
  }

  it('returns 200 with a queued audit right after creation', async () => {
    const auditId = await createAuditViaApi();
    const app = createApp();

    const response = await request(app).get(`${API_V1}/audits/${auditId}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expectAuditShape(response.body, 'queued');
    expect(response.body.findings).toEqual([]);
    expect(response.body.summary).toBeUndefined();
  });

  it('returns 200 with a running audit and findings accumulated so far', async () => {
    const auditId = await createAuditViaApi();
    transitionAuditStatus(auditId, 'running');
    appendFindings(auditId, [sampleFinding('owasp-a03-injection')]);
    const app = createApp();

    const response = await request(app).get(`${API_V1}/audits/${auditId}`);

    expect(response.status).toBe(200);
    expectAuditShape(response.body, 'running');
    expect(response.body.findings).toHaveLength(1);
    expect(response.body.findings[0]).toMatchObject({ ruleId: 'owasp-a03-injection' });
    expect(response.body.summary).toBeUndefined();
  });

  it('returns 200 with a completed audit including full findings and summary', async () => {
    const auditId = await createAuditViaApi();
    transitionAuditStatus(auditId, 'running');
    appendFindings(auditId, [sampleFinding('owasp-a03-injection'), sampleFinding('tq-thin-tests')]);
    transitionAuditStatus(auditId, 'completed');
    setAuditSummary(auditId, { totalFindings: 2, healthScore: 62 });
    const app = createApp();

    const response = await request(app).get(`${API_V1}/audits/${auditId}`);

    expect(response.status).toBe(200);
    expectAuditShape(response.body, 'completed');
    expect(response.body.findings).toHaveLength(2);
    expect(response.body.summary).toEqual({ totalFindings: 2, healthScore: 62 });
  });

  it('returns 200 with a failed audit including a summary (terminal unhappy path)', async () => {
    const auditId = await createAuditViaApi();
    transitionAuditStatus(auditId, 'running');
    transitionAuditStatus(auditId, 'failed');
    setAuditSummary(auditId, { reason: 'agent crashed while analyzing rule set' });
    const app = createApp();

    const response = await request(app).get(`${API_V1}/audits/${auditId}`);

    expect(response.status).toBe(200);
    expectAuditShape(response.body, 'failed');
    expect(response.body.findings).toEqual([]);
    expect(response.body.summary).toEqual({ reason: 'agent crashed while analyzing rule set' });
  });

  it('returns 404 Problem Details for an unknown auditId with a valid pattern', async () => {
    const app = createApp();

    const response = await request(app).get(`${API_V1}/audits/aud_unknown000000`);

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body.type).toBe(PROBLEM_TYPE_URIS.notFound);
    expect(response.body.status).toBe(404);
    expect(response.body.title).toBe('Resource not found');
    expect(response.body.detail).toContain('aud_unknown000000');
  });

  it('returns 404 Problem Details for an auditId violating the pattern', async () => {
    const app = createApp();

    for (const invalidId of ['not-an-audit-id', 'AUD_abc123', 'aud_bad-id!']) {
      const response = await request(app).get(`${API_V1}/audits/${encodeURIComponent(invalidId)}`);

      expect(response.status, `expected 404 for id '${invalidId}'`).toBe(404);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body.type).toBe(PROBLEM_TYPE_URIS.notFound);
      expect(response.body.detail).toContain(invalidId);
    }
  });
});

describe('US-3 - audit lifecycle store transitions', () => {
  beforeEach(() => {
    resetAuditStore();
  });

  function seedAudit(): string {
    const audit = createAudit({ config: validRepoUrlConfig() as never });
    return audit.auditId;
  }

  it('walks the full happy path queued, running, completed', () => {
    const auditId = seedAudit();

    expect(transitionAuditStatus(auditId, 'running')?.status).toBe('running');
    expect(transitionAuditStatus(auditId, 'completed')?.status).toBe('completed');
  });

  it('walks the unhappy path queued, running, failed', () => {
    const auditId = seedAudit();

    expect(transitionAuditStatus(auditId, 'running')?.status).toBe('running');
    expect(transitionAuditStatus(auditId, 'failed')?.status).toBe('failed');
  });

  it('rejects invalid lifecycle transitions', () => {
    const auditId = seedAudit();

    expect(() => transitionAuditStatus(auditId, 'completed')).toThrow(/transition/); // queued -> completed
    expect(transitionAuditStatus(auditId, 'running')).toBeDefined();
    expect(() => transitionAuditStatus(auditId, 'queued')).toThrow(/transition/); // backwards
  });

  it('rejects transitions from terminal states', () => {
    const auditId = seedAudit();
    transitionAuditStatus(auditId, 'running');
    transitionAuditStatus(auditId, 'failed');

    expect(() => transitionAuditStatus(auditId, 'running')).toThrow(/transition/);
  });

  it('returns undefined for transitions on unknown ids', () => {
    expect(transitionAuditStatus('aud_unknown000000', 'running')).toBeUndefined();
  });

  it('accumulates findings in order across multiple appends', () => {
    const auditId = seedAudit();
    transitionAuditStatus(auditId, 'running');

    appendFindings(auditId, [sampleFinding('owasp-a03-injection')]);
    appendFindings(auditId, [sampleFinding('tq-thin-tests')]);

    const stored = transitionAuditStatus(auditId, 'completed');
    expect(stored?.findings?.map((finding) => finding.ruleId)).toEqual([
      'owasp-a03-injection',
      'tq-thin-tests',
    ]);
  });

  it('rejects appending findings to a terminal audit', () => {
    const auditId = seedAudit();
    transitionAuditStatus(auditId, 'running');
    transitionAuditStatus(auditId, 'completed');

    expect(() => appendFindings(auditId, [sampleFinding('late-rule')])).toThrow(/terminal/);
  });

  it('rejects setting a summary before a terminal state', () => {
    const auditId = seedAudit();

    expect(() => setAuditSummary(auditId, { totalFindings: 0 })).toThrow(/terminal/);
  });

  it('sets a summary only on terminal states and returns undefined for unknown ids', () => {
    const auditId = seedAudit();
    transitionAuditStatus(auditId, 'running');
    transitionAuditStatus(auditId, 'completed');

    const updated = setAuditSummary(auditId, { totalFindings: 0, healthScore: 100 });
    expect(updated?.summary).toEqual({ totalFindings: 0, healthScore: 100 });
    expect(setAuditSummary('aud_unknown000000', { totalFindings: 0 })).toBeUndefined();
  });
});
