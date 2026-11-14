# 8. Data Architecture

> No analytics/data platform in scope (per PB). This section covers MVP persistence, event data, and data privacy.

## 8.1 Data Strategy (MVP)

**In-memory persistence only** — confirmed by user decision (resolves CONCERN-003):

- Audit definitions, live event buffers, and final audit results are held in Maps inside the Express process.
- Lifetime: current server session. A server restart loses all audit data.
- Audit records, including completed audits, remain in the Map for the life of the process. The per-audit SSE buffer is independently bounded to the last 1000 events; buffer eviction does not expire the audit, findings, or summary.
- The API permits at most one queued or running audit at a time; completed and failed audits release the active-audit slot.
- No external database, no ORM, no migrations — honoring the $0 budget and 15-day timeframe (constraints C-06, C-07; principle `05-principles.md` §5.3).

## 8.2 Data Entities

| Entity                                                        | Held in                  | Lifetime               | Notes                                                               |
| ------------------------------------------------------------- | ------------------------ | ---------------------- | ------------------------------------------------------------------- |
| Audit definition (repo, rules, severity threshold)            | In-memory Map            | Session                | Created via `POST /api/v1/audits`; conforms to `specs/openapi.yaml` |
| Agent event stream                                            | SSE hub buffer + browser | Session                | 4 event types per `specs/events-schema.json`; last 1000 events retained, with snapshot `lastEventId` and `firstAvailableEventId` watermarks |
| Findings (review items) with proposed Before/After snippets | In-memory Map | Session                | Each finding retains its source SSE `eventId`; consumed by `mfe-metrics`; After is a manual suggestion, never applied to repository files |
| Health score / severity distribution                          | In-memory terminal summary + metrics view | Session | Health score is retained from the completion event; distribution is available from the snapshot findings/events |
| Final report                                                  | **Exported file**        | Persistent (user-side) | Markdown export is the only durable artifact of an audit            |

## 8.3 Event Schema Governance

The SSE event payloads are contractually defined in `specs/events-schema.json` (4 types: `AGENT_THOUGHT`, `TOOL_EXECUTION`, `VULNERABILITY_FOUND`, `AUDIT_COMPLETED`). `AGENT_THOUGHT` is a progress/status update, not internal model reasoning. Shared TypeScript types are generated from the schema; regeneration, contract validation and tests reduce drift but do not make it impossible. See `06-software-architecture.md` §6.4.

## 8.4 Data Privacy & Classification

- Audited source code is **confidential** (NFR-S2 in `03-nfr.md` §3.4).
- Local Ollama is the default analysis provider. External LLM transmission is disabled unless the server operator explicitly enables it with `SENTINEL_ALLOW_EXTERNAL_LLM=true`.
- Before any LLM request, exclude known sensitive files and redact detected secrets from the exact snippet to be sent. The implementation uses the offline `@secretlint/core` engine and recommended Secretlint rules, without source-controlled ignore comments. If the detector/redactor is unavailable, returns invalid ranges, or fails, do not send that snippet; report a sanitized outcome without including secret values.
- Apply the same outbound-data hygiene to generated findings, SSE events, and logs so a model response cannot reintroduce a detected secret into the UI or server output.
- `SENTINEL_ALLOWED_REPO_ROOTS` limits local repository access. Canonicalized repository and traversed file paths must remain beneath an allowed root.
- Remote Git clones are temporary and removed after source reading. Findings do not modify local repositories, and cloned repositories are not retained for applying suggestions.
- Secret detection is defense in depth, not a guarantee of complete detection. The operator remains responsible for choosing an acceptable provider and repository scope.
- No personal data is processed by the platform.

## 8.5 Future Data Architecture (out of MVP scope)

> **[TO BE DEFINED]** — Before any shared or deployed mode beyond the local PoC, a separate design must select storage and define retention, expiry, and deletion behavior for audits, findings, and event history, including their interaction with snapshot and replay semantics. No database or TTL is selected for the PoC. Server-side report storage is also out of scope; the Markdown export remains user-side.
