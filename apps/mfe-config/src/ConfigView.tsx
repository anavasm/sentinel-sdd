/**
 * Federated surface of mfe-config (exposed as ./ConfigView in vite.config.ts).
 * US-2: renders the Audit Configuration heading and the launch form.
 */
// Must be the first import: in federated mode the host loads this module via
// remoteEntry.js and never executes main.tsx, so this is the only place the
// remote's Tailwind entry gets bundled into and injected with the federated
// chunk (D-WEB-5).
import './index.css';
import { LaunchAuditForm } from './LaunchAuditForm';

export function ConfigView(): JSX.Element {
  return (
    <section className="rounded-lg border border-slate-700 bg-sentinel-panel p-6">
      <h1 className="text-xl font-semibold text-sentinel-accent">Audit Configuration</h1>
      <p className="mt-2 text-sm text-slate-300">
        Configure a repository and rule sets to launch an audit.
      </p>
      <LaunchAuditForm />
    </section>
  );
}

// Federation modules are consumed via import() (React.lazy) - a default
// export is required by the host's lazy loader.
export default ConfigView;
