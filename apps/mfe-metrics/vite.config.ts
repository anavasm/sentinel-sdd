import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import federation from '@originjs/vite-plugin-federation';

function shareReactWithExternalStore(): Plugin {
  const virtualModuleId = '\0sentinel:external-store-react';
  return {
    name: 'share-react-with-external-store',
    apply: 'build',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === 'react' && importer?.replaceAll('\\', '/').includes('/use-sync-external-store/')) {
        return virtualModuleId;
      }
      return undefined;
    },
    load(id) {
      if (id === virtualModuleId) {
        // The CommonJS store shim must use the same federated React as the chart.
        return `
          import {
            useState, useRef, useEffect, useMemo, useLayoutEffect,
            useDebugValue, useSyncExternalStore
          } from 'react';
          export {
            useState, useRef, useEffect, useMemo, useLayoutEffect,
            useDebugValue, useSyncExternalStore
          };
        `;
      }
      return undefined;
    },
  };
}

// Remote 2 per ADR-005: exposes ./MetricsView, runs standalone on port 5175 (D-WEB-2).
// react/react-dom/@sentinel/contracts are declared in the federation share
// scope so remotes resolve a single module copy at runtime (ADR-005 rule 2).
// Note: this plugin deduplicates via the share scope — it has no
// webpack-style `singleton` flag.
export default defineConfig({
  plugins: [
    react(),
    shareReactWithExternalStore(),
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
