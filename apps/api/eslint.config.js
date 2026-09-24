import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // TODO(US-2): replace bootstrap/shutdown logs with structured pino logging
      // (Node.js standard: no console.log in production code). US-1 has no logger yet.
      "no-console": ["error", { allow: ["log", "error"] }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
