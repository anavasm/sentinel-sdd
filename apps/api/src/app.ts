import express, { type Express } from 'express';

import { notFoundHandler, problemErrorHandler } from './lib/error-handler.js';
import { apiV1Router } from './routes/api-v1.js';
import { createAuditHandler } from './routes/audits.js';

/**
 * Express application factory implementing specs/openapi.yaml base path `/api/v1`.
 *
 * US-2: `POST /audits` with fail-fast validation (D-API-2 1 MB body limit),
 * RFC 9457 Problem Details error handling (D-API-5) and a 404 catch-all for
 * unknown routes. SSE hub and agent runner arrive in US-4/US-5.
 */

/** Request body limit per D-API-2 (openapi 413 response). */
const REQUEST_BODY_LIMIT_BYTES = '1mb';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');

  app.use(express.json({ limit: REQUEST_BODY_LIMIT_BYTES }));

  app.use('/api/v1', apiV1Router);
  apiV1Router.post('/audits', createAuditHandler);

  // Unknown routes → 404 Problem Details; errors → central Problem handler.
  app.use(notFoundHandler);
  app.use(problemErrorHandler);

  return app;
}
