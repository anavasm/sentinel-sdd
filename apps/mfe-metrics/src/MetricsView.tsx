/**
 * Federated surface of mfe-metrics (exposed as ./MetricsView in vite.config.ts).
 * US-3: live stream connection via `useAuditStream` with a connection status
 * badge and a minimal live event timeline indicator. The full dashboard
 * (EventTimeline, findings, health) arrives in US-4/US-5.
 */
import type { JSX } from 'react';
import { useParams } from 'react-router-dom';
import type { AuditStreamStatus } from './hooks/useAuditStream';
import { useAuditStream } from './hooks/useAuditStream';

/** Badge text + styling per connection status (US-3 status surface). */
const STATUS_BADGE: Readonly<Record<AuditStreamStatus, { label: string; className: string }>> = {
  CONNECTING: { label: 'Connecting', className: 'bg-slate-700 text-slate-200' },
  CONNECTED: { label: 'Live stream active', className: 'bg-emerald-600/20 text-emerald-400' },
  DISCONNECTED: { label: 'Completed', className: 'bg-sky-600/20 text-sky-300' },
  ERROR: { label: 'Connection error', className: 'bg-amber-600/20 text-amber-300' },
};

function StatusBadge({ status }: { status: AuditStreamStatus }): JSX.Element {
  const badge = STATUS_BADGE[status];
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="stream-status-badge"
      className={`rounded-full px-3 py-1 text-xs font-medium ${badge.className}`}
    >
      {badge.label}
    </span>
  );
}

export function MetricsView(): JSX.Element {
  const { auditId } = useParams<{ auditId: string }>();
  const { events, status } = useAuditStream(auditId);

  return (
    <section className="rounded-lg border border-slate-700 bg-sentinel-panel p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-sentinel-accent">Audit Execution Metrics</h1>
        <StatusBadge status={status} />
      </div>

      {auditId ? (
        <p className="mt-2 text-sm text-slate-300">
          Streaming audit <span className="font-mono text-slate-100">{auditId}</span>
        </p>
      ) : (
        <p className="mt-2 text-sm text-slate-400">No audit selected.</p>
      )}

      {events.length > 0 && (
        <div className="mt-4">
          <h2 className="text-sm font-semibold text-slate-300">
            Live timeline ({events.length} event{events.length === 1 ? '' : 's'})
          </h2>
          <ul className="mt-2 space-y-1" data-testid="live-event-timeline">
            {events.map((event) => (
              <li
                key={`${event.id}-${event.timestamp}`}
                className="rounded border border-slate-700/60 bg-slate-800/50 px-3 py-2 text-sm text-slate-200"
              >
                <span className="mr-2 font-mono text-xs text-slate-400">#{event.id}</span>
                <span className="mr-2 font-medium text-sentinel-accent">{event.type}</span>
                <span className="text-slate-300">{event.timestamp}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// Federation modules are consumed via import() (React.lazy) - a default
// export is required by the host's lazy loader.
export default MetricsView;
