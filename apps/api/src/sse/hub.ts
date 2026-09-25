import type { SentinelAISSEEventContract } from '@sentinel/contracts';

import { validateSentinelEvent } from '../lib/validators.js';
import {
  appendFindings,
  findAuditById,
  setAuditSummary,
  transitionAuditStatus,
} from '../store/audits.js';

/**
 * Per-audit SSE event hub (plan US-4, Task 4.1 — ASD §6.1 stream fan-out).
 *
 * Responsibilities (single place, validator of record per ASD §6.1):
 *  - assigns the monotonic per-audit sequence id (starts at 1, D-6) and
 *    validates every event against specs/events-schema.json before it is
 *    buffered or fanned out — a contract-violating event is a programming
 *    error: it is logged loudly and replaced by a terminal AUDIT_COMPLETED
 *    `failed` event so no stream is ever left open (NFR-A3);
 *  - drives session state on emission (US-3 store): `queued → running` on
 *    the first event, findings accumulation on VULNERABILITY_FOUND, and the
 *    terminal transition + summary on AUDIT_COMPLETED;
 *  - buffers the last MAX_BUFFERED_EVENTS events per audit (D-API-4) for
 *    replay and Last-Event-ID resync;
 *  - fans out to any number of concurrent subscribers (each with its own
 *    cursor), writing each frame immediately (NFR-P1 — flush per event,
 *    never batched) and closing subscribers once a terminal event has been
 *    delivered (D-API-6).
 */

/** Event buffer cap per audit (D-API-4; replay must terminate). */
const MAX_BUFFERED_EVENTS = 1000;

export interface HubSubscriptionHandlers {
  /** Called for every event delivered to this subscriber (replay or live). */
  readonly onEvent: (event: SentinelAISSEEventContract) => void;
  /** Called once after the terminal AUDIT_COMPLETED event was delivered. */
  readonly onClose: () => void;
}

export interface SubscribeOptions {
  /** SSE `Last-Event-ID`: resume strictly after this event id (D-6). */
  readonly lastEventId?: number | undefined;
}

interface Subscription {
  deliver(event: SentinelAISSEEventContract): void;
  close(): void;
}

interface AuditChannel {
  readonly subscribers: Set<Subscription>;
  readonly buffer: SentinelAISSEEventContract[];
}

const channels = new Map<string, AuditChannel>();

function getChannel(auditId: string): AuditChannel {
  let channel = channels.get(auditId);
  if (channel === undefined) {
    channel = { subscribers: new Set(), buffer: [] };
    channels.set(auditId, channel);
  }
  return channel;
}

/** Parses a raw `Last-Event-ID` header; `undefined` when absent/non-numeric. */
export function parseLastEventId(headerValue: string | undefined): number | undefined {
  if (headerValue === undefined || headerValue.trim() === '') {
    return undefined;
  }
  const parsed = Number(headerValue);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return undefined;
  }
  return parsed;
}

/** Cursor to resume from for a given header value (defensive, plan §3.2). */
function resumeCursorFor(lastEventId: number | undefined, bufferedCount: number): number {
  // Missing header → full replay from the start of the buffer.
  if (lastEventId === undefined) {
    return 0;
  }
  // Non-numeric / beyond-buffer ids resume from the end of the buffer.
  if (lastEventId >= bufferedCount) {
    return bufferedCount;
  }
  return lastEventId;
}

/**
 * Emits an event into the audit channel: assigns the monotonic sequence id,
 * validates against specs/events-schema.json, drives session state, buffers
 * and fans out with immediate flush.
 *
 * Returns the emitted envelope (with its assigned id), or `undefined` when
 * the audit is unknown.
 */
