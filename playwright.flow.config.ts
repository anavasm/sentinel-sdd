import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'audit-flow.spec.ts',
  fullyParallel: false,
  timeout: 30_000,
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:5173',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'pnpm --filter @sentinel/api exec tsx tests/e2e/flow-server.ts',
      url: 'http://127.0.0.1:4312/health',
      reuseExistingServer: false,
      env: { ALLOWED_ORIGINS: 'http://localhost:5173' },
    },
    {
      command: 'pnpm dev',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_API_BASE_URL: 'http://localhost:3000/api/v1' },
    },
  ],
});
