import express, { type Express } from 'express';

import { apiV1Router } from './routes/api-v1.js';

/**
 * Express application factory implementing specs/openapi.yaml base path `/api/v1`.
 *
 * Kept framework-only for US-1: routes, validation middleware, Problem Details
 * error handler, SSE hub and agent runner are added in US-2..US-5.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');

  app.use('/api/v1', apiV1Router);

  return app;
}
