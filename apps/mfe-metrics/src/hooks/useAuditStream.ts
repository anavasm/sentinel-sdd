/**
 * Live SSE stream hook for one audit.
 *
 * React owns rendered state; the stream controller below owns transport
 * lifecycle, REST reconciliation, and event reduction. Keeping those seams
 * outside the effect makes each responsibility independently testable.
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

interface StreamControllerCallbacks {
  readonly setEvents: (events: SentinelAISSEEventContract[]) => void;
  readonly setStatus: (status: AuditStreamStatus) => void;
  readonly setSnapshot: (snapshot: Audit) => void;
  readonly setGapDetected: () => void;
}

interface ReconciliationResult {
  readonly exists: boolean;
  readonly terminal: boolean;
}

interface EventAccumulator {
  applySnapshot(snapshot: Audit): void;
  accept(event: SentinelAISSEEventContract): boolean;
  events(): SentinelAISSEEventContract[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAuditEvent(
  value: unknown,
  auditId: string,
  eventName: string,
): value is SentinelAISSEEventContract {
  if (
    !isRecord(value)
    || !Number.isInteger(value.id)
    || Number(value.id) < 1
    || value.auditId !== auditId
    || value.type !== eventName
    || typeof value.timestamp !== 'string'
    || !isRecord(value.payload)
  ) {
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
  if (
    !isRecord(value)
    || value.auditId !== auditId
    || typeof value.status !== 'string'
    || typeof value.createdAt !== 'string'
    || !isRecord(value.config)
    || !Number.isInteger(value.lastEventId)
    || Number(value.lastEventId) < 0
    || (
      value.firstAvailableEventId !== null
      && (!Number.isInteger(value.firstAvailableEventId)
        || Number(value.firstAvailableEventId) < 1)
    )
  ) {
    return false;
  }
  return value.findings === undefined || Array.isArray(value.findings);
}

function logAnomaly(message: string): void {
  console.error(message);
}

function createEventAccumulator(onGap: () => void, onConflict: () => void): EventAccumulator {
  const acceptedEvents = new Map<number, SentinelAISSEEventContract>();
  let acceptedLastEventId = 0;
  let snapshotLastEventId = 0;

  return {
    applySnapshot(snapshot) {
      snapshotLastEventId = Math.max(snapshotLastEventId, snapshot.lastEventId);
      acceptedLastEventId = Math.max(acceptedLastEventId, snapshot.lastEventId);
      if (
        snapshot.firstAvailableEventId !== null
        && acceptedLastEventId + 1 < snapshot.firstAvailableEventId
      ) {
        onGap();
      }
    },
    accept(event) {
      const existing = acceptedEvents.get(event.id);
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(event)) onConflict();
        return false;
      }

      if (event.id > acceptedLastEventId + 1) onGap();
      if (event.id > snapshotLastEventId + 1 && snapshotLastEventId > 0) onGap();
      acceptedEvents.set(event.id, event);
      acceptedLastEventId = Math.max(acceptedLastEventId, event.id);
      return true;
    },
    events() {
      return [...acceptedEvents.values()].sort((left, right) => left.id - right.id);
    },
  };
}

async function fetchAuditSnapshot(
  auditId: string,
  signal: AbortSignal,
): Promise<Audit | 'NOT_FOUND'> {
  const response = await fetch(`${API_BASE_URL}/audits/${auditId}`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (response.status === 404) return 'NOT_FOUND';
  if (!response.ok) {
    throw new Error(`Audit snapshot request failed with status ${response.status}`);
  }
  const body: unknown = await response.json();
  if (!isAuditSnapshot(body, auditId)) {
    throw new Error('Audit snapshot failed runtime validation');
  }
  return body;
}

function createStreamController(
  auditId: string,
  callbacks: StreamControllerCallbacks,
): { start(): void; dispose(): void } {
  let active = true;
  let eventSource: EventSource | undefined;
  let appliedSnapshotEventId = -1;
  const abortController = new AbortController();
  const accumulator = createEventAccumulator(
    callbacks.setGapDetected,
    () => logAnomaly('Discarding conflicting duplicate SSE event'),
  );

  const applySnapshot = (snapshot: Audit): void => {
    if (snapshot.lastEventId <= appliedSnapshotEventId) return;
    appliedSnapshotEventId = snapshot.lastEventId;
    accumulator.applySnapshot(snapshot);
    callbacks.setSnapshot(snapshot);
    if (snapshot.status === 'completed' || snapshot.status === 'failed') {
      callbacks.setStatus('DISCONNECTED');
      eventSource?.close();
    }
  };

  const reconcile = async (): Promise<ReconciliationResult> => {
    try {
      const snapshot = await fetchAuditSnapshot(auditId, abortController.signal);
      if (!active) return { exists: false, terminal: false };
      if (snapshot === 'NOT_FOUND') {
        callbacks.setStatus('NOT_FOUND');
        eventSource?.close();
        return { exists: false, terminal: false };
      }
      applySnapshot(snapshot);
      return {
        exists: true,
        terminal: snapshot.status === 'completed' || snapshot.status === 'failed',
      };
    } catch {
      if (active) {
        callbacks.setStatus('ERROR');
        logAnomaly('Audit snapshot reconciliation failed');
      }
      return { exists: true, terminal: false };
    }
  };

  const handleEvent = (incoming: MessageEvent<string>): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(incoming.data);
    } catch {
      logAnomaly('Discarding malformed SSE JSON frame');
      void reconcile();
      return;
    }

    if (
      !isAuditEvent(parsed, auditId, incoming.type)
      || Number(incoming.lastEventId) !== parsed.id
    ) {
      logAnomaly('Discarding invalid or inconsistent SSE frame');
      void reconcile();
      return;
    }

    if (!accumulator.accept(parsed)) return;
    callbacks.setEvents(accumulator.events());
    if (parsed.type === TERMINAL_EVENT_TYPE) {
      callbacks.setStatus('DISCONNECTED');
      eventSource?.close();
      void reconcile();
    }
  };

  const openStream = (): void => {
    if (!active) return;
    eventSource = new EventSource(`${API_BASE_URL}/audits/${auditId}/stream`);
    eventSource.onopen = () => {
      if (active) callbacks.setStatus('CONNECTED');
    };
    eventSource.onerror = () => {
      if (!active) return;
      callbacks.setStatus('ERROR');
      void reconcile();
    };
    for (const eventType of SSE_EVENT_TYPES) {
      eventSource.addEventListener(eventType, handleEvent as EventListener);
    }
  };

  return {
    start() {
      void reconcile().then(({ exists, terminal }) => {
        if (active && exists && !terminal) openStream();
      });
    },
    dispose() {
      active = false;
      abortController.abort();
      if (eventSource !== undefined) {
        eventSource.onopen = null;
        eventSource.onerror = null;
        for (const eventType of SSE_EVENT_TYPES) {
          eventSource.removeEventListener(eventType, handleEvent as EventListener);
        }
        eventSource.close();
      }
    },
  };
}

export function useAuditStream(auditId: string | undefined): AuditStreamState {
  const [events, setEvents] = useState<SentinelAISSEEventContract[]>([]);
  const [status, setStatus] = useState<AuditStreamStatus>('CONNECTING');
  const [snapshot, setSnapshot] = useState<Audit | undefined>();
  const [gapDetected, setGapDetected] = useState(false);

  useEffect(() => {
    setEvents([]);
    setSnapshot(undefined);
    setGapDetected(false);
    setStatus('CONNECTING');
    if (!auditId) return undefined;

    const controller = createStreamController(auditId, {
      setEvents,
      setStatus,
      setSnapshot,
      setGapDetected: () => setGapDetected(true),
    });
    controller.start();
    return () => controller.dispose();
  }, [auditId]);

  return { events, status, snapshot, gapDetected };
}

export function snapshotFindings(snapshot: Audit | undefined): readonly AuditFinding[] {
  return snapshot?.findings ?? [];
}
