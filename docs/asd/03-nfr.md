# 3. Non-Functional Requirements

> Source: PB §2 (KPIs), user-confirmed clarifications (2026-09-22). This MVP is an internal 15-day PoC with a $0 budget — NFRs are scoped accordingly.

## 3.1 Performance & Scalability

| ID | Requirement | Target | Notes |
|---|---|---|---|
| NFR-P1 | **SSE transport latency** | **< 500ms** | Time from Agent Engine emitting a log/thought event to it being rendered in the UI. **Clarified:** applies to the event channel only — LLM inference is async and does not penalize this KPI (resolves CONCERN-002) |
| NFR-P2 | Concurrency | Single-user / single-audit session | PoC scope; no horizontal scaling required |
| NFR-P3 | Dashboard interactivity | Client-side rendering | Charts/diffs computed from received events; no blocking server round-trips per interaction |

**Tactics:** unidirectional SSE pipe with immediate event flush (no batching); Agent Engine decoupled from stream hub so slow LLM calls never block the channel (see `06-software-architecture.md` §6.3).

## 3.2 Availability & Reliability

| ID | Requirement | Target | Notes |
|---|---|---|---|
| NFR-A1 | Availability | Local dev execution; no SLO | PoC runs on developer machine; no uptime SLO |
| NFR-A2 | Audit session reliability | Events delivered in-order per audit | SSE reconnection (browser `EventSource` auto-retry) resyncs to the live stream; no replay guarantee across server restarts (in-memory — see `08-data-architecture.md`) |
| NFR-A3 | LLM provider resilience | Graceful degradation | Free-tier rate limits/Ollama unavailability must not crash the engine; surfaced as events in the stream (see CONCERN-004 in `ASD.md`) |

## 3.3 Operational Requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-O1 | Reproducibility | One-command bootstrap of the full stack (`pnpm install` + `turbo dev`) |
| NFR-O2 | Maintainability | Shared TypeScript types across MFEs and backend; spec-first contracts |
| NFR-O3 | Quality gates | Coverage > 80% (Vitest/RTL) enforced locally; 1 Playwright E2E suite as release gate (see `10-testing.md`) |

## 3.4 Security & Privacy

| ID | Requirement | Target | Notes |
|---|---|---|---|
| NFR-S1 | Auth model (MVP) | **No-auth PoC**, optionally a simulated API key via HTTP header | Confirmed by user; real auth out of scope |
| NFR-S2 | Data classification | Source code of audited repos is **confidential** | Code snippets sent to LLM providers must be limited to what the rule set requires; local Ollama available when external transmission is not acceptable |
| NFR-S3 | SSE endpoint scope | Per-audit stream only | `GET /api/v1/audits/:id/stream` exposes no cross-audit data |
