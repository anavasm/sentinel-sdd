# 3. Non-Functional Requirements

> Source: PB §2 (KPIs), user-confirmed clarifications (2026-09-22). This MVP is an internal 15-day PoC with a $0 budget — NFRs are scoped accordingly.

## 3.1 Performance & Scalability

| ID     | Requirement               | Target                             | Notes                                                                                                                                                                                                               |
| ------ | ------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-P1 | **SSE transport latency** | **< 500ms**                        | Time from Agent Engine emitting a log/thought event to it being rendered in the UI. **Clarified:** applies to the event channel only — LLM inference is async and does not penalize this KPI (resolves CONCERN-002) |
| NFR-P2 | Concurrency               | Single-user / single-audit session | PoC scope; no horizontal scaling required                                                                                                                                                                           |
| NFR-P3 | Dashboard interactivity   | Client-side rendering              | Charts/diffs computed from received events; no blocking server round-trips per interaction                                                                                                                          |

**Tactics:** unidirectional SSE pipe with immediate event flush (no batching); Agent Engine decoupled from stream hub so slow LLM calls never block the channel (see `06-software-architecture.md` §6.3).

## 3.2 Availability & Reliability

| ID     | Requirement               | Target                              | Notes                                                                                                                                                                  |
| ------ | ------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-A1 | Availability              | Local dev execution; no SLO         | PoC runs on developer machine; no uptime SLO                                                                                                                           |
| NFR-A2 | Audit session reliability | Events delivered in-order per audit | SSE reconnection (browser `EventSource` auto-retry) resyncs to the live stream; no replay guarantee across server restarts (in-memory — see `08-data-architecture.md`) |
| NFR-A3 | LLM provider resilience   | Graceful degradation                | Unavailability of an enabled provider must not crash the engine; surface it as stream events. Provider selection and external egress are governed by NFR-S6/ADR-008.   |

## 3.3 Operational Requirements

| ID     | Requirement     | Target                                                                                                     |
| ------ | --------------- | ---------------------------------------------------------------------------------------------------------- |
| NFR-O1 | Reproducibility | Install with `pnpm install`; start MFEs with `pnpm dev` and API separately with `pnpm --filter @sentinel/api dev` |
| NFR-O2 | Maintainability | Shared TypeScript types across MFEs and backend; spec-first contracts                                      |
| NFR-O3 | Quality gates   | Coverage > 80% (Vitest/RTL) enforced locally; 1 Playwright E2E suite as release gate (see `10-testing.md`) |

## 3.4 Security & Privacy

| ID     | Requirement                        | Target                                           | Notes                                                                                                                                                                                          |
| ------ | ---------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-S1 | Auth model (MVP)                   | **No-auth PoC accessible only through loopback** | No non-loopback listener is permitted. Any shared or remote deployment requires a separate authentication and authorization design.                                                            |
| NFR-S2 | Data classification                | Source code of audited repos is **confidential** | Only the minimum required snippets may reach an LLM. Local LLM processing is the default; external processing requires explicit server-operator opt-in.                                        |
| NFR-S3 | SSE endpoint scope                 | Per-audit stream only                            | `GET /api/v1/audits/:id/stream` exposes no cross-audit data                                                                                                                                    |
| NFR-S4 | API network boundary               | Loopback-only listener                           | The unauthenticated API binds only to loopback addresses. CORS is not an authentication or network access control.                                                                             |
| NFR-S5 | Local repository authorization     | Configured allowed roots                         | `SENTINEL_ALLOWED_REPO_ROOTS` defines local repository roots. Missing or empty configuration denies local-path audits. Canonical paths and symlink targets must remain inside an allowed root. |
| NFR-S6 | LLM egress control                 | Local-only by default                            | External endpoints are used only when `SENTINEL_ALLOW_EXTERNAL_LLM=true` is set by the server operator. Non-loopback LLM endpoints are external.                                               |
| NFR-S7 | Sensitive-file and secret handling | Exclude, redact, fail closed                     | Exclude known sensitive files, redact detected secrets before any LLM request, and do not send a snippet if detection/redaction fails. Secret material must not appear in events or logs.      |
