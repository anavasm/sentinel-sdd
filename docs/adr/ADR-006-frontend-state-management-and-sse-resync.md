# ADR-006: Frontend State Management and SSE Reconnection/Resync Strategy

- **Status:** Accepted
- **Date:** 2026-09-29
- **Decides:** Streaming state model for the SSE audit stream in `mfe-metrics` — a custom `useAgentStream` hook over native `EventSource`, with envelope-id deduplication, in-order rendering, `Last-Event-ID` resync, and terminal-aware reconnection — and the split between TanStack Query (REST state) and the hook (stream state)
- **Sources:** `docs/ARCHITECTURE.md` §2 (custom SSE hook), ASD §3.1 (NFR-P1 < 500ms, NFR-A2 in-order), backend ADR-001 (SSE framing, D-6, `Last-Event-ID`), backend ADR-004 (1000-event buffer), `docs/plans/implementation-plan-mfe.md` (D-WEB-1, D-WEB-5)
- **Supersedes:** None
- **Related:** ADR-005 (MFE topology), ADR-003 (hub as server-side validator of record), ADR-002 (degradation events)

## Context

`mfe-metrics` must render every SSE event within the 500ms budget (NFR-P1), strictly in order (NFR-A2), while remaining correct across reconnects. The backend contract is already fixed (ADR-001):

- Frames are `id: <n>` / `event: <type>` / `data: <JSON>` + blank line, with `retry: 5000` on connect; the envelope `id` is a monotonic per-audit sequence starting at 1 (D-6).
- The server buffers the last 1000 events per audit, replays from the `Last-Event-ID` cursor, and closes the connection after the terminal `AUDIT_COMPLETED` (D-API-6). A cursor older than the buffer resumes from buffer **end** (possible gap).
- Unknown audits yield a 404 Problem **before** any stream header (D-3); a client that blindly retries would loop forever against a dead session.

Client-side alternatives considered:

1. **TanStack Query for the stream** (e.g., one cache entry per event) — rejected: query caching assumes a single current value per key; an ordered append-only log with dedup/resync semantics fights the library instead of using it.
2. **`fetch` + manual SSE parsing** — rejected: no benefit, since the browser's native `EventSource` already performs automatic reconnection *with* the `Last-Event-ID` header, which is exactly the resync primitive the server was built for (D-6).
3. **Redux/Zustand global event store** — rejected: stream state is local to the metrics view; a global store adds surface without benefit (§5.3 simplicity).

## Decision

**Two state domains, two mechanisms (D-WEB-5):**

1. **REST server state → TanStack Query:** `POST /audits` (mutation in `mfe-config`), `GET /audits/{id}` (query in `mfe-metrics`, used for reconciliation), Problem parsing from the shared API client.
2. **Stream state → `useAgentStream(auditId)` custom hook, local to `mfe-metrics`, over native `EventSource`:**

   - **Connection lifecycle:** `streamStatus ∈ { connecting, open, resyncing, closed, error }`, driven by `onopen`/`onerror`; the server's `retry: 5000` hint governs browser auto-reconnect.
   - **Dedup + ordering:** an append-only reducer keyed by envelope `id` — duplicate ids are dropped; a replayed batch (after reconnect) is merged without duplicating already-rendered events; out-of-order arrivals are buffered and sorted by `id`; the already-rendered live tail is never re-ordered.
   - **Resync:** automatic reconnection rides on the browser's native `Last-Event-ID` header (the server resumes strictly after it — ADR-001). On a manual/terminal-error reconnect the hook re-subscribes fresh; if the previous cursor is older than the server's buffer (gap detection: first replayed id > lastSeenId + 1), the hook reconciles findings via `GET /audits/{id}` and surfaces a "some early events may be missing" banner.
   - **Client-side contract gate:** every `data:` payload is validated against `specs/events-schema.json` via the shared validators (ADR-007) — dev mode throws loudly; production discards, logs, and counts anomalies. Invalid frames are never rendered.
   - **Terminal awareness:** `AUDIT_COMPLETED` (either status) sets `closed` and **cancels reconnection** — the server closes the socket itself (D-API-6), so a reconnect loop would hammer a dead session. Scope guard: events whose envelope `auditId` ≠ route param are discarded (NFR-S3).

### Code references (planned placement — no code written yet; backend references are live)

| Concern | Location |
|---|---|
| Hook + reducer | `apps/mfe-metrics/src/hooks/useAgentStream.ts` |
| REST reconciliation query | `apps/mfe-metrics` — `useQuery(GET /audits/{id})` (openapi `getAudit`), Problem-typed 404 → "not found" view |
| Wire format consumed | `@sentinel/api` `src/sse/serializer.ts` — `serializeSseFrame` (`id:`/`event:`/`data:`), `serializeSseRetryHint` (`retry: 5000`), `SSE_RESPONSE_HEADERS`; mock parity via `packages/contracts` `serializeSseEvents` |
| Server resync semantics | `@sentinel/api` `src/sse/hub.ts` — `parseLastEventId`, `resumeCursorFor`, `subscribeToAuditStream` (replay-then-close) |
| Server terminal close | `@sentinel/api` `src/sse/hub.ts` — `closeAllSubscribers` on `AUDIT_COMPLETED`; 404-before-headers in `src/routes/audits.ts` — `streamAuditHandler` (D-3) |
| Event fixtures (tests) | `packages/contracts/src/fixtures/events.ts` — happy + failure sequences incl. degradation parity with `apps/api/src/agent/stub-runner.ts` |

## Consequences

### Pros

- **Resync correctness by protocol:** dedup + `Last-Event-ID` + server replay reuse the exact semantics the backend already guarantees (D-6), so reconnects are gap-free in the common case without custom headers or polling.
- **Rendering performance:** append-only reducer with stable per-event rows keeps per-event work O(1) and honors NFR-P1; no framework cache invalidation on the hot path.
- **Testability:** the reducer is a pure function (unit-testable); the hook is integration-tested against MSW SSE streaming with deterministic fixture sequences (ASD §10.3).
- **Graceful degradation UX:** gap banners, `resyncing`/`error` statuses, and terminal close give the dashboard honest state instead of silent staleness.

### Cons

- **Gap window after buffer eviction:** if a client disconnects long enough for the server to evict past its cursor (1000-event cap, ADR-004), the server resumes from buffer end; the UI must show the gap banner rather than fake continuity — accepted for the PoC.
- **Dedup requires id discipline:** the strategy assumes the server's monotonic ids (D-6). Any future multi-node backend sharding the sequence would need a redesign (single hub, single process today — ADR-003/004).
- **No cross-tab sharing:** two tabs on the same audit each hold their own EventSource and reducer; harmless (the hub fans out per connection) but doubles connections — acceptable at PoC scale.
- **Native `EventSource` cannot send custom headers on the *initial* request**, so first-connect customization (e.g., a future API-key header, NFR-S1) would force the `fetch`-based parser. Reserved as an evolution path; not needed for the no-auth PoC.

## Status

**Accepted** (2026-09-29). Implementation tracked by `docs/plans/implementation-plan-mfe.md` US-3 (hook, dedup, resync) and US-4 (reconciliation view).
