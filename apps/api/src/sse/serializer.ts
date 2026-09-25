import type { SentinelAISSEEventContract } from '@sentinel/contracts';

/**
 * SSE wire serializer (plan US-4, Task 4.2 / D-6).
 *
 * Mirrors `@sentinel/contracts` `serializeSseEvents` framing exactly so
 * MSW-mocked and real streams are indistinguishable to consumers:
 *
 *   id: <envelope.id>\nevent: <envelope.type>\ndata: <envelope JSON>\n\n
 *
 * The envelope `id` doubles as the SSE `id:` field (D-6), enabling
 * `Last-Event-ID` resync on the client side.
 */

/** Reconnect hint written once on connect (matches the contracts serializer). */
export const SSE_RETRY_HINT_MS = 5000;

/** Headers mandated for the live stream (openapi stream 200 response). */
export const SSE_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
};

/** Serializes a single contract event into one SSE frame (trailing blank line). */
export function serializeSseFrame(event: SentinelAISSEEventContract): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Serializes the `retry:` reconnect hint emitted once at stream open. */
export function serializeSseRetryHint(): string {
  return `retry: ${SSE_RETRY_HINT_MS}\n`;
}
