import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import * as ajvFormatsModule from 'ajv-formats';
import { Ajv, type Plugin, type ValidateFunction } from 'ajv';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { SentinelAISSEEventContract } from '@sentinel/contracts';

import eventsSchema from '../../../specs/events-schema.json' with { type: 'json' };

import { StubAuditRunner } from '../src/agent/stub-runner.js';
import { createApp } from '../src/app.js';
import { PROBLEM_CONTENT_TYPE } from '../src/lib/problems.js';
import { emitAuditEvent, resetSseHub, subscribeToAuditStream } from '../src/sse/hub.js';
import { createAudit, findAuditById, resetAuditStore, transitionAuditStatus } from '../src/store/audits.js';

/**
 * US-4 acceptance tests — `GET /api/v1/audits/{auditId}/stream` (plan §4).
 *
 * Covered invariants:
 *  - D-3: 404 Problem Details BEFORE any `text/event-stream` header;
 *  - in-order, immediate per-frame flush with monotonic ids (D-6);
 *  - every frame's `data:` payload validates against specs/events-schema.json;
 *  - concurrent subscribers receive the same sequence (fan-out);
 *  - `Last-Event-ID` resync without dupes/gaps; non-numeric resumes from end;
 *  - terminal audits replay-then-close (D-API-6) — never left open;
 *  - failure scenario: degraded event + terminal failed, never an HTTP error;
 *  - hub unit behavior: id assignment, validation of record, state driving.
 */

const API_V1 = '/api/v1';
const PROBLEM_TYPE_NOT_FOUND = 'https://sentinel.dev/problems/not-found';

const VALID_CONFIG = {
  repoUrl: 'https://github.com/example/vulnerable-app.git',
  ruleSets: { owaspTop10: true, testQuality: false, codeSmellsPerformance: false },
  severityThreshold: 'MEDIUM',
} as const;

/** Independent Ajv instance asserting every streamed frame against /specs. */
const validateAgainstSpec: ValidateFunction<SentinelAISSEEventContract> = (() => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const addFormats = ajvFormatsModule.default as unknown as Plugin<Record<string, unknown>>;
  addFormats(ajv);
  return ajv.compile<SentinelAISSEEventContract>(eventsSchema);
})();

interface CollectedFrame {
  readonly id: number;
  readonly type: string;
  readonly data: SentinelAISSEEventContract;
}

/** Parses raw SSE wire text into (id, event, data) frames (ignores retry). */
function parseSseFrames(raw: string): CollectedFrame[] {
  const frames: CollectedFrame[] = [];
  for (const block of raw.split('\n\n')) {
    if (block.trim() === '') {
      continue;
    }
    const lines = block.split('\n');
    const idLine = lines.find((line) => line.startsWith('id:'));
    const eventLine = lines.find((line) => line.startsWith('event:'));
    const dataLine = lines.find((line) => line.startsWith('data:'));
    if (idLine === undefined || eventLine === undefined || dataLine === undefined) {
      continue; // retry hint and other non-frame blocks
    }
    frames.push({
      id: Number(idLine.slice('id:'.length).trim()),
      type: eventLine.slice('event:'.length).trim(),
      data: JSON.parse(dataLine.slice('data:'.length).trim()) as SentinelAISSEEventContract,
    });
  }
  return frames;
}

/** Boots the app with an optional runner on an ephemeral port. */
function startServer(runner: StubAuditRunner = new StubAuditRunner()): { server: Server; baseUrl: string } {
  // US-4 tests the SSE channel against the deterministic fixture stub; the
  // production default runner (real LLM-backed, US-5) is exercised in
  // tests/agent.test.ts and the wiring tests in tests/audits.test.ts.
  const server = createApp({ runner }).listen(0);
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://localhost:${address.port}` };
}

async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

