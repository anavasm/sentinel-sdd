import { Router, type Router as ExpressRouter } from 'express';

import type { AuditRunner } from '../agent/runner.js';
import { createAuditHandler, getAuditHandler, streamAuditHandler } from './audits.js';

/**
 * Router factory mounted at the contract base path `/api/v1` (openapi `servers`).
 *
 * US-2 adds `POST /audits` (fail-fast validated audit creation), US-3 adds
 * `GET /audits/:auditId` (session state lookup), and US-4 adds
 * `GET /audits/:auditId/stream` (SSE channel with resync). `GET /health` is
 * an internal smoke route from US-1 (outside the openapi contract).
 *
 * The runner is injected so tests can disable execution (`null`); the
 * production app wires the fixture-driven stub runner (D-API-3).
 */
export function createApiV1Router(runner: AuditRunner | null): ExpressRouter {
  const router: ExpressRouter = Router();

  router.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  router.post('/audits', createAuditHandler(runner));
  router.get('/audits/:auditId', getAuditHandler);
  router.get('/audits/:auditId/stream', streamAuditHandler);

  return router;
}
