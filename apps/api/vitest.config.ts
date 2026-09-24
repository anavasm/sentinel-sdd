import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        // Process bootstrap only (listen + signal wiring, no logic - its port
        // parsing lives in src/lib/config.ts and is unit-tested).
        'src/server.ts',
      ],
      thresholds: {
        // ASD §10.3 / C §4.2: coverage gate > 80% on apps/api logic.
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
