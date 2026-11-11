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
        // Static contract data; its runtime consumers are covered by tests.
        'src/fixtures/**',
        'src/mocks/**',
        // Type barrel only; generated declarations are excluded above.
        'src/index.ts',
        // CLI gate exercised through its process-level command, not imported runtime code.
        'src/validate.ts',
      ],
      thresholds: {
        // Strictly greater than 80%; Vitest's integer threshold would allow 80.
        lines: 80.01,
        functions: 80.01,
        branches: 80.01,
        statements: 80.01,
      },
    },
  },
});
