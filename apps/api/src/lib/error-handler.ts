import type { ErrorRequestHandler, Request, Response } from 'express';

import { buildProblem, ProblemError, ProblemType, sendProblem } from './problems.js';

/**
 * Central error handler (D-API-5) — single exit point rendering RFC 9457
 * Problem Details for every REST failure:
 *   - body-parser overflow (`entity.too.large`)   → 413 payload-too-large
 *   - body-parser malformed JSON (SyntaxError)    → 400 validation-error
 *   - ProblemError (validation / not-found, …)    → its embedded problem
 *   - anything else                               → 500 internal-error
 */
export const problemErrorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (isPayloadTooLarge(error)) {
    sendProblem(res, buildProblem(413, ProblemType.PAYLOAD_TOO_LARGE, {
      detail: 'Request body exceeds the 1 MB limit.',
    }), req.originalUrl);
    return;
  }

  if (isMalformedJson(error)) {
    sendProblem(res, buildProblem(400, ProblemType.VALIDATION_ERROR, {
      detail: 'Request body is not valid JSON.',
      errors: [{ field: 'body', message: 'malformed JSON' }],
    }), req.originalUrl);
    return;
  }

  if (error instanceof ProblemError) {
    sendProblem(res, error.problem, req.originalUrl);
    return;
  }

  // Unexpected failure: log for diagnosis, never leak internals to clients.
  console.error('[api] unhandled error', error);
  sendProblem(res, buildProblem(500, ProblemType.INTERNAL_ERROR), req.originalUrl);
};

function isPayloadTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    (error as { type?: unknown }).type === 'entity.too.large'
  );
}

function isMalformedJson(error: unknown): boolean {
  return error instanceof SyntaxError && 'status' in error && (error as { status?: unknown }).status === 400;
}

/** Catch-all for unmatched routes → 404 Problem Details (Task 2.4). */
export function notFoundHandler(req: Request, res: Response): void {
  sendProblem(
    res,
    buildProblem(404, ProblemType.NOT_FOUND, {
      detail: `No route matches ${req.method} ${req.originalUrl}.`,
    }),
    req.originalUrl,
  );
}
