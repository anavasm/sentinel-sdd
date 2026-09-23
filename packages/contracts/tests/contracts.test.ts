/**
 * Contract round-trip tests (plan Task 7, AC-3 + AC-5).
 *
 * Guarantees:
 *  1. Every seed fixture validates against specs/events-schema.json (Ajv, draft-07)
 *  2. The schema REJECTS malformed events (unknown type, broken envelope, bad id)
 *  3. MSW handlers serve contract-conformant REST + SSE responses (positive + error)
 *  4. Fixture event ids are monotonic per audit (decision D-6)
 *
 * Type-level compile assurance is provided by `pnpm typecheck` (strict tsc) —
 * if any fixture drifts from the generated types, this file fails to compile.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import eventsSchema from '../../../specs/events-schema.json' with { type: 'json' };
import {
  allEventFixtures,
  happyPathAuditSequence,
  SAMPLE_AUDIT_ID,
  auditCompletedResponse,
  auditCreatedResponse,
  notFoundProblem,
  validationErrorProblem,
} from '../src/fixtures/events.ts';
import { API_BASE_URL, createAuditHandlers, serializeSseEvents } from '../src/mocks/handlers.ts';

const server = setupServer(...createAuditHandlers('happy-path'));

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const EVENTS_SCHEMA_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../specs/events-schema.json',
);

function createEventValidator(): ValidateFunction {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(eventsSchema);
}

describe('specs files are present and parseable', () => {
  it('events-schema.json is valid JSON declaring draft-07', () => {
    const raw = JSON.parse(readFileSync(EVENTS_SCHEMA_PATH, 'utf8')) as Record<string, unknown>;
    expect(raw['$schema']).toBe('http://json-schema.org/draft-07/schema#');
    expect(eventsSchema.oneOf).toBeDefined();
  });
});

describe('event fixtures validate against events-schema.json', () => {
  it('every seed fixture passes the draft-07 schema', () => {
    const validateEvent = createEventValidator();

    for (const event of allEventFixtures) {
      const isValid = validateEvent(event);
      expect(validateEvent.errors, `${event.type} fixture should validate`).toBeNull();
      expect(isValid, `${event.type} fixture should validate`).toBe(true);
    }
  });

  it('rejects an unknown event type (discriminator)', () => {
    const validateEvent = createEventValidator();
    expect(
      validateEvent({
        id: 99,
        type: 'UNKNOWN_EVENT',
        timestamp: '2026-09-23T10:00:00.000Z',
        auditId: 'aud_x',
        payload: {},
      }),
    ).toBe(false);
  });

  it('rejects an event missing required envelope fields', () => {
    const validateEvent = createEventValidator();
    expect(validateEvent({ type: 'AGENT_THOUGHT', payload: { content: 'orphan' } })).toBe(false);
  });

  it('rejects a non-integer envelope id', () => {
    const validateEvent = createEventValidator();
    expect(
      validateEvent({
        id: 'not-a-number',
        type: 'AGENT_THOUGHT',
        timestamp: '2026-09-23T10:00:00.000Z',
        auditId: 'aud_x',
        payload: {},
      }),
    ).toBe(false);
  });

  it('fixture ids are monotonic per audit (D-6)', () => {
    // allEventFixtures mixes happy-path and failed-terminal samples: both end
    // with a terminal AUDIT_COMPLETED (id 6), so only non-strict monotonicity
    // applies across the pool; the happy-path sequence is strictly increasing.
    for (let index = 1; index < allEventFixtures.length; index += 1) {
      expect(allEventFixtures[index]?.id).toBeGreaterThanOrEqual(allEventFixtures[index - 1]?.id ?? 0);
    }
    for (let index = 1; index < happyPathAuditSequence.length; index += 1) {
      expect(happyPathAuditSequence[index]?.id).toBeGreaterThan(happyPathAuditSequence[index - 1]?.id ?? 0);
    }
  });
});

describe('MSW handlers serve contract-conformant responses', () => {
  const AUDITS_URL = `${API_BASE_URL}/api/v1/audits`;

  const validAuditConfig = {
    repoUrl: 'https://github.com/example/vulnerable-app.git',
    ruleSets: { owaspTop10: true, testQuality: false, codeSmellsPerformance: true },
  };

  it('POST /audits returns 201 AuditCreated for a valid config', async () => {
    const response = await fetch(AUDITS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validAuditConfig),
    });

    expect(response.status).toBe(201);
    const created = (await response.json()) as typeof auditCreatedResponse;
    expect(created.auditId).toMatch(/^aud_/);
    expect(created.status).toBe('queued');
  });

  it('POST /audits returns 400 Problem Details when no repo source is provided', async () => {
    const response = await fetch(AUDITS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ruleSets: { owaspTop10: true } }),
    });

    expect(response.status).toBe(400);
    const problem = (await response.json()) as typeof validationErrorProblem;
    expect(problem.status).toBe(400);
    expect(problem.type).toContain('validation-error');
    expect(problem.errors?.[0]?.field).toBe('severityThreshold');
  });

  it('POST /audits returns 400 Problem Details for a rule set with zero enabled rules', async () => {
    const response = await fetch(AUDITS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validAuditConfig, ruleSets: { owaspTop10: false } }),
    });

    expect(response.status).toBe(400);
  });

  it('GET /audits/{id} returns the completed audit with findings', async () => {
    const response = await fetch(`${AUDITS_URL}/${SAMPLE_AUDIT_ID}`);

    expect(response.status).toBe(200);
    const audit = (await response.json()) as typeof auditCompletedResponse;
    expect(audit.status).toBe('completed');
    expect(audit.findings?.length).toBeGreaterThan(0);
    expect(audit.findings?.[0]?.afterSnippet).toBeTruthy();
  });

  it('GET /audits/{id} returns 404 Problem Details for an unknown id', async () => {
    const response = await fetch(`${AUDITS_URL}/aud_unknown999`);

    expect(response.status).toBe(404);
    const problem = (await response.json()) as typeof notFoundProblem;
    expect(problem.status).toBe(404);
  });

  it('GET /stream returns text/event-stream with schema-valid frames', async () => {
    const response = await fetch(`${AUDITS_URL}/${SAMPLE_AUDIT_ID}/stream`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');

    const raw = await response.text();
    const dataLines = raw
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice('data: '.length));

    const validateEvent = createEventValidator();
    expect(dataLines.length).toBeGreaterThan(0);
    for (const line of dataLines) {
      const event = JSON.parse(line) as unknown;
      expect(validateEvent(event), `SSE frame must validate: ${line}`).toBe(true);
    }
  });

  it('GET /stream returns 404 (not event-stream) for an unknown id', async () => {
    const response = await fetch(`${AUDITS_URL}/aud_unknown999/stream`);

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).not.toBe('text/event-stream');
    const problem = (await response.json()) as typeof notFoundProblem;
    expect(problem.status).toBe(404);
  });

  it('failed-audit scenario ends the stream with a terminal failed event', async () => {
    server.use(...createAuditHandlers('failed-audit'));

    const response = await fetch(`${AUDITS_URL}/${SAMPLE_AUDIT_ID}/stream`);
    const raw = await response.text();
    const lastDataLine = raw
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice('data: '.length))
      .at(-1);
    expect(lastDataLine).toBeDefined();

    const terminalEvent = JSON.parse(lastDataLine ?? '{}') as {
      type: string;
      payload: { status: string };
    };
    expect(terminalEvent.type).toBe('AUDIT_COMPLETED');
    expect(terminalEvent.payload.status).toBe('failed');
  });
});

describe('SSE wire format', () => {
  it('serializeSseEvents emits id/event/data frames plus retry', () => {
    const wire = serializeSseEvents(allEventFixtures);
    expect(wire).toMatch(/^id: 1\nevent: AGENT_THOUGHT\ndata: /);
    expect(wire.endsWith('retry: 5000\n')).toBe(true);
    expect(wire.match(/^data: /gm)?.length).toBe(allEventFixtures.length);
  });
});
