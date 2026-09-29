import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import federation from '@originjs/vite-plugin-federation';

// Remote 2 per ADR-005: exposes ./MetricsView, runs standalone on port 5175 (D-WEB-2).
// react/react-dom/@sentinel/contracts are declared in the federation share
// scope so remotes resolve a single module copy at runtime (ADR-005 rule 2).
// Note: this plugin deduplicates via the share scope — it has no
// webpack-style `singleton` flag.
export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'mfe-metrics',
      filename: 'remoteEntry.js',
      exposes: {
        './MetricsView': './src/MetricsView.tsx',
      },
      shared: {
        react: { requiredVersion: '^18.3.1' },
        'react-dom': { requiredVersion: '^18.3.1' },
        'react-router-dom': { requiredVersion: '^6.28.0' },
        '@sentinel/contracts': {},
      },
    }),
  ],
  build: {
    target: 'esnext',
  },
});
