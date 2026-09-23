# 10. Testing Principles

> Source: PB §4 (mandatory quality constraints) + `docs/ARCHITECTURE.md` §5 (Testing Trophy). Confirmed by user.

## 10.1 Strategy — Testing Trophy

Quality follows a Testing Trophy weighting: a strong base of integration tests around behavior, focused unit tests for domain logic, and a thin layer of E2E.

| Layer | Tool | Target |
|---|---|---|
| **Static** | ESLint + `tsc --noEmit` | Zero errors (pipeline gate, see `09-devops.md` §9.2) |
| **Unit** | Vitest | Critical domain hooks, utilities, agent runner logic (LLM mocked) |
| **Integration** | Vitest + React Testing Library + MSW | Components against mocked API/SSE derived from `/specs`; **coverage > 80%** |
| **E2E** | Playwright | 1 suite, full flow: `mfe-config` → `mfe-shell` → `mfe-metrics` |

## 10.2 Mocking with MSW (contract-driven)

- **Mock Service Worker (MSW)** mocks REST endpoints and **SSE streams** based on the `/specs` contracts (`openapi.yaml`, `events-schema.json`).
- Used in dev (frontend works before backend exists) and in integration tests (deterministic event sequences, including `VULNERABILITY_FOUND` and `AUDIT_COMPLETED` fixtures).
- Mocks live alongside the contracts, so a `/specs` change forces mock + type updates — drift is impossible (see `08-data-architecture.md` §8.3).

## 10.3 Coverage Rules

| Scope | Requirement |
|---|---|
| Critical domain hooks, utilities, components | > 80% (mandatory constraint §4.2) |
| Agent runner | Unit-tested with a stub LLM adapter; events asserted against `specs/events-schema.json` |
| SSE hook (`useAgentStream`) | Integration-tested with MSW-streamed events |

## 10.4 E2E Scope

Single Playwright suite covering the complete flow (constraint §4.2):

1. Configure repo + rules in `mfe-config`.
2. Launch audit (`POST /api/v1/audits`).
3. Redirect via `mfe-shell` to `/audits/:id`.
4. Verify real-time event rendering in `mfe-metrics` and final `AUDIT_COMPLETED` state.

Playwright launches the full monorepo environment (3 MFEs + Express backend).

## 10.5 Test Data

- Local test repository fixture for audits (no network dependency on real Git hosts in CI-like runs).
- MSW fixtures per SSE event type, including error/degradation scenarios (LLM throttling — NFR-A3 in `03-nfr.md` §3.2).
