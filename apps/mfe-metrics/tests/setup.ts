import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { MockEventSource } from './mocks/eventSource';

// Vitest globals are disabled, so @testing-library/react's automatic cleanup
// does not run — register it explicitly to isolate DOM between tests.
afterEach(() => {
  cleanup();
});

// Install a controllable EventSource mock (US-3): tests emit named SSE frames
// via MockEventSource.emit(...) to simulate the audit stream. jsdom does not
// provide EventSource natively, so the mock doubles as the global constructor.
vi.stubGlobal('EventSource', MockEventSource);
afterEach(() => {
  MockEventSource.resetInstances();
});
