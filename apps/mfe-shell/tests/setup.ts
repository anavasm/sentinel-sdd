import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { MockEventSource } from '../../mfe-metrics/tests/mocks/eventSource';

vi.stubGlobal('EventSource', MockEventSource);

// Vitest globals are disabled, so @testing-library/react's automatic cleanup
// does not run — register it explicitly to isolate DOM between tests.
afterEach(() => {
  cleanup();
  MockEventSource.resetInstances();
});
