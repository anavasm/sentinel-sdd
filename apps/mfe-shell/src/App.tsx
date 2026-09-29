import type { ReactNode } from 'react';
import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';

// Remotes are lazy-loaded federation modules (ADR-005). The specifiers resolve
// through the federation plugin at runtime; Vitest aliases them to the source
// files for smoke tests (see vitest.config.ts).
const ConfigView = lazy(() => import('config/ConfigView'));
const MetricsView = lazy(() => import('metrics/MetricsView'));

function RemoteFallback(): ReactNode {
  return (
    <div className="mt-16 text-center text-slate-400" role="status">
      Loading module…
    </div>
  );
}

function NotFoundPage(): ReactNode {
  return (
    <div className="mx-auto mt-16 max-w-xl rounded-lg border border-slate-700 bg-sentinel-panel p-6 text-center">
      <h2 className="text-lg font-semibold">Page not found</h2>
      <p className="mt-2 text-sm text-slate-300">
        The requested view does not exist. Use the navigation to return to the audit configuration.
      </p>
    </div>
  );
}

/** Host routing (US-1 Task 1.3): `/` → config remote, `/audits/:auditId` → metrics remote. */
export function App(): ReactNode {
  return (
    <AppShell>
      <ErrorBoundary contextLabel="Audit Configuration">
        <Suspense fallback={<RemoteFallback />}>
          <Routes>
            <Route path="/" element={<ConfigView />} />
            <Route path="/audits/:auditId" element={<MetricsView />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  );
}
