# 5. Architectural Principles

> Not covered by the PB. Derived from confirmed user decisions and the PB's mandatory constraints.

## 5.1 Spec-First, Contracts Before Code

Every cross-boundary interaction (REST, SSE) is specified in `/specs` and validated **before** application source code is written (see `02-functional-overview.md` §2.4). MSW mocks are generated against these contracts, so frontend and backend can evolve in parallel.

## 5.2 One Language, One Repo

TypeScript everywhere — MFEs, shell, backend, agent engine — in a single pnpm + Turborepo monorepo. Shared types eliminate contract drift between frontend and backend (see `04-constraints.md` §4.1 C-03/C-05).

## 5.3 Simplicity Over Premature Scale

This is a 15-day, $0 PoC: in-memory persistence, no-auth, single local environment. Avoid any abstraction that doesn't serve the MVP's acceptance criteria — but keep seams where growth is likely (LLM provider abstraction, per-audit event hub). (See `08-data-architecture.md`, `07-infrastructure.md`.)

## 5.4 Streaming-First User Experience

The agent is observable by design: every thought, tool execution, and finding is an event on the SSE channel, rendered live. Latency of the channel (< 500ms) is a first-class NFR (see `03-nfr.md` §3.1).

## 5.5 Actionable Output Over Noise

Every `VULNERABILITY_FOUND` event carries enough context (location, severity, Before/After snippet) to be applied directly — findings without fixes are treated as incomplete output (see `02-functional-overview.md` §2.1 Module B).

## 5.6 Honest Dependency Boundaries

External LLM providers are behind an internal abstraction layer with a local Ollama fallback; the system degrades gracefully rather than failing when a free-tier provider throttles (CONCERN-004, `03-nfr.md` §3.2 NFR-A3).
