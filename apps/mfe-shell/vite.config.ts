import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import federation from '@originjs/vite-plugin-federation';

// Host wiring per ADR-005: fixed port 5173 (D-WEB-2), remotes on 5174/5175.
// react/react-dom/@sentinel/contracts are declared in the federation share
// scope so the host and remotes resolve a single module copy at runtime
// (ADR-005 rule 2). Note: this plugin deduplicates via the share scope — it
// has no webpack-style `singleton` flag.
export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'mfe-shell',
      remotes: {
        config: 'http://localhost:5174/assets/remoteEntry.js',
        metrics: 'http://localhost:5175/assets/remoteEntry.js',
      },
      shared: {
        react: { requiredVersion: '^18.3.1' },
        'react-dom': { requiredVersion: '^18.3.1' },
        '@sentinel/contracts': {},
      },
    }),
  ],
  build: {
    target: 'esnext',
  },
});
