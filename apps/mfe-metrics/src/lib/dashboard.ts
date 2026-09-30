/**
 * Pure derivation helpers for the metrics dashboard (US-4).
 *
 * Keep components presentational: all filtering/counting over the accumulated
 * SSE event list happens here, so the logic is unit-testable without rendering
 * (SRP) and both the header and the findings list reuse identical derivations
 * (DRY).
 */
import type {
  AgentThoughtEvent,
  AuditCompletedEvent,
  Finding,
  SentinelAISSEEventContract,
  ToolExecutionEvent,
  VulnerabilityFoundEvent,
} from '@sentinel/contracts';
import type { Severity } from '@sentinel/contracts';

const SEVERITY_ORDER: readonly Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

/** Extracts `VULNERABILITY_FOUND` payloads, in arrival order. */
export function extractFindings(events: readonly SentinelAISSEEventContract[]): Finding[] {
  return events
    .filter((event): event is VulnerabilityFoundEvent => event.type === 'VULNERABILITY_FOUND')
    .map((event) => event.payload);
}

/** Extracts `AGENT_THOUGHT` and `TOOL_EXECUTION` events, in arrival order. */
export function extractTimelineEvents(
  events: readonly SentinelAISSEEventContract[],
): (AgentThoughtEvent | ToolExecutionEvent)[] {
  return events.filter(
    (event): event is AgentThoughtEvent | ToolExecutionEvent =>
      event.type === 'AGENT_THOUGHT' || event.type === 'TOOL_EXECUTION',
  );
}

/** Findings counter keyed by severity, only non-zero entries included. */
export function countFindingsBySeverity(
  findings: readonly Finding[],
): Partial<Record<Severity, number>> {
  const counters: Partial<Record<Severity, number>> = {};
  for (const finding of findings) {
    counters[finding.severity] = (counters[finding.severity] ?? 0) + 1;
  }
  return counters;
}

/** Severity counters ordered CRITICAL → LOW for stable header rendering. */
export function orderedSeverityCounters(
  counters: Partial<Record<Severity, number>>,
): { severity: Severity; count: number }[] {
  return SEVERITY_ORDER.filter((severity) => (counters[severity] ?? 0) > 0).map((severity) => ({
    severity,
    count: counters[severity] ?? 0,
  }));
}

/**
 * Terminal event of the stream, if it has arrived yet. The payload is the
 * health-score / summary source for the header (US4 terminal state).
 */
export function findCompletedEvent(
  events: readonly SentinelAISSEEventContract[],
): AuditCompletedEvent | undefined {
  return events.find((event): event is AuditCompletedEvent => event.type === 'AUDIT_COMPLETED');
}
