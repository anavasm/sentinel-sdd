# 10. Testing Principles

> Source: PB §4 (mandatory quality constraints) + `docs/ARCHITECTURE.md` §5 (Testing Trophy). Confirmed by user.

## 10.1 Strategy — Testing Trophy

Quality follows a Testing Trophy weighting: a strong base of integration tests around behavior, focused unit tests for domain logic, and a thin layer of E2E.

| Layer | Tool | Target |
|---|---|---|
| **Static** | ESLint + `tsc --noEmit` | Zero errors (pipeline gate, see `09-devops.md` §9.2) |
| **Unit** | Vitest | Critical domain hooks, utilities, agent runner logic (LLM mocked) |
| **Integration** | Vitest + React Testing Library + MSW | Components against mocked API/SSE derived from `/specs`; **coverage > 80%** |
| **E2E** | Playwright | Deterministic full flow and standalone metrics; separate P1 latency suite |

## 10.2 Mocking with MSW (contract-driven)

- **Mock Service Worker (MSW)** mocks REST endpoints and **SSE streams** based on the `/specs` contracts (`openapi.yaml`, `events-schema.json`).
- Contract-package fixtures and handlers support isolated tests. Client tests also use deterministic fetch and EventSource mocks.
- Colocated mocks and generated types reduce drift but do not prevent it; run `pnpm validate` and relevant tests after changes (see `08-data-architecture.md` §8.3).

## 10.3 Coverage Rules

| Scope | Requirement |
|---|---|
| Critical domain hooks, utilities, components | > 80% (mandatory constraint §4.2) |
| Agent runner | Unit-tested with a stub LLM adapter; events asserted against `specs/events-schema.json` |
| SSE hook (`useAuditStream`) | Hook tests with a deterministic EventSource mock and snapshot responses |

## 10.4 E2E Scope

The `pnpm test:e2e:flow` Playwright suite covers the complete flow (constraint §4.2):

1. Configure repo + rules in `mfe-config`.
2. Launch audit (`POST /api/v1/audits`).
3. Redirect via `mfe-shell` to `/audits/:id`.
4. Verify real-time events, final snapshot, severity chart and Markdown download; also render metrics standalone.

Playwright launches the three MFEs and a test-only API with a deterministic runner, without a real LLM or Git host. `pnpm test:e2e:latency` is a separate P1 suite. Both use the same frontend/API ports and must not run concurrently.

## 10.5 Test Data

- Local test repository fixture for audits (no network dependency on real Git hosts in CI-like runs).
- MSW fixtures per SSE event type, including error/degradation scenarios (LLM throttling — NFR-A3 in `03-nfr.md` §3.2).
