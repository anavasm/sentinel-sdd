import express, { type Express } from 'express';

import { StubAuditRunner } from './agent/stub-runner.js';
import type { AuditRunner } from './agent/runner.js';
import { notFoundHandler, problemErrorHandler } from './lib/error-handler.js';
import { createApiV1Router } from './routes/api-v1.js';

/**
 * Express application factory implementing specs/openapi.yaml base path `/api/v1`.
 *
 * US-2: `POST /audits` with fail-fast validation (D-API-2 1 MB body limit),
 * RFC 9457 Problem Details error handling (D-API-5) and a 404 catch-all for
 * unknown routes. US-3 adds `GET /audits/:auditId`; US-4 wires the SSE hub
 * (`src/sse/hub.ts`) and the fixture-driven stub runner (D-API-3): every
 * successful POST kicks the runner asynchronously via `setImmediate`, so the
 * HTTP response is never blocked by agent execution.
 */

/** Request body limit per D-API-2 (openapi 413 response). */
const REQUEST_BODY_LIMIT_BYTES = '1mb';

export interface CreateAppOptions {
  /**
   * Audit runner kicked on POST success. Defaults to the fixture-driven
   * {@link StubAuditRunner}; pass `null` to disable execution (tests).
   */
  readonly runner?: AuditRunner | null;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  app.disable('x-powered-by');

  app.use(express.json({ limit: REQUEST_BODY_LIMIT_BYTES }));

  const runner = options.runner === undefined ? new StubAuditRunner() : options.runner;
  app.use('/api/v1', createApiV1Router(runner));

  // Unknown routes → 404 Problem Details; errors → central Problem handler.
  app.use(notFoundHandler);
  app.use(problemErrorHandler);

  return app;
}
