import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Vitest config is deliberately separate from vite.config.ts: the federation
// plugin is not loaded here. Smoke tests alias the remote module specifiers
// (config/ConfigView, metrics/MetricsView) to the real source files so tests
// verify component mounting without booting remote dev servers. Real
// federation wiring is exercised via `pnpm dev` (ADR-005).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "metrics/MetricsView": path.resolve(__dirname, "src/MetricsView.tsx"),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.tsx', 'tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.tsx', 'src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        // Process bootstrap only (createRoot mount, no logic).
        'src/main.tsx',
      ],
      thresholds: {
        // ASD §10.3 / C §4.2: coverage gate > 80%.
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
