import { createServer } from 'node:http';

import type { AuditRunner } from '../../src/agent/runner.js';
import { StubAuditRunner } from '../../src/agent/stub-runner.js';
import { createApp } from '../../src/app.js';

const pendingAudits = new Set<string>();
const fixtureRunner = new StubAuditRunner({ interEventDelayMs: 0 });
const runner: AuditRunner = {
  run(auditId) {
    pendingAudits.add(auditId);
  },
};

const controlServer = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  const match = request.url?.match(/^\/run\/(aud_[0-9A-Za-z]+)$/);
  const auditId = match?.[1];
  if (request.method === 'POST' && auditId !== undefined && pendingAudits.delete(auditId)) {
    fixtureRunner.run(auditId);
    response.writeHead(202, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ auditId }));
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'Pending audit not found' }));
});

const apiServer = createApp({ runner }).listen(3000, '127.0.0.1', () => {
  console.log('[flow-server] API listening on 127.0.0.1:3000');
  controlServer.listen(4312, '127.0.0.1', () => {
    console.log('[flow-server] test controls listening on 127.0.0.1:4312');
  });
});

function shutdown(): void {
  apiServer.close();
  controlServer.close();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
