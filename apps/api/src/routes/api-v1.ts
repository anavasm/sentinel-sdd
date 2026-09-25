import { Router, type Router as ExpressRouter } from 'express';

import { createAuditHandler, getAuditHandler } from './audits.js';

/**
 * Router mounted at the contract base path `/api/v1` (openapi `servers`).
 *
 * US-2 adds `POST /audits` (fail-fast validated audit creation) and US-3
 * adds `GET /audits/:auditId` (session state lookup). `GET /health` is an
 * internal smoke route from US-1 (outside the openapi contract).
 * `GET /audits/{id}/stream` arrives in US-4.
 */
export const apiV1Router: ExpressRouter = Router();

apiV1Router.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

apiV1Router.post('/audits', createAuditHandler);
apiV1Router.get('/audits/:auditId', getAuditHandler);
