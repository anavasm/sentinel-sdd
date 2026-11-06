# ADR-002: LLM Degradation Surfaced as SSE Data Events, Never as HTTP Errors

- **Status:** Accepted
- **Date:** 2026-09-29
- **Decides:** NFR-A3 (LLM provider resilience → graceful degradation, surfaced as stream events) and the mitigation of CONCERN-004 (free-tier LLM / Ollama rate limits & availability)
- **Sources:** `docs/asd/03-nfr.md` (NFR-A3), `docs/asd/ASD.md` §risk register (CONCERN-004), `docs/plans/implementation-plan-apps-api.md` §US-4 (US4-AC6)
- **Supersedes:** Provider-selection/default behavior is superseded by ADR-008; degradation-as-event semantics remain in force.
- **Related:** ADR-001 (SSE framing), ADR-003 (hub as validator of record), ADR-008 (local-first provider and egress policy)

## Context

The audit engine depends on an LLM provider to inspect code snippets. This ADR originally assumed a **free-tier external provider as primary** with **local Ollama fallback**. ADR-008 supersedes that provider ordering: local Ollama is now the default, and external providers are disabled unless the server operator explicitly opts in. The failure behavior in this ADR continues to apply to whichever provider is enabled: provider unavailability must **not crash the engine and must not surface as an HTTP error** — the stream itself communicates the degradation.

The alternative designs considered:

1. **HTTP-level signalling** (5xx on the POST/stream, or an out-of-band status endpoint) — rejected: the POST already returned `201` before the runner executes (`setImmediate` kickoff), and the stream is a 200 `text/event-stream` whose headers cannot legally change mid-flight. HTTP semantics are simply unavailable at degradation time.
2. **Silent fallback** (swap to Ollama and keep going without telling anyone) — rejected: hides real degradation from the user, who may be making triage decisions based on incomplete analysis.
3. **Failure as contract events in the stream** — chosen: the SSE channel is already the system's real-time bus, and `TOOL_EXECUTION` already has a `status` field.

## Decision

Every enabled LLM provider problem is **classified and emitted as a contract event on the stream**; it never becomes an HTTP error and never leaves the stream open. Provider selection and permission to send snippets externally are governed by ADR-008:

- **An enabled remote provider throttles/fails → use local Ollama fallback:** a `TOOL_EXECUTION` event with `status: 'degraded'` naming the provider used and a sanitized failure detail; the audit continues with the fallback's finding.
- **All providers allowed by the selected mode are unavailable:** a `TOOL_EXECUTION` event with `status: 'failed'`, followed by a terminal `AUDIT_COMPLETED` with `payload.status: 'failed'` — the stream closes cleanly. In local-only mode no remote provider is attempted as a fallback.
- **Any unexpected engine crash** is caught by a top-level guard and also ends in a terminal `AUDIT_COMPLETED { status: 'failed' }`, so *no stream is ever left open* (US4-AC6).

Provider errors are **expected failures modelled as explicit results** (`LlmInspection` union: `succeeded | degraded | unavailable`), not thrown exceptions crossing module boundaries. `LlmProviderError` is confined to adapter internals and mapped to those results.

### Code references (`@sentinel/api`)

| Concern | Location |
|---|---|
| Failure classification (`throttled \| unavailable \| invalid-response`) | `src/agent/llm.ts` — `LlmFailureKind`, `LlmProviderError` (429 → `throttled`, other non-2xx → `unavailable`) |
| Result-union contract for inspections | `src/agent/llm.ts` — `LlmInspection` (`succeeded` / `degraded` / `unavailable`) |
| Primary → Ollama fallback with degradation detail | `src/agent/llm.ts` — `OllamaFallbackLlmClient.inspectSnippet()` (returns `{ ...fallbackResult, status: 'degraded', detail: primaryResult.detail }`) |
| Previous production default chain (superseded by ADR-008) | `src/agent/llm.ts` — current implementation still requires the local-first/opt-in policy from ADR-008 |
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

**Accepted** (2026-09-29); provider default superseded by ADR-008 (2026-11-05). Degradation-as-event behavior is implemented in US-5 and covered by `apps/api/tests/agent.test.ts`; provider-selection hardening is tracked in `docs/plans/implementation-plan-p0-security-boundaries.md`.
