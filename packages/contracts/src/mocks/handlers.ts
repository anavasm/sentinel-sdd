/**
 * MSW v2 mock handlers aligned 1:1 with specs/openapi.yaml (ASD §10.2 — mocks
 * live alongside contracts so drift is impossible).
 *
 * Covers positive and error scenarios:
 *  - POST /api/v1/audits          → 201 AuditCreated | 400 Problem Details
 *  - GET  /api/v1/audits/{id}     → 200 Audit | 404 Problem Details
 *  - GET  /api/v1/audits/{id}/stream → 200 text/event-stream | 404 before headers (D-3)
 */
import { http, HttpResponse, type HttpHandler } from 'msw';

import {
  allEventFixtures,
  SAMPLE_AUDIT_ID,
  auditCompletedResponse,
  auditCreatedResponse,
  happyPathAuditSequence,
  notFoundProblem,
  validationErrorProblem,
} from '../fixtures/events.ts';
import type { Audit } from '../index.ts';

/** Base URL matching the `servers` entry in specs/openapi.yaml. */
export const API_BASE_URL = 'http://localhost:3000';
const AUDITS_PATH = '/api/v1/audits';

/** Audit ids the mock backend knows — anything else returns 404. */
const KNOWN_AUDIT_IDS: ReadonlySet<string> = new Set([SAMPLE_AUDIT_ID]);

/** Scenarios selectable for GET/stream mocks. */
export type MockScenario = 'happy-path' | 'failed-audit';

/** Per-audit GET/stream response for the failed-terminal scenario. */
const auditFailedResponse: Audit = {
  auditId: SAMPLE_AUDIT_ID,
  status: 'failed',
  config: {
    repoUrl: 'https://github.com/example/vulnerable-app.git',
    ruleSets: { owaspTop10: true, testQuality: false, codeSmellsPerformance: true },
    severityThreshold: 'MEDIUM',
  },
  createdAt: '2026-09-23T10:00:00.000Z',
  findings: [],
};

/**
 * Serializes contract events into SSE wire format; each envelope `id` doubles
 * as the SSE `id:` field for Last-Event-ID resync (decision D-6).
 */
export function serializeSseEvents(
  events: readonly { id: number; type?: string }[],
): string {
  const frames = events
    .map(
      (event) =>
        `id: ${event.id}\nevent: ${event.type ?? 'message'}\ndata: ${JSON.stringify(event)}\n\n`,
    )
    .join('');
  return `${frames}retry: 5000\n`;
}

/** Builds an SSE `HttpResponse` (event-stream headers, fixture body). */
export function buildSseResponse(
  events: readonly { id: number; type?: string }[],
): HttpResponse<string> {
  return new HttpResponse(serializeSseEvents(events), {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

/**
 * Builds MSW handlers for the 3 REST routes. Select a `scenario` to switch the
 * GET/stream + GET/{id} responses between the happy path and a failed audit.
 */
export function createAuditHandlers(scenario: MockScenario = 'happy-path'): HttpHandler[] {
  const auditResource: Audit = scenario === 'failed-audit' ? auditFailedResponse : auditCompletedResponse;
  const streamEvents = scenario === 'failed-audit' ? [...allEventFixtures] : happyPathAuditSequence;

  return [
    // POST /api/v1/audits — rejects a missing repo source or a rule set with
    // zero enabled rules (plan §3.2 edge cases); accepts everything else.
    http.post(`${API_BASE_URL}${AUDITS_PATH}`, async ({ request }) => {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

      if (body === null) {
        return HttpResponse.json(validationErrorProblem, { status: 400 });
      }

      const hasRepoSource =
        typeof body.repoUrl === 'string' || typeof body.localPath === 'string';
      const ruleSets = body.ruleSets as Record<string, boolean> | undefined;
      const hasEnabledRule = ruleSets !== undefined && Object.values(ruleSets).some(Boolean);

      if (!hasRepoSource || !hasEnabledRule) {
        return HttpResponse.json(validationErrorProblem, { status: 400 });
      }

      return HttpResponse.json(auditCreatedResponse, { status: 201 });
    }),

    // GET /api/v1/audits/{auditId} — completed audit returns findings;
    // unknown id returns 404 Problem Details.
    http.get(`${API_BASE_URL}${AUDITS_PATH}/:auditId`, ({ params }) => {
      const auditId = params.auditId;
      if (typeof auditId !== 'string' || auditId !== SAMPLE_AUDIT_ID) {
        return HttpResponse.json(notFoundProblem, { status: 404 });
      }
      return HttpResponse.json(auditResource);
    }),

    // GET /api/v1/audits/{auditId}/stream — 404 BEFORE any event-stream header
    // is set (D-3); known ids replay the deterministic fixture sequence.
    http.get(`${API_BASE_URL}${AUDITS_PATH}/:auditId/stream`, ({ params }) => {
      const auditId = params.auditId;
      if (typeof auditId !== 'string' || auditId !== SAMPLE_AUDIT_ID) {
        return HttpResponse.json(notFoundProblem, { status: 404 });
      }
      return buildSseResponse(streamEvents);
    }),
  ];
}

/** Convenience export: default happy-path handlers. */
export const auditHandlers: HttpHandler[] = createAuditHandlers();
