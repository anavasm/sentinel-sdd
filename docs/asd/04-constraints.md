# 4. Constraints

> Source: PB §4 (Technical Stack & Constraints), user-confirmed decisions (2026-09-22).

## 4.1 Architecture & Technology Constraints (non-negotiable)

| ID | Constraint | Rationale |
|---|---|---|
| C-01 | **Microfrontend (MFE) architecture** for the UI: `mfe-shell` (host) + `mfe-config` + `mfe-metrics` (remotes), via **React + Vite + Module Federation** | Distinct frontend teams must independently evolve Configuration vs. Metrics/Analytics modules (Core Objective 2) |
| C-02 | **Server-Sent Events (SSE)** for real-time agent activity streaming | Lightweight, unidirectional, HTTP-native; no WebSocket infra needed |
| C-03 | **Node.js ≥ 20 + Express + TypeScript** backend | Same language end-to-end, native SSE stream handling, shared types in monorepo (user decision, resolves CONCERN-001) |
| C-04 | **Spec-first contracts** in `/specs` (`openapi.yaml`, `events-schema.json`) validated before application code | SDD acceptance criteria (see `02-functional-overview.md` §2.4) |
| C-05 | **Monorepo** with pnpm Workspaces + Turborepo | Atomic cross-MFE changes, shared types/tooling, task orchestration |

## 4.2 Quality & Testing Constraints (mandatory)

- Unit/Integration coverage **> 80%** with **Vitest** + **React Testing Library**.
- At least **1 E2E suite** with **Playwright** covering the complete flow from `mfe-config` through `mfe-shell` to `mfe-metrics`.
- **MSW** for API/SSE mocking against the `/specs` contracts (see `10-testing.md`).

## 4.3 Cost Constraints

| ID | Constraint | Implication |
|---|---|---|
| C-06 | **Budget: $0** | Free-tier LLM APIs, local Ollama models, or free internal CLI tools only. No paid cloud, no paid SaaS, no paid npm dependencies. Drives in-memory persistence (no DB) and local-only infrastructure (see `07-infrastructure.md`) |

## 4.4 Delivery Constraints

| ID | Constraint | Implication |
|---|---|---|
| C-07 | **15-day MVP timeframe** | Favor simplicity: in-memory persistence, no-auth, minimal infrastructure. Architecture avoids premature scalability |
| C-08 | SDD acceptance gates before application code | `/specs` contracts + architecture diagram must be validated first (see `02-functional-overview.md` §2.4) |

## 4.5 Constraint ↔ Tactic Coverage

| NFR (from `03-nfr.md`) | Architectural Tactic |
|---|---|
| NFR-P1 (SSE latency < 500ms) | Direct SSE pipe; async Agent Engine decoupled from stream hub |
| NFR-A2 (in-order delivery) | Single SSE hub per audit with ordered event queue |
| NFR-A3 (provider resilience) | LLM abstraction layer + Ollama fallback + graceful degradation events |
| NFR-O3 (quality gates) | Testing Trophy strategy (see `10-testing.md`) |
| C-01/C-05 (modularity) | Module Federation + monorepo package boundaries |
