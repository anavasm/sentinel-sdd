import { createServer } from 'node:http';

import type { AddressInfo } from 'node:net';
import type { AuditConfig } from '@sentinel/contracts';

import { createApp } from '../../src/app.js';
import { emitAuditEvent } from '../../src/sse/hub.js';
import { createAudit } from '../../src/store/audits.js';

const CONTROL_PORT = 4311;
const auditConfig: AuditConfig = {
  repoUrl: 'https://example.invalid/sse-latency-fixture.git',
  ruleSets: {
    owaspTop10: false,
    testQuality: false,
    codeSmellsPerformance: false,
  },
  severityThreshold: 'LOW',
};

function readJson(request: import('node:http').IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      try {
        resolve(body === '' ? {} : JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response: import('node:http').ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

const controlServer = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }
  if (request.method === 'POST' && request.url === '/start') {
    const audit = createAudit({ config: auditConfig });
    sendJson(response, 201, { auditId: audit.auditId });
    return;
  }
  if (request.method === 'POST' && request.url === '/emit') {
    const body = (await readJson(request)) as { auditId?: string; delayMs?: number };
    const delayMs = body.delayMs;
    if (
      typeof body.auditId !== 'string'
      || typeof delayMs !== 'number'
      || !Number.isInteger(delayMs)
      || delayMs < 0
    ) {
      sendJson(response, 400, { error: 'auditId and non-negative integer delayMs are required' });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const event = emitAuditEvent(body.auditId, {
      type: 'AGENT_THOUGHT',
      timestamp: new Date().toISOString(),
      auditId: body.auditId,
      payload: { content: `Synthetic latency event ${body.auditId}` },
    });
    if (event === undefined) {
      sendJson(response, 404, { error: 'audit not found or terminal' });
      return;
    }
    sendJson(response, 200, { eventId: event.id });
    return;
  }
  sendJson(response, 404, { error: 'not found' });
});

const apiServer = createApp({ runner: null }).listen(3000, '127.0.0.1');
controlServer.listen(CONTROL_PORT, '127.0.0.1', () => {
  const address = controlServer.address() as AddressInfo;
  console.log(`[latency-server] control server listening on ${address.port}`);
});

function shutdown(): void {
  apiServer.close();
  controlServer.close();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
