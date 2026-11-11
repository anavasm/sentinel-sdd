import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { MockEventSource } from './mocks/eventSource';

// Vitest globals are disabled, so @testing-library/react's automatic cleanup
// does not run � register it explicitly to isolate DOM between tests.
afterEach(() => {
  cleanup();
});

// Install a controllable EventSource mock (US-3): tests emit named SSE frames
// via MockEventSource.emit(...) to simulate the audit stream. jsdom does not
// provide EventSource natively, so the mock doubles as the global constructor.
vi.stubGlobal('EventSource', MockEventSource);
vi.stubGlobal(
  'fetch',
  vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const auditId = url.split('/audits/')[1]?.split('/')[0] ?? 'aud_test001';
    return new Response(JSON.stringify({
      auditId,
      status: 'running',
      config: { localPath: '/tmp/repo' },
      createdAt: '2026-09-23T10:00:00.000Z',
      findings: [],
      lastEventId: 0,
      firstAvailableEventId: null,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }),
);
afterEach(() => {
  MockEventSource.resetInstances();
});
