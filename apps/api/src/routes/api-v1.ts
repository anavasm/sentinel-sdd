import { Router, type Router as ExpressRouter } from 'express';

/**
 * Router mounted at the contract base path `/api/v1` (openapi `servers`).
 *
 * US-2 adds `POST /audits` (fail-fast validated audit creation). `GET /health`
 * is an internal smoke route from US-1 (outside the openapi contract).
 * `GET /audits/{id}` and `GET /audits/{id}/stream` arrive in US-3/US-4.
 */
export const apiV1Router: ExpressRouter = Router();

apiV1Router.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});
