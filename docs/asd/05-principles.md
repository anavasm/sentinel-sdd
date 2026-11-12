# 5. Architectural Principles

> Not covered by the PB. Derived from confirmed user decisions and the PB's mandatory constraints.

## 5.1 Spec-First, Contracts Before Code

Every cross-boundary interaction (REST, SSE) is specified in `/specs` (see `02-functional-overview.md` §2.4). Contract-based mocks and fixtures support parallel frontend and backend work; validation and tests are needed to keep them aligned.

## 5.2 One Language, One Repo

TypeScript everywhere — MFEs, shell, backend, agent engine — in a single pnpm + Turborepo monorepo. Shared generated types reduce contract drift but do not replace runtime validation and tests (see `04-constraints.md` §4.1 C-03/C-05).

## 5.3 Simplicity Over Premature Scale

This is a 15-day, $0 PoC: in-memory persistence, no-auth, single local environment. Avoid any abstraction that doesn't serve the MVP's acceptance criteria — but keep seams where growth is likely (LLM provider abstraction, per-audit event hub). (See `08-data-architecture.md`, `07-infrastructure.md`.)

## 5.4 Streaming-First User Experience

The agent is observable by design: progress updates, tool executions, and findings are events on the SSE channel, rendered live. `AGENT_THOUGHT` denotes progress, not internal model reasoning. Latency of the channel (< 500ms) is a first-class NFR (see `03-nfr.md` §3.1).

## 5.5 Actionable Output Over Noise

Every `VULNERABILITY_FOUND` event carries context for review (location, severity, and Before/After snippets). The After snippet is a suggestion, not an applied change; Sentinel does not modify repository files in the PoC. Findings without a proposed After snippet are treated as incomplete output (see `02-functional-overview.md` §2.1 Module B).

## 5.6 Honest Dependency Boundaries

Local Ollama is the default LLM provider. External providers are behind the internal abstraction layer and remain disabled unless the server operator opts in (ADR-008). When an external provider is enabled, provider failures degrade gracefully through contract events rather than failing at the HTTP layer (CONCERN-004, `03-nfr.md` §3.2 NFR-A3).
