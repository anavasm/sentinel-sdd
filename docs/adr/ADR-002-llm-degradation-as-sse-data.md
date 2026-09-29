# ADR-002: LLM Degradation Surfaced as SSE Data Events, Never as HTTP Errors

- **Status:** Accepted
- **Date:** 2026-09-29
- **Decides:** NFR-A3 (LLM provider resilience → graceful degradation, surfaced as stream events) and the mitigation of CONCERN-004 (free-tier LLM / Ollama rate limits & availability)
- **Sources:** `docs/asd/03-nfr.md` (NFR-A3), `docs/asd/ASD.md` §risk register (CONCERN-004), `docs/plans/implementation-plan-apps-api.md` §US-4 (US4-AC6)
- **Supersedes:** None
- **Related:** ADR-001 (SSE framing), ADR-003 (hub as validator of record)

## Context

The audit engine depends on an external LLM provider to inspect code snippets. The project explicitly targets **free-tier providers** (rate-limited, throttled) with a **local Ollama fallback** (can be down, slow, or returning malformed output). ASD risk CONCERN-004 and NFR-A3 require that provider throttling or unavailability must **not crash the engine and must not surface as an HTTP error** — the user is watching a live stream, and the stream itself must communicate the degradation.

The alternative designs considered:

1. **HTTP-level signalling** (5xx on the POST/stream, or an out-of-band status endpoint) — rejected: the POST already returned `201` before the runner executes (`setImmediate` kickoff), and the stream is a 200 `text/event-stream` whose headers cannot legally change mid-flight. HTTP semantics are simply unavailable at degradation time.
2. **Silent fallback** (swap to Ollama and keep going without telling anyone) — rejected: hides real degradation from the user, who may be making triage decisions based on incomplete analysis.
3. **Failure as contract events in the stream** — chosen: the SSE channel is already the system's real-time bus, and `TOOL_EXECUTION` already has a `status` field.

## Decision

Every LLM provider problem is **classified and emitted as a contract event on the stream**; it never becomes an HTTP error and never leaves the stream open:

- **Primary provider throttles/fails → degrade to Ollama fallback:** a `TOOL_EXECUTION` event with `status: 'degraded'` naming the provider used and the primary failure detail; the audit continues with the fallback's finding.
- **Both providers down:** a `TOOL_EXECUTION` event with `status: 'failed'`, followed by a terminal `AUDIT_COMPLETED` with `payload.status: 'failed'` — the stream closes cleanly.
- **Any unexpected engine crash** is caught by a top-level guard and also ends in a terminal `AUDIT_COMPLETED { status: 'failed' }`, so *no stream is ever left open* (US4-AC6).

Provider errors are **expected failures modelled as explicit results** (`LlmInspection` union: `succeeded | degraded | unavailable`), not thrown exceptions crossing module boundaries. `LlmProviderError` is confined to adapter internals and mapped to those results.

### Code references (`@sentinel/api`)

| Concern | Location |
|---|---|
| Failure classification (`throttled \| unavailable \| invalid-response`) | `src/agent/llm.ts` — `LlmFailureKind`, `LlmProviderError` (429 → `throttled`, other non-2xx → `unavailable`) |
| Result-union contract for inspections | `src/agent/llm.ts` — `LlmInspection` (`succeeded` / `degraded` / `unavailable`) |
| Primary → Ollama fallback with degradation detail | `src/agent/llm.ts` — `OllamaFallbackLlmClient.inspectSnippet()` (returns `{ ...fallbackResult, status: 'degraded', detail: primaryResult.detail }`) |
| Production default chain (free-tier primary + local Ollama) | `src/agent/llm.ts` — `createDefaultLlmClient()` (`SENTINEL_LLM_ENDPOINT` / `SENTINEL_LLM_MODEL` env overrides) |
| Degraded outcome → `TOOL_EXECUTION { status: 'degraded' }` event, analysis continues | `src/agent/runner.ts` — `SentinelAuditRunner.runAuditSteps()` (the `inspection.status === 'degraded'` branch) |
| Both providers down → `TOOL_EXECUTION { status: 'failed' }` + terminal `AUDIT_COMPLETED { status: 'failed' }` | `src/agent/runner.ts` — `runAuditSteps()` (the `unavailable` branch) and `emitTerminalFailure()` |
| Top-level crash guard → terminal failed event | `src/agent/runner.ts` — `execute()` (`catch` → `console.error` + `emitTerminalFailure`) |
| Terminal event drives store + closes subscribers | `src/sse/hub.ts` — `emitAuditEvent()` (`AUDIT_COMPLETED` → `transitionAuditStatus` → `closeAllSubscribers`) |
| Fixture parity for the failure sequence (MSW/test) | `src/agent/stub-runner.ts` — `failureSequence` (`degraded` → terminal `failed` events) |

## Consequences

### Pros

- **The user sees degradation in real time** — "Falling back to ollama" appears as a `TOOL_EXECUTION degraded` event in the metrics timeline instead of a dead UI or a generic error page.
- **No orphan streams:** every failure path (throttle, both-providers-down, repo read failure, engine crash) deterministically terminates in `AUDIT_COMPLETED`, and the hub closes all subscribers on that event (D-API-6).
- **Testable without network:** because failures are values, tests inject fake `LlmClient`s; the stub runner replays the exact failure sequence as fixtures.
- **Fail-fast validation stays honest:** `localPath` existence checks (400) remain at the HTTP boundary; runtime degradation lives only in the stream, keeping the two layers cleanly separated.

### Cons

- **No automatic retry/backoff on the primary:** the chain is one-shot (primary → Ollama, no re-queue). A rate-limited snippet is simply analyzed by the fallback; retry policies are out of PoC scope.
- **Degradation granularity is per-snippet:** fallback selection happens per `inspectSnippet` call, so a long audit can mix primary and fallback providers across files without a session-level "quality" marker beyond the per-event `degraded` status.
- **Error detail text is truncated** (`truncateText`, `MAX_SNIPPET_LENGTH`) before emission — good for payload hygiene (NFR-S2), but deep provider debugging requires server-side logs (`console.error` in `execute()`), not the stream.

## Status

**Accepted** (2026-09-29). Implemented in US-5; covered by `apps/api/tests/agent.test.ts` (degradation and both-providers-down scenarios).
