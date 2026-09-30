/**
 * Shared visual tokens for the metrics dashboard (US-4).
 *
 * Centralizes the severity and connection-status styling so every surface
 * (header badges, finding cards, timeline chips) renders identically —
 * changing a color is a one-place edit (DRY) and the semantic color rules
 * (CRITICAL/HIGH red, MEDIUM amber, LOW sky) stay consistent by construction.
 */
import type { Severity } from '@sentinel/contracts';
import type { AuditStreamStatus } from '../hooks/useAuditStream';

export interface BadgeStyle {
  readonly label: string;
  readonly className: string;
}

/** Semantic severity colors (US-4 design requirement). */
export const SEVERITY_BADGE: Readonly<Record<Severity, string>> = {
  CRITICAL: 'bg-red-500/20 text-red-300 border-red-500/40',
  HIGH: 'bg-red-500/20 text-red-300 border-red-500/40',
  MEDIUM: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  LOW: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
};

/** Tool execution outcome chips; `degraded` uses the sentinel token (US4-AC3). */
export const TOOL_STATUS_BADGE: Readonly<Record<string, string>> = {
  started: 'bg-slate-600/30 text-slate-300 border-slate-500/40',
  succeeded: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  degraded: 'bg-sentinel-degraded/20 text-sentinel-degraded border-sentinel-degraded/40',
  failed: 'bg-sentinel-failed/20 text-sentinel-failed border-sentinel-failed/40',
};

/** Connection status badge for the summary header (US-3 surface, reused). */
export const STREAM_STATUS_BADGE: Readonly<Record<AuditStreamStatus, BadgeStyle>> = {
  CONNECTING: { label: 'Connecting', className: 'bg-slate-700 text-slate-200' },
  CONNECTED: { label: 'Live stream active', className: 'bg-emerald-600/20 text-emerald-400' },
  DISCONNECTED: { label: 'Completed', className: 'bg-sky-600/20 text-sky-300' },
  ERROR: { label: 'Connection error', className: 'bg-amber-600/20 text-amber-300' },
};
