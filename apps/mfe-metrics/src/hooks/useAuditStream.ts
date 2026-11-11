/**
 * Live SSE stream hook for one audit.
 *
 * The stream is treated as an untrusted transport: JSON is parsed and checked
 * at runtime before it can enter the reducer. REST snapshots are used on entry
 * and after transport errors so a lost replay window does not become silent
 * state loss.
 */
import { useEffect, useState } from 'react';
import type {
  Audit,
  AuditFinding,
  SentinelAISSEEventContract,
} from '@sentinel/contracts';

export type AuditStreamStatus =
  | 'CONNECTING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'ERROR'
  | 'NOT_FOUND';

const TERMINAL_EVENT_TYPE = 'AUDIT_COMPLETED';
const SSE_EVENT_TYPES = [
  'AGENT_THOUGHT',
  'TOOL_EXECUTION',
  'VULNERABILITY_FOUND',
  TERMINAL_EVENT_TYPE,
] as const;
const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';

export interface AuditStreamState {
  events: SentinelAISSEEventContract[];
  status: AuditStreamStatus;
  snapshot: Audit | undefined;
  /** True when the accepted event stream cannot represent a contiguous timeline. */
  gapDetected: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAuditEvent(value: unknown, auditId: string, eventName: string): value is SentinelAISSEEventContract {
  if (!isRecord(value)
    || !Number.isInteger(value.id)
    || Number(value.id) < 1
    || value.auditId !== auditId
    || value.type !== eventName
    || typeof value.timestamp !== 'string'
    || !isRecord(value.payload)) {
    return false;
  }
  if (value.type === 'AGENT_THOUGHT') return typeof value.payload.content === 'string';
  if (value.type === 'TOOL_EXECUTION') {
    return typeof value.payload.tool === 'string'
      && typeof value.payload.status === 'string';
  }
  if (value.type === 'AUDIT_COMPLETED') {
    return value.payload.status === 'completed' || value.payload.status === 'failed';
  }
  return typeof value.payload.ruleId === 'string'
    && typeof value.payload.title === 'string'
    && typeof value.payload.severity === 'string'
    && typeof value.payload.filePath === 'string'
    && typeof value.payload.description === 'string'
    && typeof value.payload.beforeSnippet === 'string'
    && typeof value.payload.afterSnippet === 'string';
}

function isAuditSnapshot(value: unknown, auditId: string): value is Audit {
  if (!isRecord(value)
    || value.auditId !== auditId
    || typeof value.status !== 'string'
    || typeof value.createdAt !== 'string'
    || !isRecord(value.config)
    || !Number.isInteger(value.lastEventId)
    || Number(value.lastEventId) < 0
    || (value.firstAvailableEventId !== null
      && (!Number.isInteger(value.firstAvailableEventId) || Number(value.firstAvailableEventId) < 1))) {
    return false;
  }
  return value.findings === undefined || Array.isArray(value.findings);
}

function logAnomaly(message: string): void {
  console.error(message);
}

export function useAuditStream(auditId: string | undefined): AuditStreamState {
  const [events, setEvents] = useState<SentinelAISSEEventContract[]>([]);
  const [status, setStatus] = useState<AuditStreamStatus>('CONNECTING');
  const [snapshot, setSnapshot] = useState<Audit | undefined>();
  const [gapDetected, setGapDetected] = useState(false);

  useEffect(() => {
    if (!auditId) {
      setEvents([]);
      setSnapshot(undefined);
      setGapDetected(false);
      setStatus('CONNECTING');
      return undefined;
    }

    let active = true;
    let eventSource: EventSource | undefined;
    let acceptedLastEventId = 0;
    let snapshotLastEventId = 0;

    setEvents([]);
    setSnapshot(undefined);
    setGapDetected(false);
    setStatus('CONNECTING');

    const applySnapshot = (candidate: Audit): void => {
      snapshotLastEventId = Math.max(snapshotLastEventId, candidate.lastEventId);
      acceptedLastEventId = Math.max(acceptedLastEventId, candidate.lastEventId);
      setSnapshot((previous) => (
        previous === undefined || candidate.lastEventId >= previous.lastEventId ? candidate : previous
      ));
      setGapDetected((previous) => previous || (
        candidate.firstAvailableEventId !== null
        && acceptedLastEventId + 1 < candidate.firstAvailableEventId
      ));
    };

    const reconcile = async (): Promise<{ exists: boolean; terminal: boolean }> => {
      try {
        const response = await fetch(`${API_BASE_URL}/audits/${auditId}`, {
          headers: { Accept: 'application/json' },
        });
        if (response.status === 404) {
          if (active) {
            setStatus('NOT_FOUND');
            eventSource?.close();
          }
          return { exists: false, terminal: false };
        }
        if (!response.ok) {
          throw new Error(`Audit snapshot request failed with status ${response.status}`);
        }
        const body: unknown = await response.json();
        if (!isAuditSnapshot(body, auditId)) {
          throw new Error('Audit snapshot failed runtime validation');
        }
        if (active) {
          applySnapshot(body);
          if (body.status === 'completed' || body.status === 'failed') {
            setStatus('DISCONNECTED');
          }
        }
        return {
          exists: true,
          terminal: body.status === 'completed' || body.status === 'failed',
        };
      } catch {
        if (active) {
          setStatus('ERROR');
          logAnomaly('Audit snapshot reconciliation failed');
        }
        return { exists: true, terminal: false };
      }
    };

    const openStream = (): void => {
      if (!active) return;
      eventSource = new EventSource(`${API_BASE_URL}/audits/${auditId}/stream`);
      eventSource.onopen = () => {
        if (active) setStatus('CONNECTED');
      };
      eventSource.onerror = () => {
        if (!active) return;
        setStatus('ERROR');
        void reconcile();
      };

      const appendEvent = (incoming: MessageEvent<string>): void => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(incoming.data);
        } catch {
          logAnomaly('Discarding malformed SSE JSON frame');
          void reconcile();
          return;
        }
        if (!isAuditEvent(parsed, auditId, incoming.type)
          || Number(incoming.lastEventId) !== parsed.id) {
          logAnomaly('Discarding invalid or inconsistent SSE frame');
          void reconcile();
          return;
        }
        const event = parsed;
        setEvents((previous) => {
          const existing = previous.find((candidate) => candidate.id === event.id);
          if (existing !== undefined) {
            if (JSON.stringify(existing) !== JSON.stringify(event)) {
              logAnomaly('Discarding conflicting duplicate SSE event');
            }
            return previous;
          }
          const next = [...previous, event].sort((left, right) => left.id - right.id);
          const expected = acceptedLastEventId + 1;
          if (event.id > expected) {
            setGapDetected(true);
          }
          acceptedLastEventId = Math.max(acceptedLastEventId, event.id);
          return next;
        });
        if (event.id > snapshotLastEventId + 1 && snapshotLastEventId > 0) {
          setGapDetected(true);
        }
        if (event.type === TERMINAL_EVENT_TYPE) {
          setStatus('DISCONNECTED');
          eventSource?.close();
        }
      };

      for (const eventType of SSE_EVENT_TYPES) {
        eventSource.addEventListener(eventType, appendEvent as EventListener);
      }
    };

    void reconcile().then(({ exists, terminal }) => {
      if (exists && !terminal && active) openStream();
    });

    return () => {
      active = false;
      eventSource?.close();
    };
  }, [auditId]);

  return { events, status, snapshot, gapDetected };
}

export function snapshotFindings(snapshot: Audit | undefined): readonly AuditFinding[] {
  return snapshot?.findings ?? [];
}
