import { access } from 'node:fs/promises';

import type { RequestHandler } from 'express';

import type { AuditConfig } from '@sentinel/contracts';

import type { AuditRunner } from '../agent/runner.js';
import { buildProblem, ProblemError, ProblemType } from '../lib/problems.js';
import { validateAuditConfig } from '../lib/validators.js';
import { AUDIT_ID_PATTERN, createAudit, findAuditById } from '../store/audits.js';
import { parseLastEventId, subscribeToAuditStream } from '../sse/hub.js';
import { serializeSseFrame, serializeSseRetryHint, SSE_RESPONSE_HEADERS } from '../sse/serializer.js';

/**
 * `POST /api/v1/audits` controller (plan US-2, Task 2.3 + US-4 Task 4.5).
 *
 * Fail-fast validation order: body size (413, enforced by the JSON parser),
 * Ajv `AuditConfig` validation (400), `localPath` existence via fs/promises
 * (400 — never deferred to the agent runtime). Success persists an audit in
 * `queued` state, responds `201 AuditCreated`, and hands the audit id to the
 * configured runner (kicked asynchronously via `setImmediate` — the HTTP
 * response is never blocked). `runner === null` disables execution (tests).
 */

/** Ajv instancePath → openapi `errors[].field` (root-level errors map to 'body'). */
function ajvErrorToDetail(instancePath: string, message: string): { field: string; message: string } {
  return {
    field: instancePath === '' ? 'body' : instancePath.replace(/^\//, ''),
    message,
  };
}

export function createAuditHandler(runner: AuditRunner | null): RequestHandler {
  return async (req, res, next) => {
    try {
      const config: unknown = req.body;
      if (!validateAuditConfig(config)) {
        const ajvErrors = validateAuditConfig.errors ?? [];
        throw new ProblemError(
          buildProblem(400, ProblemType.VALIDATION_ERROR, {
            detail: 'Request body does not conform to the AuditConfig schema.',
            errors: ajvErrors.map((ajvError) =>
              ajvErrorToDetail(ajvError.instancePath ?? '', ajvError.message ?? 'is invalid'),
            ),
          }),
        );
      }

      // Narrowed by the Ajv type guard: `config` is AuditConfig here.
      const validatedConfig: AuditConfig = config;
      if (validatedConfig.localPath !== undefined) {
        const pathExists = await pathIsAccessible(validatedConfig.localPath);
        if (!pathExists) {
          throw new ProblemError(
            buildProblem(400, ProblemType.VALIDATION_ERROR, {
              detail: 'The local repository path does not exist or is not accessible.',
              errors: [
                {
                  field: 'localPath',
                  message: 'path does not exist or is not accessible',
                },
              ],
            }),
          );
        }
      }

      const audit = createAudit({ config: validatedConfig });

      // Async kickoff (US-4): the runner schedules itself via `setImmediate`,
      // so the 201 response is already on the wire before any event is emitted.
      if (runner !== null) {
        runner.run(audit.auditId);
      }

      res.status(201).json({ auditId: audit.auditId, status: audit.status });
    } catch (error) {
      next(error);
    }
  };
}

async function pathIsAccessible(localPath: string): Promise<boolean> {
  try {
    await access(localPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * `GET /api/v1/audits/:auditId` controller (plan US-3, Task 3.2).
 *
 * Path param is validated against the openapi `auditId` pattern first
 * (ids violating `^aud_[0-9a-zA-Z]+$` can never exist in the store), then
 * looked up. Responds `200 Audit` (config echo, RFC 3339 createdAt,
 * findings accumulated so far, summary once terminal) or `404` Problem
 * Details with type `not-found` — never an empty 200.
 */
export const getAuditHandler: RequestHandler = (req, res, next) => {
  try {
    // Under `noUncheckedIndexedAccess` the params record may be typed loose;
    // the route is always matched with `:auditId`, so default to ''.
    const auditId = req.params.auditId ?? '';
    if (!AUDIT_ID_PATTERN.test(auditId)) {
      throw notFoundProblem(
        `Audit id '${auditId}' does not match the required pattern ^aud_[0-9a-zA-Z]+$.`,
      );
    }

    const audit = findAuditById(auditId);
    if (audit === undefined) {
      throw notFoundProblem(`No audit session found with id '${auditId}'.`);
    }

    res.status(200).json(audit);
  } catch (error) {
    next(error);
  }
};

function notFoundProblem(detail: string): ProblemError {
  return new ProblemError(buildProblem(404, ProblemType.NOT_FOUND, { detail }));
}

/**
 * `GET /api/v1/audits/:auditId/stream` controller (plan US-4, Tasks 4.3-4.4).
 *
 * D-3: the 404 Problem Details response is resolved BEFORE any
 * `text/event-stream` header is set — unknown ids and pattern violations
 * never open an event stream. For known audits the SSE headers are set, the
 * `retry:` hint is written once, buffered events after the `Last-Event-ID`
 * cursor are replayed, and the connection stays open for live events until
 * the terminal AUDIT_COMPLETED closes it (D-API-6). Already-finished audits
 * replay their buffer, deliver the terminal event, and close immediately.
 */
export const streamAuditHandler: RequestHandler = (req, res, next) => {
  try {
    const auditId = req.params.auditId ?? '';

    // 404 first (D-3): no text/event-stream header may precede this response.
    if (!AUDIT_ID_PATTERN.test(auditId)) {
      throw notFoundProblem(
        `Audit id '${auditId}' does not match the required pattern ^aud_[0-9a-zA-Z]+$.`,
      );
    }
    if (findAuditById(auditId) === undefined) {
      throw notFoundProblem(`No audit session found with id '${auditId}'.`);
    }

    // Known audit — open the SSE channel.
    res.writeHead(200, SSE_RESPONSE_HEADERS);
    res.write(serializeSseRetryHint());

    const rawLastEventId = req.headers['last-event-id'];
    const lastEventIdHeader = Array.isArray(rawLastEventId) ? rawLastEventId[0] : rawLastEventId;
    const lastEventId = parseLastEventId(lastEventIdHeader);

    const subscription = subscribeToAuditStream(
      auditId,
      {
        onEvent(event) {
          res.write(serializeSseFrame(event));
        },
        onClose() {
          res.end();
        },
      },
      { lastEventId },
    );

    if (subscription === null) {
      // Defense in depth: the 404 above already filtered unknown ids.
      if (!res.writableEnded) {
        res.end();
      }
      return;
    }

    // Stop the hub from writing into a closed socket.
    req.on('close', () => {
      subscription.unsubscribe();
    });
  } catch (error) {
    next(error);
  }
};
