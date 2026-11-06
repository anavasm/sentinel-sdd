# Architecture Specification Document (ASD)

**Project:** DevSecOps Sentinel AI (Sentinel SDD)
**Version:** 1.0.0 (draft)
**Date:** 2026-09-22
**Author:** Alvaro Navas (with g-e-asd-create skill)
**Reviewer / Approver:** Product Owner / Lead Developer
**Template Version:** 1.9.9

**Project Brief reference:** [`docs/PROJECT_BRIEF.md`](../PROJECT_BRIEF.md)
**Supplementary reference:** [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) — existing architecture & design specification (MFE topology, SSE flow, backend modules, testing strategy). This ASD formalizes and extends it.

---

## About This Document

The ASD formalizes the architecture for this greenfield project, building on and deepening the technical decisions made during the presales process (Project Brief). It is the primary architectural reference for all delivery teams and serves as the source of truth for downstream skills (implementation planning, coding guidance, security review).

This document is structured as a folder of linked Markdown files. Load individual section files based on the task at hand — do not load the full ASD unless necessary.

---

## Section Status

| #   | Section                                                               | Status         | Summary                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [Context](./01-context.md)                                            | Done           | Unified AI command center for autonomous code audits; client is internal Eng & Cybersecurity Direction; PoC 15-day MVP                                                                      |
| 2   | [Functional Overview](./02-functional-overview.md)                    | Done           | 3 MVP modules: `mfe-config`, `mfe-metrics` (SSE live console + dashboard), Agent Engine; spec-first contracts in `/specs`                                                                   |
| 3   | [Non-Functional Requirements](./03-nfr.md)                            | Done           | SSE transport latency < 500ms; quality targets; unauthenticated API restricted to loopback; allowlisted local repositories; local-first LLM egress with operator opt-in and secret handling |
| 4   | [Constraints](./04-constraints.md)                                    | Done           | Mandatory MFE; SSE; $0 budget; 15-day MVP; in-memory persistence; loopback-only API and controlled repository/LLM boundaries                                                                |
| 5   | [Principles](./05-principles.md)                                      | Done           | Spec-first, TS everywhere, in-memory simplicity, streaming-first UX, local-first LLM with operator-controlled external access                                                               |
| 6   | [Software Architecture](./06-software-architecture.md)                | Done           | TypeScript monorepo; federated MFEs; Express Agent Engine + SSE Hub; explicit local filesystem and LLM egress boundaries                                                                    |
| 7   | [Infrastructure Architecture](./07-infrastructure.md)                 | Done           | Local dev environment; loopback-only API; allowed repository roots; operator-controlled external LLM access                                                                                 |
| 8   | [Data Architecture](./08-data-architecture.md)                        | Done           | In-memory audit state; confidential source handling; local-first analysis and secret redaction before LLM egress                                                                            |
| 9   | [DevOps (CI/CD)](./09-devops.md)                                      | Done           | Simplified Gitflow (feature → main); local-first pipeline (lint, typecheck, test, build) runnable in CI later                                                                               |
| 10  | [Testing Principles](./10-testing.md)                                 | Done           | Testing Trophy: MSW for API/SSE mocking, Vitest+RTL > 80%, Playwright E2E across full MFE flow                                                                                              |
| 11  | [Operation and Support](./11-operations-support.md)                   | Optional / N/A | Internal PoC, local execution, no production support model in scope                                                                                                                         |
| 12  | [Digital Transformation Capabilities](./12-digital-transformation.md) | Optional / N/A | No AI/ML platform capabilities beyond the core agent itself in scope                                                                                                                        |

**Legend (lifecycle order):**

- **Pending** — no content yet; awaits PB ingestion or user input
- **Pre-populated** — initial content from PB; awaits user confirmation and any gap-filling
- **In Progress** — currently being written
- **Has open items** — written but contains `[TO BE DEFINED]` markers (see Open Items below)
- **Done** — complete, no open items
- **Optional / N/A** — explicitly out of scope for this engagement

---

## Flagged Concerns

Issues identified during Project Brief validation, with their resolution status.

| ID          | Concern                                            | Type                    | Affects      | Status                                                                                                                                                         |
| ----------- | -------------------------------------------------- | ----------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CONCERN-001 | PB defined no backend stack for the Agent Executor | Tech stack gap          | §6, §4       | **Resolved** — Node.js ≥ 20 + Express + TypeScript (same language as MFEs, native SSE, shared types)                                                           |
| CONCERN-002 | KPI "< 500ms" ambiguous vs. LLM inference latency  | NFR-Constraint conflict | §3, §6       | **Resolved** — applies to SSE transport latency (event emission → UI render); LLM inference is async and does not penalize the event channel                   |
| CONCERN-003 | No persistence/auth strategy for MVP               | Tech stack gap          | §8, §3.4, §7 | **Resolved** — in-memory Maps; unauthenticated API is restricted to loopback; any shared deployment requires a separate auth design                            |
| CONCERN-004 | Enabled LLM provider unavailability or rate limits | Integration risk        | §6, §7       | **Acknowledged** — local Ollama is the default; external providers require operator opt-in; enabled-provider failures degrade through SSE events (ADR-002/008) |

**Concern types:** NFR-Constraint conflict · Tech stack gap · Integration risk · Assumption risk · Incomplete tactic coverage · Environment mismatch · Team-stack mismatch

---

## Open Items

`[TO BE DEFINED]` items discovered across sections. Updated as sections are written.

| Section | Item                                     | Priority |
| ------- | ---------------------------------------- | -------- |
| —       | _None_ — all mandatory sections complete | —        |

---

## How to Use This ASD

Load individual section files based on the task — do not load the full ASD at once.

| Task                       | Load these files                                            |
| -------------------------- | ----------------------------------------------------------- |
| Implementation planning    | `06-software-architecture.md` + relevant section            |
| Security review            | `03-nfr.md` (§3.4) + `06-software-architecture.md` (§6.3.5) |
| Infrastructure work        | `07-infrastructure.md` + `04-constraints.md`                |
| DevOps / pipeline work     | `09-devops.md` + `07-infrastructure.md` (§7.4)              |
| Understanding requirements | `02-functional-overview.md` + `03-nfr.md`                   |
