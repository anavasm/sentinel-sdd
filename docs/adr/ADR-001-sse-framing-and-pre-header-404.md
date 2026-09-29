# ADR-001: SSE Frame Format and 404-before-Headers for the Audit Stream

- **Status:** Accepted
- **Date:** 2026-09-29
- **Decides:** D-3 (SSE 404 before headers), D-6 (event `id` = monotonic per-audit sequence, doubles as the SSE `id:` field)
- **Sources:** `docs/plans/implementation-plan-specs-contracts.md` §Decisions, `docs/plans/implementation-plan-apps-api.md` §3.1, ASD §6.1
- **Supersedes:** None
- **Related:** ADR-002 (degradation as SSE data), ADR-003 (hub as validator of record)

## Context

The `GET /api/v1/audits/{auditId}/stream` endpoint is the only real-time channel between the backend (`apps/api`) and the `mfe-metrics` frontend. Two wire-level problems had to be settled before US-4 could be implemented:

1. **Unknown or malformed audit ids on the stream endpoint.** An SSE response is a 200 with `Content-Type: text/event-stream` and an *open-ended* body. If a server sets those headers first and *then* discovers the audit does not exist, the client receives a "successful" stream that carries no events and never closes cleanly — a half-open stream on a dead session. Browsers (`EventSource`) also treat early header mismatch as a reconnect loop trigger.

2. **Frame identity and resync.** Clients that reconnect (network blip, page reload) must resume *strictly after* the last event they saw, and delivery per audit must remain strictly in order (NFR-A2). SSE natively supports this via the `id:` field and the `Last-Event-ID` request header — but only if the event identity is a stable, monotonically increasing value owned by a single component.

## Decision

**D-3 — Resolve the 404 before any `text/event-stream` header is set.**
The stream controller validates the path param against the openapi `auditId` pattern and looks the audit up in the store *before* writing any header. Unknown ids and pattern violations get an RFC 9457 Problem Details 404 (`type: not-found`) like every other endpoint — never an opened event stream.

**D-6 — The hub assigns a monotonic per-audit sequence number, starting at 1, and the envelope `id` doubles as the SSE `id:` field.**
Framing is fixed and mirrors `@sentinel/contracts` exactly so MSW-mocked and real streams are indistinguishable:

```
id: <envelope.id>\nevent: <envelope.type>\ndata: <envelope JSON>\n\n
```

A `retry: 5000` hint is written once at stream open. Reconnects resume strictly after the `Last-Event-ID` cursor via buffered replay.

### Code references (`@sentinel/api`)

| Concern | Location |
|---|---|
| 404 resolved before headers (pattern check + store lookup precede `writeHead`) | `src/routes/audits.ts` — `streamAuditHandler` (the `throw notFoundProblem(...)` guards precede `res.writeHead(200, SSE_RESPONSE_HEADERS)`) |
| Fixed SSE response headers (`text/event-stream`, `no-cache`, `keep-alive`) | `src/sse/serializer.ts` — `SSE_RESPONSE_HEADERS` |
| Frame format `id:`/`event:`/`data:` + trailing blank line | `src/sse/serializer.ts` — `serializeSseFrame()` |
| One-time `retry:` hint (5000 ms) | `src/sse/serializer.ts` — `serializeSseRetryHint()`, `SSE_RETRY_HINT_MS` |
| Hub owns the monotonic sequence starting at 1 | `src/sse/hub.ts` — `emitAuditEvent()` (`const sequenceId = lastBufferedId + 1`) |
| `Last-Event-ID` parsing and resync cursor | `src/sse/hub.ts` — `parseLastEventId()`, `resumeCursorFor()`; consumed in `src/routes/audits.ts` — `streamAuditHandler` |
| Replay-then-live subscription with per-subscriber cursor | `src/sse/hub.ts` — `subscribeToAuditStream()` |

## Consequences

### Pros

- **No half-open streams on dead sessions:** a 404 is indistinguishable from every other REST 404, so `EventSource` (and the frontend) fail fast and do not retry a stream that can never produce events.
- **Client resync is protocol-native:** because the envelope `id` is the SSE `id:`, `Last-Event-ID` resync works with zero custom headers or query params, and cannot violate NFR-A2 (the hub assigns the id; the client only echoes it back).
- **Mock/real parity:** the framing is identical to `@sentinel/contracts` `serializeSseEvents`, so MSW-mocked and real streams are indistinguishable to consumers.
- **Single owner for sequence ids:** only the hub can mint ids (`emitAuditEvent`), eliminating races between concurrent producers.

### Cons

- **Buffer-eviction vs. `Last-Event-ID`:** the per-audit buffer is capped at 1000 events (`MAX_BUFFERED_EVENTS`, `src/sse/hub.ts`); a `Last-Event-ID` older than the buffer silently resumes from the buffer end (`resumeCursorFor`), i.e. the client misses events without an explicit "gap" signal. Acceptable for the PoC; a production system would need a `gap`/`reset` event.
- **Strict 404-before-headers ordering is a coding invariant**, not something the framework enforces — it is protected by tests (`apps/api/tests/sse.test.ts`) and documented in the controller, but a refactor could regress it silently.
- **Numeric ids only:** `parseLastEventId` rejects non-integer/negative ids (defensive resync to buffer end), so opaque string event ids would require a mapping layer if ever needed.

## Status

**Accepted** (2026-09-29). Implemented in US-4; covered by `apps/api/tests/sse.test.ts`.
