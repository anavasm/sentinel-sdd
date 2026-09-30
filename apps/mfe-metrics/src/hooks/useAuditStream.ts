/**
 * Live SSE stream hook for the per-audit channel (US-3, D-WEB-1 / ADR-006).
 *
 * Connects a native `EventSource` to `GET {API_BASE_URL}/audits/{auditId}/stream`
 * and accumulates contract-typed events as they arrive. The backend frames each
 * event as a *named* SSE event (`event: <envelope.type>`, ADR-001 D-6), so the
 * hook subscribes per event type instead of relying on `onmessage`.
 *
 * Lifecycle:
 *  - auditId undefined → no connection (idle 'CONNECTING', no EventSource).
 *  - onopen → 'CONNECTED'.
 *  - 'AUDIT_COMPLETED' (terminal event, either status) → 'DISCONNECTED' and the
 *    EventSource is explicitly closed, cancelling the browser auto-reconnect
 *    (D-API-6: reconnecting would hammer a dead session).
 *  - onerror → 'ERROR' (the browser keeps auto-reconnecting per the server's
 *    `retry:` hint; the EventSource remains owned by the hook).
 *  - unmount → `eventSource.close()` in the effect cleanup (clean teardown).
 */
import { useEffect, useState } from 'react';
import type { SentinelAISSEEventContract } from '@sentinel/contracts';

/** Connection lifecycle of the audit stream (US-3 requirement). */
export type AuditStreamStatus = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

/** Terminal SSE event type that closes the stream (ADR-001 D-6 envelope types). */
const TERMINAL_EVENT_TYPE = 'AUDIT_COMPLETED';

/** Every named SSE event type emitted by the hub (ADR-001 framing). */
const SSE_EVENT_TYPES = [
  'AGENT_THOUGHT',
  'TOOL_EXECUTION',
  'VULNERABILITY_FOUND',
  TERMINAL_EVENT_TYPE,
] as const;

const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';

export interface AuditStreamState {
  /** Ordered, accumulated contract events received so far (append-only). */
  events: SentinelAISSEEventContract[];
  /** Connection lifecycle indicator for the status badge. */
  status: AuditStreamStatus;
}

/**
 * Subscribes to the live audit stream for `auditId`.
 *
 * Returns the accumulated event list plus the connection status. A new
 * EventSource is opened per auditId and always closed on unmount or auditId
 * change; per-effect local variables guarantee no cross-audit event leakage.
 */
export function useAuditStream(auditId: string | undefined): AuditStreamState {
  const [events, setEvents] = useState<SentinelAISSEEventContract[]>([]);
  const [status, setStatus] = useState<AuditStreamStatus>('CONNECTING');

  useEffect(() => {
    // Without an auditId there is nothing to stream; surface the idle state and
    // reset any events from a previously streamed audit.
    if (!auditId) {
      setEvents([]);
      setStatus('CONNECTING');
      return undefined;
    }

    setEvents([]);
    setStatus('CONNECTING');

    const eventSource = new EventSource(`${API_BASE_URL}/audits/${auditId}/stream`);

    eventSource.onopen = () => {
      setStatus('CONNECTED');
    };

    eventSource.onerror = () => {
      // The browser auto-reconnects (server `retry: 5000` hint). Keep the
      // EventSource open so the reconnect carries the Last-Event-ID cursor.
      setStatus('ERROR');
    };

    const appendEvent = (incoming: MessageEvent<string>): void => {
      let parsedEvent: SentinelAISSEEventContract;
      try {
        parsedEvent = JSON.parse(incoming.data) as SentinelAISSEEventContract;
      } catch (parseError: unknown) {
        // A malformed frame is a data anomaly, not a transport failure — never
        // crash the stream; log for diagnosis and skip the frame.
        console.error('Discarding malformed SSE frame for audit stream', parseError);
        return;
      }

      setEvents((previousEvents) => [...previousEvents, parsedEvent]);

      if (parsedEvent.type === TERMINAL_EVENT_TYPE) {
        // Terminal event: stop the browser auto-reconnect loop explicitly.
        setStatus('DISCONNECTED');
        eventSource.close();
      }
    };

    for (const eventType of SSE_EVENT_TYPES) {
      eventSource.addEventListener(eventType, appendEvent as EventListener);
    }

    return () => {
      eventSource.onopen = null;
      eventSource.onerror = null;
      for (const eventType of SSE_EVENT_TYPES) {
        eventSource.removeEventListener(eventType, appendEvent as EventListener);
      }
      eventSource.close();
    };
  }, [auditId]);

  return { events, status };
}