export function emitAuditEvent(
  auditId: string,
  event: Omit<SentinelAISSEEventContract, 'id'> & { id?: number },
): SentinelAISSEEventContract | undefined {
  const audit = findAuditById(auditId);
  if (audit === undefined) {
    return undefined;
  }

  // Terminal audits are frozen (US-3): late emissions are a caller bug and
  // are ignored so no orphan frames follow the terminal event.
  if (audit.status === 'completed' || audit.status === 'failed') {
    return undefined;
  }

  // Session state driven by emission (US-3 semantics).
  if (audit.status === 'queued') {
    transitionAuditStatus(auditId, 'running');
  }

  // D-6: the hub owns the monotonic per-audit sequence, starting at 1.
  const channel = getChannel(auditId);
  const lastBufferedId = channel.buffer.length > 0 ? channel.buffer.at(-1)?.id ?? 0 : 0;
  const sequenceId = lastBufferedId + 1;
  const envelope: SentinelAISSEEventContract = {
    ...event,
    id: sequenceId,
    auditId,
  } as SentinelAISSEEventContract;

  // Hub is the validator of record: invalid events never reach the wire.
  if (!validateSentinelEvent(envelope)) {
    const ajvErrors = validateSentinelEvent.errors
      ?.map((error) => `${error.instancePath} ${error.message ?? ''}`)
      .join('; ');
    console.error(
      `[sse] contract-violating event rejected for audit ${auditId}: ${ajvErrors ?? 'unknown'}`,
    );
    return emitTerminalFailure(auditId, sequenceId);
  }

  if (envelope.type === 'VULNERABILITY_FOUND') {
    appendFindings(auditId, [envelope.payload]);
  }
  if (envelope.type === 'AUDIT_COMPLETED') {
    const nextStatus = envelope.payload.status === 'failed' ? 'failed' : 'completed';
    transitionAuditStatus(auditId, nextStatus);
    const summary = envelope.payload.summary;
    if (summary !== undefined) {
      setAuditSummary(auditId, summary);
    }
  }

  channel.buffer.push(envelope);
  if (channel.buffer.length > MAX_BUFFERED_EVENTS) {
    channel.buffer.shift();
  }

  fanOut(channel, envelope);

  if (envelope.type === 'AUDIT_COMPLETED') {
    closeAllSubscribers(channel);
  }

  return envelope;
}

/** Direct delivery for an already-valid envelope (bypasses re-validation). */
function fanOut(channel: AuditChannel, envelope: SentinelAISSEEventContract): void {
  for (const subscription of channel.subscribers) {
    subscription.deliver(envelope);
  }
}

function closeAllSubscribers(channel: AuditChannel): void {
  for (const subscription of [...channel.subscribers]) {
    subscription.close();
  }
}

/** Fails the audit with a terminal AUDIT_COMPLETED event (plan §4, outbound rule). */
function emitTerminalFailure(auditId: string, sequenceId: number): SentinelAISSEEventContract {
  const failedEvent: SentinelAISSEEventContract = {
    id: sequenceId,
    type: 'AUDIT_COMPLETED',
    timestamp: new Date().toISOString(),
    auditId,
    payload: { status: 'failed', error: 'Internal event validation failed; audit aborted.' },
  };
  transitionAuditStatus(auditId, 'failed');
  const channel = getChannel(auditId);
  channel.buffer.push(failedEvent);
  if (channel.buffer.length > MAX_BUFFERED_EVENTS) {
    channel.buffer.shift();
  }
  fanOut(channel, failedEvent);
  closeAllSubscribers(channel);
  return failedEvent;
}

export interface SubscribeResult {
  /** Removes the subscription (client disconnect / request close). */
  unsubscribe(): void;
}

/**
 * Subscribes a connection to an audit's ordered event stream.
 *
 * Replays buffered events strictly after `lastEventId` (resync, D-6), then
 * delivers live emissions. When the audit is already terminal the replay
 * ends with the buffered terminal AUDIT_COMPLETED event and the subscriber
 * is closed (D-API-6) — replay-then-close.
 *
 * Returns `null` when the audit is unknown (the controller resolves 404s
 * before subscribing; this guard is defense in depth).
 */
export function subscribeToAuditStream(
  auditId: string,
  handlers: HubSubscriptionHandlers,
  options: SubscribeOptions = {},
): SubscribeResult | null {
  const audit = findAuditById(auditId);
  if (audit === undefined) {
    return null;
  }

  const channel = getChannel(auditId);
  const isTerminal = audit.status === 'completed' || audit.status === 'failed';

  const subscription: Subscription = {
    deliver(event) {
      handlers.onEvent(event);
    },
    close() {
      if (channel.subscribers.has(subscription)) {
        channel.subscribers.delete(subscription);
        handlers.onClose();
      }
    },
  };

  // Replay from the resync cursor, then keep the subscription for live events.
  const buffered = [...channel.buffer];
  const cursor = resumeCursorFor(options.lastEventId, buffered.length);
  for (const event of buffered.slice(cursor)) {
    handlers.onEvent(event);
  }

  if (isTerminal) {
    // Every buffered event incl. the terminal one was just delivered.
    handlers.onClose();
    return { unsubscribe: () => {} };
  }

  channel.subscribers.add(subscription);
  return {
    unsubscribe() {
      channel.subscribers.delete(subscription);
    },
  };
}

/** Clears all channels — test isolation helper (in-memory by design). */
export function resetSseHub(): void {
  channels.clear();
}
