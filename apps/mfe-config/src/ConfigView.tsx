/**
 * Federated surface of mfe-config (exposed as ./ConfigView in vite.config.ts).
 * US-1 placeholder: the real launch form with client-side fail-fast validation
 * arrives in US-2 (docs/plans/implementation-plan-mfe.md).
 */
export function ConfigView(): JSX.Element {
  return (
    <section className="rounded-lg border border-slate-700 bg-sentinel-panel p-6">
      <h1 className="text-xl font-semibold text-sentinel-accent">Audit Configuration</h1>
      <p className="mt-2 text-sm text-slate-300">
        Configure a repository and rule sets to launch an audit. (Launch form lands in US-2.)
      </p>
    </section>
  );
}

// Federation modules are consumed via import() (React.lazy) - a default
// export is required by the host's lazy loader.
export default ConfigView;

