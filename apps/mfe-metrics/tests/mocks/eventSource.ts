/**
 * Controllable EventSource mock for SSE stream tests (US-3).
 *
 * Mirrors the surface of the native EventSource that `useAuditStream` relies
 * on: `onopen` / `onerror` handlers, `addEventListener` per named event type
 * (the hub frames events as `event: <type>`, ADR-001), `close()`, and
 * `readyState`. Tests drive the stream deterministically via `emit()` and
 * assert on connections through `instances`.
 */
import { vi } from 'vitest';

/** Readiness constants matching the WHATWG EventSource spec. */
export const EVENT_SOURCE_READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSED: 2,
} as const;

export class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly url: string;
  readyState: number = EVENT_SOURCE_READY_STATE.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  close = vi.fn(() => {
    this.readyState = EVENT_SOURCE_READY_STATE.CLOSED;
  });

  private listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();

  constructor(url: string | URL) {
    this.url = String(url);
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    const existingListeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, [...existingListeners, listener]);
  }

  removeEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    const existingListeners = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      existingListeners.filter((registered) => registered !== listener),
    );
  }

  /** Opens the connection and fires `onopen` (readyState → OPEN). */
  simulateOpen(): void {
    this.readyState = EVENT_SOURCE_READY_STATE.OPEN;
    this.onopen?.(new Event('open'));
  }

  /** Simulates a connection failure (readyState → CONNECTING auto-retry). */
  simulateError(): void {
    this.readyState = EVENT_SOURCE_READY_STATE.CONNECTING;
    this.onerror?.(new Event('error'));
  }

  /** Delivers a named SSE event to every registered listener of `eventType`. */
  emit(eventType: string, data: string): void {
    if (this.readyState === EVENT_SOURCE_READY_STATE.CLOSED) {
      throw new Error(`Cannot emit '${eventType}' — EventSource for ${this.url} is closed`);
    }
    for (const listener of this.listeners.get(eventType) ?? []) {
      listener(new MessageEvent(eventType, { data }));
    }
  }

  /** Latest instance, for tests that open a single stream. */
  static get lastInstance(): MockEventSource | undefined {
    return MockEventSource.instances.at(-1);
  }

  /** Clears the instance registry between tests (invoked from setup.ts). */
  static resetInstances(): void {
    MockEventSource.instances = [];
  }
}
