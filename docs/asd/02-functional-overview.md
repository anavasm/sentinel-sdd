# 2. Functional Overview

> Source: PB §3 (Scope), `docs/ARCHITECTURE.md` (MFE topology, SSE flow). All content confirmed by user.

## 2.1 Functional Requirements

The MVP consists of three functional modules:

### Module A — MFE 1: Audit Configuration (`mfe-config`)

- Repository selection: Git URL or local test repository.
- Rule set customization:
  - Security Vulnerabilities (OWASP Top 10).
  - Unit Test Quality & Coverage.
  - Code Smells & Performance.
- Severity threshold filter (Low / Medium / High / Critical).
- Audit launch button → `POST /api/v1/audits` (contract: `specs/openapi.yaml`).

### Module B — MFE 2: Live Console & Metrics Dashboard (`mfe-metrics`)

- **Live Agent Console (SSE):** streaming event feed from the agent ("Cloning repo", "Analyzing auth.ts", "Vulnerability found").
- **Health Dashboard:** interactive severity-distribution chart + Overall Health Score (0–100).
- **Refactoring Drawer:** issue list with side-by-side Before/After AI-refactored code.
- **Report export:** final audit report in Markdown format.

### Module C — Agent Engine & Specification (SDD)

- **Upfront contracts** in `/specs` (spec-first):
  - `specs/openapi.yaml` — REST endpoints (audit creation, stream).
  - `specs/events-schema.json` — the 4 core SSE event types.
- **Executor Agent service** leveraging LLM APIs to inspect code snippets against the specified contracts.

## 2.2 Scope Boundaries

| In Scope (MVP) | Out of Scope (MVP) |
|---|---|
| Git URL or local repo audits | Organization-wide repo scanning, CI-integrated audits |
| OWASP Top 10 + code smells + test quality rules | Custom rule engines beyond the 3 rule categories |
| Real-time SSE streaming | WebSockets, event replay beyond session lifetime |
| AI-generated refactor snippets | Automatic PR creation / commit application |
| Markdown report export | PDF/HTML exports, dashboards persistence |
| In-memory audit session storage | Database persistence, audit history |
| No-auth PoC / simulated API key | Real authentication, multi-tenancy |

## 2.3 Coverage Strategy (High-Level Approach)

Decoupled TypeScript monorepo:

- **Frontend** decomposed into one host + two remotes via Module Federation, each independently evolvable (see `06-software-architecture.md` §6.2).
- **Backend** as a lightweight Express service hosting the Agent Engine and an SSE Event Hub (see `06-software-architecture.md` §6.3).
- **Real-time channel** as unidirectional SSE streaming (see `03-nfr.md` §3.1 for the latency KPI).
- **Spec-first development:** all cross-boundary contracts validated before implementation (see `05-principles.md` §5.1).

## 2.4 SDD Acceptance Criteria (Gates before app code)

1. Valid `specs/openapi.yaml` contract defining audit creation endpoints.
2. Valid `specs/events-schema.json` contract defining the 4 core SSE event types: `AGENT_THOUGHT`, `TOOL_EXECUTION`, `VULNERABILITY_FOUND`, `AUDIT_COMPLETED`.
3. `ARCHITECTURE.md` with a Mermaid diagram of Shell↔Remote MFE communication (exists: `docs/ARCHITECTURE.md` §1).

## 2.5 Related Projects & Dependencies

| Dependency | Type | Notes |
|---|---|---|
| LLM provider (free-tier API or local Ollama) | External service | Behind an abstraction layer; Ollama as offline fallback (see CONCERN-004 in `ASD.md`) |
| Target Git repositories | External system | Audited via clone (Git URL) or direct filesystem access (local repo) |
| npm/pnpm registry | Toolchain | Package distribution; no paid dependencies |
