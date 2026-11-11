# 1. Context

> Source: `docs/PROJECT_BRIEF.md` (PB), `docs/ARCHITECTURE.md`, user-confirmed decisions (2026-09-22).

## 1.1 Business Context

### Problem

Engineering teams spend significant time manually reviewing Pull Requests or triaging traditional static analyzers (SonarQube, ESLint). These tools:

- Generate hundreds of false positives with no contextual understanding of code intent.
- Run slowly and provide no real-time feedback during execution.
- List issues without offering actionable fixes.

### Proposed Solution

**DevSecOps Sentinel AI** — a unified command center that audits code repositories using an **autonomous AI agent**:

- Detects security vulnerabilities (OWASP Top 10) and code smells.
- Streams step-by-step execution logs in real time.
- Provides AI-generated Before/After code suggestions for human review and manual application; the PoC does not modify repository files.

### Strategic Differentiator

- **Real-time observability:** the agent's reasoning and actions stream live via SSE (log transport latency < 500ms — see `03-nfr.md` §3.1).
- **Actionable findings over noise:** each finding includes a suggested After snippet for review; applying it remains a manual user action.
- **Modular UI:** Microfrontend architecture lets frontend teams independently evolve Configuration vs. Metrics/Analytics.

### Stakeholders

| Stakeholder                           | Role                                      |
| ------------------------------------- | ----------------------------------------- |
| Engineering & Cybersecurity Direction | Client sponsor (VP of Engineering & CISO) |
| Product Owner / Lead Developer        | Primary recipient / delivery owner        |
| Frontend teams (per module)           | Independent consumers of MFE boundaries   |

## 1.2 Project Type & Timeline

| Attribute        | Value                                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Project type     | **Greenfield**                                                                                                                   |
| Engagement       | Internal PoC / MVP — **15-day delivery**                                                                                         |
| Budget           | **$0** (local Ollama models, or free-tier LLM APIs only when explicitly enabled by the server operator; free internal CLI tools) |
| Success criteria | SDD acceptance artifacts validated before application code (see `02-functional-overview.md` §2.4)                                |

## 1.3 IT Strategy Context

- **Platform mandate:** TypeScript end-to-end monorepo; no cloud dependency (budget $0).
- **AI strategy:** local Ollama by default; free-tier APIs may be enabled explicitly by the server operator. No paid inference. See `03-nfr.md` §3.4 and ADR-008.
- **Team context:** Product Owner / Lead Developer driving delivery; distinct frontend teams own distinct MFEs (motivates the MFE constraint — see `04-constraints.md` §4.1).
