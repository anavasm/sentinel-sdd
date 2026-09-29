# ADR-003: The SSE Hub is the Single Validator of Record for All Outbound Events

- **Status:** Accepted
- **Date:** 2026-09-29
- **Decides:** ASD §6.1 — the per-audit SSE hub is the single place where every outbound event is validated against `specs/events-schema.json`, where the sequence id is assigned, and where session state is driven
- **Sources:** ASD §6.1 ("single place, validator of record"), plan decision D-API-1 (`@sentinel/contracts` runtime validators export), `docs/plans/implementation-plan-apps-api.md` §US-4 Task 4.1
- **Supersedes:** None
- **Related:** ADR-001 (id assignment/framing), ADR-002 (degradation events), ADR-004 (state machine)

## Context

Multiple producers can emit events for the same audit: the real `SentinelAuditRunner`, the fixture-driven `stub-runner`, and the hub itself (terminal failure substitution). Every one of those events goes to the wire as an SSE frame whose `data:` payload must validate against the normative `specs/events-schema.json` (draft-07, `oneOf` discriminator over the 4 core event types) — ASD §5.5 mandates Before/After snippets on every `VULNERABILITY_FOUND`, and the frontend renders strictly what the schema says.

Validating in each producer would mean:

- **Duplicated Ajv compilation and error mapping** in the runner, the stub runner, and any future producer (DRY violation, and drift risk against the contracts package);
- **No guarantee of coverage** — a new producer (a scheduled job, a manual replay tool) silently skips validation;
- **Divergent id assignment**, breaking the monotonic per-audit sequence that `Last-Event-ID` resync depends on (D-6, NFR-A2).

The `@sentinel/contracts` package already ships the Ajv validator compiled from `/specs` (never restated), per plan decision D-API-1 — so a single choke point is cheap.

## Decision

**The hub (`src/sse/hub.ts`) is the validator of record.** All producers emit through one function — `emitAuditEvent()` — which, in order:

1. **Guards the audit lifecycle:** unknown audit ids return `undefined`; terminal audits are frozen and late emissions are ignored (caller bug, no orphan frames after the terminal event).
2. **Drives session state on emission (US-3 semantics):** `queued → running` on the first event, findings accumulation on `VULNERABILITY_FOUND`, terminal transition + summary on `AUDIT_COMPLETED`.
3. **Owns the monotonic sequence id** starting at 1 (D-6).
4. **Validates the complete envelope** with the shared Ajv validator before buffering or fan-out — *no contract-violating frame ever reaches the wire*.
5. **Treats a validation failure as a programming error:** it is logged loudly (`console.error` with the Ajv error list) and replaced by a terminal `AUDIT_COMPLETED { status: 'failed' }` so no stream is ever left open (NFR-A3) — the subscriber never sees an invalid frame, and never sees a hung connection either.
6. **Buffers and fans out** to any number of concurrent subscribers, each with its own cursor, writing each frame immediately (NFR-P1 — flush per event, never batched).

### Code references (`@sentinel/api`)

| Concern | Location |
|---|---|
| Single emission entry point (validate → state → buffer → fan out) | `src/sse/hub.ts` — `emitAuditEvent()` (documented as "validator of record per ASD §6.1") |
| Shared Ajv validator compiled from `/specs`, never restated | `src/lib/validators.ts` — `validateSentinelEvent` (imports `specs/events-schema.json`; documented "hub is the validator of record (ASD §6.1)") |
| Contract-violating event → loud log + terminal failed event | `src/sse/hub.ts` — `emitAuditEvent()` rejection branch → `emitTerminalFailure()` |
| Validation-before-buffer ordering | `src/sse/hub.ts` — `emitAuditEvent()` (`validateSentinelEvent(envelope)` precedes `channel.buffer.push(envelope)` and `fanOut()`) |
| Producers only call the hub, never the wire | `src/agent/runner.ts` — `emitThought()` / `emitToolEvent()` / `emitFinding()` / `emitTerminalFailure()` all call `emitAuditEvent`; `src/agent/stub-runner.ts` — fixture emission |
| Per-event immediate flush (NFR-P1) | `src/sse/hub.ts` — `fanOut()` per emission; `src/routes/audits.ts` — `onEvent` → `res.write(serializeSseFrame(event))` |
| Terminal audits frozen (no orphan frames) | `src/sse/hub.ts` — `emitAuditEvent()` early return for `completed`/`failed` |

## Consequences

### Pros

- **Contract enforcement is structural, not conventional:** one choke point means one audit point; no producer can bypass validation without deliberately circumventing the hub.
- **DRY:** one Ajv compile, one error-formatting rule, one id-assignment rule, shared with the contracts gate (`packages/contracts/src/validate.ts` compiles the same schema).
- **State and stream cannot drift:** because state transitions (`src/store/audits.ts` — `transitionAuditStatus`, `appendFindings`, `setAuditSummary`) are driven by the *same validated emission* that fans out, `GET /audits/{id}` always reflects exactly what the stream delivered.
- **Open/Closed:** new producers (cron replays, future audit engines) only need to call `emitAuditEvent`; they inherit validation, sequencing, buffering, and fan-out.

### Cons

- **Hub is a god-module risk:** it currently owns validation, sequencing, state-driving, buffering, and fan-out. For the PoC this concentration is deliberate (ASD §5 "keep seams where growth is likely"), but it must be split if persistence or multi-node fan-out arrives.
- **Terminal-failure substitution changes the event:** an invalid event is replaced by `AUDIT_COMPLETED { status: 'failed' }` — the offending payload is only in server logs, not on the wire. This is correct for contract integrity but means clients cannot report the original malformed payload.
- **Validation is synchronous on the emission path:** Ajv runs per event on the hot path; at PoC volumes this is negligible, but high-throughput streams would want compiled-validators-per-event-type caching (already partially achieved via the single compiled `oneOf` validator).

## Status

**Accepted** (2026-09-29). Implemented in US-4; contract-violation handling covered by `apps/api/tests/sse.test.ts`.
