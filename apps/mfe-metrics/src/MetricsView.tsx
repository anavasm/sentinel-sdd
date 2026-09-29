/**
 * Federated surface of mfe-metrics (exposed as ./MetricsView in vite.config.ts).
 * US-1 placeholder: the SSE stream hook (US-3), live dashboard (US-4) and
 * findings viewer (US-5) arrive in subsequent stories.
 */
export function MetricsView(): JSX.Element {
  return (
    <section className="rounded-lg border border-slate-700 bg-sentinel-panel p-6">
      <h1 className="text-xl font-semibold text-sentinel-accent">Audit Execution Metrics</h1>
      <p className="mt-2 text-sm text-slate-300">
        Live agent timeline, findings and summary report. (Dashboard lands in US-3..US-5.)
      </p>
    </section>
  );
}

// Federation modules are consumed via import() (React.lazy) - a default
// export is required by the host's lazy loader.
export default MetricsView;
