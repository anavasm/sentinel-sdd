# 8. Data Architecture

> No analytics/data platform in scope (per PB). This section covers MVP persistence, event data, and data privacy.

## 8.1 Data Strategy (MVP)

**In-memory persistence only** — confirmed by user decision (resolves CONCERN-003):

- Audit definitions, live event buffers, and final audit results are held in Maps inside the Express process.
- Lifetime: current server session. A server restart loses all audit data.
- No external database, no ORM, no migrations — honoring the $0 budget and 15-day timeframe (constraints C-06, C-07; principle `05-principles.md` §5.3).

## 8.2 Data Entities

| Entity | Held in | Lifetime | Notes |
|---|---|---|---|
| Audit definition (repo, rules, severity threshold) | In-memory Map | Session | Created via `POST /api/v1/audits`; conforms to `specs/openapi.yaml` |
| Agent event stream | SSE hub buffer + browser | Session | 4 event types per `specs/events-schema.json` |
| Findings (vulnerabilities, smells) with Before/After snippets | In-memory Map | Session | Consumed by `mfe-metrics` drawer/dashboard |
| Health score / severity distribution | Derived client-side | Session | Computed in `mfe-metrics` from received events |
| Final report | **Exported file** | Persistent (user-side) | Markdown export is the only durable artifact of an audit |

## 8.3 Event Schema Governance

The SSE event payloads are contractually defined in `specs/events-schema.json` (4 types: `AGENT_THOUGHT`, `TOOL_EXECUTION`, `VULNERABILITY_FOUND`, `AUDIT_COMPLETED`). Shared TypeScript types in the monorepo are derived from this schema so backend emitters and frontend consumers cannot drift. See `06-software-architecture.md` §6.4.

## 8.4 Data Privacy & Classification

- Audited source code is **confidential** (NFR-S2 in `03-nfr.md` §3.4).
- Only code snippets required by the active rule set are sent to the LLM provider; local Ollama is the fallback when external transmission of code is not acceptable.
- No personal data is processed by the platform.

## 8.5 Future Data Architecture (out of MVP scope)

> **[TO BE DEFINED]** — If audit history/persistence becomes required post-PoC: storage choice (SQLite vs. Postgres), retention policy, and whether reports move to server-side storage. Not needed for MVP; the Markdown export keeps the door open without committing schema.
