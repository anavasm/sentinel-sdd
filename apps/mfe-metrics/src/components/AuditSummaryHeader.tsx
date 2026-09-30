/**
 * Dashboard summary header (US-4): audit identity, live connection badge,
 * findings counter by severity, and the final health score once the terminal
 * `AUDIT_COMPLETED` event arrives. Also surfaces the failed-audit reason
 * (US4-AC3: degradation/failure is never rendered as a transport error).
 */
import type { JSX } from 'react';
import type { SentinelAISSEEventContract } from '@sentinel/contracts';
import type { AuditStreamStatus } from '../hooks/useAuditStream';
import {
  countFindingsBySeverity,
  extractFindings,
  findCompletedEvent,
  orderedSeverityCounters,
} from '../lib/dashboard';
import { SEVERITY_BADGE, STREAM_STATUS_BADGE } from '../lib/badgeStyles';

export interface AuditSummaryHeaderProps {
  readonly auditId: string | undefined;
  readonly status: AuditStreamStatus;
  readonly events: readonly SentinelAISSEEventContract[];
}

export function AuditSummaryHeader({
  auditId,
  status,
  events,
}: AuditSummaryHeaderProps): JSX.Element {
  const statusBadge = STREAM_STATUS_BADGE[status];
  const severityCounters = orderedSeverityCounters(
    countFindingsBySeverity(extractFindings(events)),
  );
  const completedEvent = findCompletedEvent(events);
  const healthScore = completedEvent?.payload.healthScore;
  const failedReason =
    completedEvent?.payload.status === 'failed' ? completedEvent.payload.error : undefined;

  return (
    <header className="rounded-lg border border-slate-700 bg-sentinel-panel p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-sentinel-accent">Audit Execution Metrics</h1>
          {auditId !== undefined && (
            <p className="mt-1 text-sm text-slate-300">
              Audit <span className="font-mono text-slate-100">{auditId}</span>
            </p>
          )}
        </div>
        <span
          role="status"
          aria-live="polite"
          data-testid="stream-status-badge"
          className={`rounded-full px-3 py-1 text-xs font-medium ${statusBadge.className}`}
        >
          {statusBadge.label}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2" data-testid="findings-counters">
          {severityCounters.length === 0 ? (
            <span className="text-sm text-slate-400">No findings yet</span>
          ) : (
            severityCounters.map(({ severity, count }) => (
              <span
                key={severity}
                data-testid={`findings-counter-${severity}`}
                className={`rounded border px-2 py-0.5 text-xs font-medium ${SEVERITY_BADGE[severity]}`}
              >
                {count} {severity}
              </span>
            ))
          )}
        </div>

        {typeof healthScore === 'number' && (
          <span
            data-testid="health-score"
            className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300"
          >
            Health score: {healthScore}/100
          </span>
        )}
      </div>

      {failedReason !== undefined && (
        <p role="alert" className="mt-4 rounded border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-300">
          Audit failed: {failedReason}
        </p>
      )}
    </header>
  );
}
