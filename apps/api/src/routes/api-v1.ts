import { Router, type Router as ExpressRouter } from 'express';

/**
 * Router mounted at the contract base path `/api/v1` (openapi `servers`).
 *
 * `GET /health` is an internal smoke route (plan Task 1.1) — it lives outside
 * the openapi contract and must be removed or excluded from contract docs at
 * the US-2 review. All audit endpoints arrive in US-2/US-3/US-4.
 */
export const apiV1Router: ExpressRouter = Router();

apiV1Router.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});
