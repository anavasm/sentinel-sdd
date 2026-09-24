import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Generated files (openapi-typescript / json-schema-to-typescript output) are not hand-written code.
  { ignores: ['src/generated/', 'node_modules/', 'coverage/'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // src/validate.ts is the contract gate CLI — stdout reporting is its purpose.
      'no-console': 'off',
    },
  },
);
