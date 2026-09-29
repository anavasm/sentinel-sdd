# ADR-004: In-Memory Audit State Machine with Frozen Terminal States

- **Status:** Accepted
- **Date:** 2026-09-29
- **Decides:** US-3 / D-API-4 — audit session state lives in an in-process `Map` with an explicit lifecycle graph (`queued → running → completed | failed`), immutable terminal states, a bounded per-audit event buffer (1000 events), and findings accumulated only from validated stream events
- **Sources:** `docs/plans/implementation-plan-apps-api.md` §US-3 (Task 3.1) & §US-4 Task 4.1 (D-API-4), ASD §8.1 (in-memory data architecture), openapi `Audit`/`AuditStatus` semantics
- **Supersedes:** None
- **Related:** ADR-003 (hub drives the state machine), ADR-001 (buffer supports replay/resync)

## Context

`GET /api/v1/audits/{auditId}` must return the session-scoped audit resource — config echo, RFC 3339 `createdAt`, findings accumulated so far, and a summary once terminal — consistent with what the SSE stream is delivering concurrently. The project is a **15-day, $0 PoC** whose ASD explicitly mandates in-memory persistence with no database and no migrations (ASD §5, §8.1), while still demanding correctness guarantees:

- Transitions must follow the openapi lifecycle: `queued → running → completed | failed`; terminal states have no outgoing edges.
- Once terminal, the audit is **frozen**: no late findings, no second summary, no orphan SSE frames after `AUDIT_COMPLETED`.
- Replay and `Last-Event-ID` resync (D-6) require a bounded buffer that is guaranteed to terminate.
- The runner is the only producer; anything else mutating state (double transitions, findings after completion) is a caller bug, not a data condition to recover from.

## Decision

**Keep the audit state machine in process memory (`Map<string, Audit>`), with an explicit transition table and throw-on-violation semantics, and cap the SSE replay buffer at 1000 events.**

Specifically:

1. **Explicit lifecycle graph** encoded as a transition table; an invalid transition throws (caller bug — loud, not silent):
   `queued → running → completed | failed`; `completed`/`failed` → *nothing*.
2. **Terminal audits are frozen:** `appendFindings` and late `emitAuditEvent` calls on a terminal audit throw / are ignored respectively; `setAuditSummary` throws on non-terminal audits.
3. **Findings are accumulated only from validated stream events** (hub-driven, per ADR-003), so the REST snapshot and the SSE stream can never disagree.
4. **Event buffer cap of 1000 per audit (D-API-4):** replay must terminate; the oldest events are shifted out FIFO. Replay delivers from the resync cursor to buffer end, then closes for terminal audits (replay-then-close, D-API-6).
5. **Restart loses all session state — accepted and documented** (PoC limitation per ASD §8.1). No write-ahead log, no SQLite, no Redis.
6. **Test isolation is explicit:** `resetAuditStore()` / `resetSseHub()` exist *because* state is in-memory by design.

### Code references (`@sentinel/api`)

| Concern | Location |
|---|---|
| In-process store, documented PoC limitation | `src/store/audits.ts` — module header ("No database, no migrations; server restart loses all session state"), `const audits = new Map<string, Audit>()` |
| Explicit lifecycle transition table | `src/store/audits.ts` — `VALID_TRANSITIONS` |
| Throw on invalid transition (caller bug) | `src/store/audits.ts` — `transitionAuditStatus()` |
| Frozen terminal state for findings | `src/store/audits.ts` — `appendFindings()` (`Cannot append findings to terminal audit`) |
| Summary only on terminal audits | `src/store/audits.ts` — `setAuditSummary()` |
| Buffer cap 1000 / FIFO eviction (D-API-4) | `src/sse/hub.ts` — `MAX_BUFFERED_EVENTS`, shift in `emitAuditEvent()` and `emitTerminalFailure()` |
| Hub-driven state transitions (single writer) | `src/sse/hub.ts` — `emitAuditEvent()` (`transitionAuditStatus`, `appendFindings`, `setAuditSummary` calls) |
| Replay-then-close for terminal audits (D-API-6) | `src/sse/hub.ts` — `subscribeToAuditStream()` (`isTerminal` branch) |
| Terminal audits ignore late emissions | `src/sse/hub.ts` — `emitAuditEvent()` early return |
| Audit id pattern shared by generation and validation | `src/store/audits.ts` — `AUDIT_ID_PATTERN`, `generateAuditId()`; consumed by `src/routes/audits.ts` — `getAuditHandler` |
| In-memory reset for tests | `src/store/audits.ts` — `resetAuditStore()`; `src/sse/hub.ts` — `resetSseHub()` |

## Consequences

### Pros

- **Zero operational cost:** no DB process, no migrations, no connection pool — directly serving the ASD's "$0 PoC, avoid abstractions that don't serve the MVP" principle.
- **Strong consistency by construction:** a single `Map` in a single Node process accessed synchronously means no read-after-write anomalies between `GET /audits/{id}` and the stream; concurrency concerns reduce to fan-out cursors.
- **Bugs are loud, not latent:** throw-on-invalid-transition and frozen terminals turn producer bugs into immediate, testable failures instead of corrupted-but-plausible state.
- **Bounded memory:** the 1000-event cap makes worst-case memory per audit predictable and replay bounded.

### Cons

- **All session state is lost on restart or crash** — in-flight audits vanish mid-stream; clients get 404s for ids that existed minutes ago. Acceptable only because the PoC has no persistence requirement (ASD §8.1); any productionization must introduce a durable store behind the same store functions.
- **Single-process ceiling:** the design assumes one Node process. Horizontal scaling (multiple replicas) would break fan-out, replay, and the shared `Map` — a load-balancer stickiness or pub/sub layer would be required.
- **Unbounded audit growth in the Map:** audits are never evicted from `audits` (only the event buffer is capped). A long-lived PoC instance accumulates memory; acceptable for demos, noted as a deliberate shortcut.
- **Frozen terminals are one-shot:** there is no "re-run audit" concept — rerunning means a new audit id. If idempotent re-execution is ever needed, the lifecycle graph must grow a new edge.

## Status

**Accepted** (2026-09-29). Implemented in US-3/US-4; lifecycle, freezing, and buffer-cap behavior covered by `apps/api/tests/audits.test.ts` and `apps/api/tests/sse.test.ts`.