/** Creates an audit through POST and returns its id (runner kicks async). */
async function createAuditViaApi(server: Server): Promise<string> {
  const response = await request(server).post(`${API_V1}/audits`).send(VALID_CONFIG);
  expect(response.status).toBe(201);
  return response.body.auditId as string;
}

/** Polls the store until the audit is terminal (or times out). */
async function waitForTerminal(auditId: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const status = findAuditById(auditId)?.status;
    if (status === 'completed' || status === 'failed') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`audit ${auditId} did not reach a terminal state in time`);
}

/** Minimal valid AGENT_THOUGHT envelope for direct hub calls. */
function thoughtEnvelope(auditId: string, content: string): Omit<SentinelAISSEEventContract, 'id'> {
  return {
    type: 'AGENT_THOUGHT',
    timestamp: '2026-09-23T10:00:00.000Z',
    auditId,
    payload: { content },
  };
}

describe('US-4 — GET /api/v1/audits/:auditId/stream', () => {
  beforeEach(() => {
    resetAuditStore();
    resetSseHub();
  });

  describe('404 before headers (D-3)', () => {
    it('returns Problem Details (not event-stream) for an unknown auditId', async () => {
      const app = createApp();

      const response = await request(app).get(`${API_V1}/audits/aud_unknown000000/stream`);

      expect(response.status).toBe(404);
      expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
      expect(response.headers['content-type']).not.toContain('text/event-stream');
      expect(response.body.type).toBe(PROBLEM_TYPE_NOT_FOUND);
      expect(response.body.detail).toContain('aud_unknown000000');
    });

    it('returns 404 Problem Details for an auditId violating the pattern', async () => {
      const app = createApp();

      const response = await request(app).get(`${API_V1}/audits/not-an-id/stream`);

      expect(response.status).toBe(404);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body.type).toBe(PROBLEM_TYPE_NOT_FOUND);
    });
  });

  describe('live happy-path stream (stub runner)', () => {
    let server: Server;
    let baseUrl: string;

    beforeAll(() => {
      ({ server, baseUrl } = startServer());
    });

    afterAll(async () => {
      await stopServer(server);
    });

    /** Opens a real HTTP connection and collects SSE frames until close. */
    async function collectStream(
      path: string,
      headers: Record<string, string> = {},
    ): Promise<{
      status: number;
      headers: Record<string, string>;
      frames: CollectedFrame[];
      raw: string;
    }> {
      const response = await fetch(`${baseUrl}${path}`, { headers });
      const raw = await response.text();
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        frames: parseSseFrames(raw),
        raw,
      };
    }

    it('streams the full fixture sequence in order, ids starting at 1, then closes', async () => {
      const auditId = await createAuditViaApi(server);
      await waitForTerminal(auditId);

      const { status, headers, frames, raw } = await collectStream(
        `${API_V1}/audits/${auditId}/stream`,
      );

      expect(status).toBe(200);
      expect(headers['content-type']).toContain('text/event-stream');
      expect(headers['cache-control']).toContain('no-cache');

      // In-order delivery: ids 1..6, one per emitted fixture event.
      expect(frames.map((frame) => frame.id)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(frames.map((frame) => frame.type)).toEqual([
        'AGENT_THOUGHT',
        'TOOL_EXECUTION',
        'TOOL_EXECUTION',
        'TOOL_EXECUTION',
        'VULNERABILITY_FOUND',
        'AUDIT_COMPLETED',
      ]);

      // Wire format mirrors the contracts serializer; every payload is in-contract.
      for (const frame of frames) {
        expect(frame.data.id).toBe(frame.id);
        expect(frame.data.auditId).toBe(auditId);
        expect(validateAgainstSpec(frame.data), `frame ${frame.id} schema check`).toBe(true);
      }
      // Frames end with a blank line; the stream ends after the terminal event.
      expect(raw.endsWith('\n\n')).toBe(true);
    });

    it('delivers frames incrementally, not batched (NFR-P1 immediate flush)', async () => {
      const auditId = await createAuditViaApi(server);

      const response = await fetch(`${baseUrl}${API_V1}/audits/${auditId}/stream`);
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      if (reader === undefined) {
        return; // unreachable; narrows for the read loop below
      }

      const chunkArrivals: number[] = [];
      let bytesRead = 0;
      for (;;) {
        const read = await reader.read();
        if (read.done) {
          break;
        }
        bytesRead += read.value.length;
        chunkArrivals.push(bytesRead);
      }

      // With 10ms between events each frame is flushed in its own chunk —
      // proving per-event immediate writes, not one final batched write.
      expect(chunkArrivals.length).toBeGreaterThan(2);
    });

    it('fans the same sequence out to concurrent subscribers', async () => {
      const auditId = await createAuditViaApi(server);

      // Two clients connect while the audit is still running.
      const [firstResponse, secondResponse] = await Promise.all([
        fetch(`${baseUrl}${API_V1}/audits/${auditId}/stream`),
        fetch(`${baseUrl}${API_V1}/audits/${auditId}/stream`),
      ]);
      const [firstText, secondText] = await Promise.all([
        firstResponse.text(),
        secondResponse.text(),
      ]);

      const firstIds = parseSseFrames(firstText).map((frame) => frame.id);
      const secondIds = parseSseFrames(secondText).map((frame) => frame.id);
      expect(firstIds).toEqual([1, 2, 3, 4, 5, 6]);
      expect(secondIds).toEqual(firstIds);
    });

    it('resumes after Last-Event-ID without dupes or gaps (D-6 resync)', async () => {
      const auditId = await createAuditViaApi(server);
      await waitForTerminal(auditId);

      const { frames } = await collectStream(`${API_V1}/audits/${auditId}/stream`, {
        'Last-Event-ID': '3',
      });

      expect(frames.map((frame) => frame.id)).toEqual([4, 5, 6]);
      expect(frames.at(-1)?.type).toBe('AUDIT_COMPLETED');
    });

    it('replays the full buffer when Last-Event-ID is non-numeric (EventSource semantics)', async () => {
      const auditId = await createAuditViaApi(server);
      await waitForTerminal(auditId);

      const { frames } = await collectStream(`${API_V1}/audits/${auditId}/stream`, {
        'Last-Event-ID': 'not-a-number',
      });

      // A garbage resume point is treated as "no last id seen": the client
      // gets the full replay instead of a silent gap (safer default).
      expect(frames.map((frame) => frame.id)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('drives the session state from events (running → completed + summary)', async () => {
      const auditId = await createAuditViaApi(server);
      await waitForTerminal(auditId);

      const response = await request(server).get(`${API_V1}/audits/${auditId}`);

      expect(response.body.status).toBe('completed');
      expect(response.body.findings).toHaveLength(1);
      expect(response.body.findings[0]).toMatchObject({ ruleId: 'owasp-a03-injection' });
    });

    it('returns the 201 immediately even though execution starts async (CONCERN-002)', async () => {
      const start = Date.now();
      const response = await request(server).post(`${API_V1}/audits`).send(VALID_CONFIG);
      const elapsedMs = Date.now() - start;

      expect(response.status).toBe(201);
      // The response is not blocked by the runner's inter-event delays.
      expect(elapsedMs).toBeLessThan(200);
    });
  });

  describe('failure scenario (NFR-A3 — degradation is an event, not an HTTP error)', () => {
    let server: Server;
    let baseUrl: string;

    beforeAll(() => {
      ({ server, baseUrl } = startServer(new StubAuditRunner({ scenario: 'failure' })));
    });

    afterAll(async () => {
      await stopServer(server);
    });

    it('streams a degraded TOOL_EXECUTION then a terminal failed AUDIT_COMPLETED', async () => {
      const createResponse = await request(server).post(`${API_V1}/audits`).send(VALID_CONFIG);
      expect(createResponse.status).toBe(201);
      const auditId = createResponse.body.auditId as string;
      await waitForTerminal(auditId);

      const response = await fetch(`${baseUrl}${API_V1}/audits/${auditId}/stream`);
      const raw = await response.text();
      const frames = parseSseFrames(raw);

      // NFR-A3: the provider throttle/fallback is a normal 200-stream event.
      expect(response.status).toBe(200);
      expect(frames.map((frame) => frame.type)).toEqual([
        'AGENT_THOUGHT',
        'TOOL_EXECUTION',
        'TOOL_EXECUTION',
        'AUDIT_COMPLETED',
      ]);
      const degraded = frames[2];
      expect(degraded?.data.payload.status).toBe('degraded');
      // Terminal failed event closes the stream; error detail travels in the payload.
      const terminal = frames.at(-1);
      expect(terminal?.data.type).toBe('AUDIT_COMPLETED');
      expect(terminal?.data.payload.status).toBe('failed');
      expect(terminal?.data.payload.error).toBeTruthy();
      for (const frame of frames) {
        expect(validateAgainstSpec(frame.data)).toBe(true);
      }
    });
  });

  describe('hub unit behavior (validator of record, ASD §6.1)', () => {
    function seedAudit(): string {
      return createAudit({ config: VALID_CONFIG }).auditId;
    }

    it('assigns monotonic ids starting at 1 (D-6) and ignores caller ids', () => {
      const auditId = seedAudit();

      const first = emitAuditEvent(auditId, { ...thoughtEnvelope(auditId, 'thinking') });
      const second = emitAuditEvent(auditId, {
        ...thoughtEnvelope(auditId, 'still thinking'),
        id: 999,
      });

      expect(first?.id).toBe(1);
      expect(second?.id).toBe(2);
    });

    it('returns undefined for unknown or terminal audits', () => {
      const auditId = seedAudit();

      expect(emitAuditEvent('aud_unknown000000', thoughtEnvelope(auditId, 'orphan'))).toBeUndefined();

      transitionAuditStatus(auditId, 'running');
      const terminal = emitAuditEvent(auditId, {
        type: 'AUDIT_COMPLETED',
        timestamp: '2026-09-23T10:00:00.000Z',
        auditId,
        payload: { status: 'completed' },
      });
      expect(terminal?.type).toBe('AUDIT_COMPLETED');
      // Late emission after the terminal event is ignored (no orphan frames).
      expect(emitAuditEvent(auditId, thoughtEnvelope(auditId, 'late'))).toBeUndefined();
    });

    it('replaces a contract-violating event with a terminal failed event', () => {
      const auditId = seedAudit();
      transitionAuditStatus(auditId, 'running');

      // Missing required VULNERABILITY_FOUND payload fields → Ajv must reject.
      const rejected = emitAuditEvent(auditId, {
        type: 'VULNERABILITY_FOUND',
        timestamp: '2026-09-23T10:00:00.000Z',
        auditId,
        payload: {},
      } as unknown as Omit<SentinelAISSEEventContract, 'id'>);

      // The validator of record substituted a valid terminal failure.
      expect(rejected?.type).toBe('AUDIT_COMPLETED');
      expect(rejected?.payload.status).toBe('failed');
      expect(findAuditById(auditId)?.status).toBe('failed');

      // Replay only ever yields the terminal failure — the invalid frame is gone.
      const delivered: SentinelAISSEEventContract[] = [];
      subscribeToAuditStream(auditId, {
        onEvent: (event) => delivered.push(event),
        onClose: () => {},
      });
      expect(delivered.map((event) => event.type)).toEqual(['AUDIT_COMPLETED']);
    });

    it('returns null when subscribing to an unknown audit', () => {
      expect(
        subscribeToAuditStream('aud_unknown000000', { onEvent: () => {}, onClose: () => {} }),
      ).toBeNull();
    });
  });
});
