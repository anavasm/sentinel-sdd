import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest globals are disabled, so @testing-library/react's automatic cleanup
// does not run — register it explicitly to isolate DOM between tests.
afterEach(() => {
  cleanup();
});
