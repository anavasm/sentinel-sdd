# Implementation Plan — Initial API & Event Specs in `/specs`

> Work item: "Create the initial API and event specifications in `/specs` (`openapi.yaml` and `events-schema.json`)."
> Generated: 2026-09-23 · Source docs: `docs/PROJECT_BRIEF.md` (§3.C, §4, §5), `docs/ARCHITECTURE.md`, `docs/asd/*`
> This is the **SDD acceptance gate** (constraint C-04/C-08, ASD §2.4, §9.3): these contracts must exist and validate before any application code.

---

## 1. Executive Summary

Create the two spec-first contracts that gate all application development for the DevSecOps Sentinel AI MVP:

- **`specs/openapi.yaml`** — REST contract for audit creation, audit metadata retrieval, and the SSE stream endpoint.
- **`specs/events-schema.json`** — JSON Schema (draft-07) contract defining the common SSE event envelope and the 4 core event types emitted by the Agent Engine.

Plus the deliverables that make the contracts immediately consumable downstream:
- **Validation tooling** — lightweight scripts (YAML/JSON syntax + Ajv sample-event validation; Spectral lint if straightforward) runnable as a local pipeline gate.
- **Generated shared TypeScript types** — `openapi-typescript` (from `openapi.yaml`) and `json-schema-to-typescript` (from `events-schema.json`) into a shared `packages/contracts` workspace, eliminating contract drift between backend emitters and MFE consumers.
- **Initial MSW fixtures/mocks** aligned to the schemas (required by ASD §10.2: mocks live alongside contracts so drift is impossible).

**Estimated complexity:** S–M (documentation/contract work with light tooling; no application logic).

**Dependencies:** None external. This milestone unblocks `apps/api`, `mfe-config`, and `mfe-metrics` (parallel development against MSW mocks).

## 2. Work Item Analysis

### Original Intent
From PB §5 (SDD Acceptance Criteria) and §3.C:
1. "A valid `specs/openapi.yaml` contract defining audit creation endpoints."
2. "A valid `specs/events-schema.json` contract defining the 4 core SSE event types emitted by the agent: `AGENT_THOUGHT`, `TOOL_EXECUTION`, `VULNERABILITY_FOUND`, `AUDIT_COMPLETED`."

### Breakdown
1. REST contract (OpenAPI 3.1) for `/api/v1` audit lifecycle endpoints
2. Event contract (JSON Schema draft-07) for the SSE channel envelope + 4 event payloads
3. Contract validation gate (scripts) wired into the local Turborepo pipeline
4. Shared generated TypeScript types package
5. Seed MSW fixtures per event type + REST handler mocks

### Acceptance Criteria
| # | Criterion | Source |
|---|---|---|
| AC-1 | `specs/openapi.yaml` exists, is valid OpenAPI 3.x, and defines `POST /api/v1/audits`, `GET /api/v1/audits/{auditId}`, and `GET /api/v1/audits/{auditId}/stream` (SSE) | PB §5.1, PB §3.C, user decision |
| AC-2 | `specs/events-schema.json` exists, is valid JSON Schema draft-07, and defines the common envelope plus the 4 event types | PB §5.2, ASD §8.3, user decision |
| AC-3 | Automated validation passes: syntax check + Ajv sample-event validation (+ Spectral lint if added) | User decision, ASD §9.3 |
| AC-4 | Shared TS types generated from both specs in `packages/contracts` | User decision, ASD §6.3.4 |
| AC-5 | Initial MSW fixtures/mocks aligned to the contracts | User decision, ASD §10.2 |

### Dependencies
- None upstream. This is the first milestone.
- Downstream unblocked: `apps/api` (Express), `mfe-config`, `mfe-metrics`, MSW mock layer, Playwright E2E fixtures.

## 3. Requirements & Edge Cases

### 3.1 Confirmed Requirements (from interrogation)
- **Endpoints:** `POST /api/v1/audits` (create audit), `GET /api/v1/audits/{auditId}` (metadata/report for Markdown export), `GET /api/v1/audits/{auditId}/stream` (SSE channel).
- **REST error semantics:** RFC 9457 Problem Details responses; `400 Bad Request` for validation failures, `404 Not Found` for unknown `auditId`.
- **SSE error semantics:** if `auditId` does not exist at connect time, respond `404` **before** establishing the `text/event-stream` headers.
- **Event schema standard:** JSON Schema **draft-07**.
- **Event envelope:** common envelope with `id`, `type`, `timestamp`, `auditId`, `payload`.
- **Event types:** `AGENT_THOUGHT`, `TOOL_EXECUTION`, `VULNERABILITY_FOUND`, `AUDIT_COMPLETED`.
- **Milestone deliverable scope:** spec files + generated TS types in `packages/` + initial MSW fixtures/mocks.
- **Validation:** lightweight scripts (syntax + Ajv samples); Spectral optional-if-easy.
- **Type generation:** `openapi-typescript` + `json-schema-to-typescript`, standard tools.

### 3.2 Edge Cases (by category)

**Inputs (POST /api/v1/audits body):**
- Empty/missing body → 400 Problem Details.
- Malformed `repoUrl` (not a valid Git URL, or neither URL nor local path provided) → 400 with field-level detail.
- Unknown rule-set keys, or a rule set object with zero enabled rules → 400 (empty audit is meaningless).
- Invalid severity threshold value (not in `LOW|MEDIUM|HIGH|CRITICAL`) → 400 with allowed enum in message.
- Oversized payload (pathological long strings) → 413 or 400 with explicit limit; keep limit generous for PoC.
- Boundary: local repo path that doesn't exist — spec must declare this validated at request time (`400`) vs. deferred to agent runtime (surfaced as `TOOL_EXECUTION` failure event). **Decision: validate existence at request time → 400** (fail fast; in-memory session, no retry semantics).

**State transitions (audit lifecycle):**
- `POST` returns `201 Created` with `auditId` (`aud_` prefix per ARCHITECTURE.md flow); audit starts async.
- `GET /audits/{id}` before completion → current status field (`running` / `completed` / `failed`) + whatever results exist. `GET` after completion → full results. **Decision: include `status` enum `queued | running | completed | failed`** in audit resource.
- `GET /stream` on an audit that already completed → must still deliver buffered events then `AUDIT_COMPLETED` (in-memory buffer, session lifetime — ASD §8.1, NFR-A2). Spec documents this behavior.
- `GET /stream` on unknown id → 404 before SSE headers (user-confirmed).
- Double-connect to the same stream → allowed; per-audit hub fans out (ASD §6.1).

**Concurrency:**
- Single-audit PoC (NFR-P2); spec does not need batch endpoints. `POST` while another audit runs → accepted; no locking specified.

**Permissions:**
- No-auth PoC (NFR-S1); optionally reserve an `X-API-Key` header placeholder in securitySchemes (simulated key). **Decision: document `X-API-Key` as optional securityScheme, not required.**

**Integrations:**
- LLM provider failures are **not** REST errors — they surface as `TOOL_EXECUTION` failure events / degradation events on the stream (NFR-A3, CONCERN-004). Spec must not model provider errors as HTTP codes.

### 3.3 Unhappy Path Mapping
| Failure | Behavior per spec |
|---|---|
| Malformed/invalid POST body | `400` Problem Details, field list |
| Unknown auditId (REST) | `404` Problem Details |
| Unknown auditId (SSE connect) | `404` before event-stream headers |
| Agent crash mid-audit | Terminal `AUDIT_COMPLETED` event with `status: "failed"` + `error` payload (no orphan streams) |
| LLM throttling/unavailable | `TOOL_EXECUTION` event with degraded/failure outcome; engine falls back to Ollama (NFR-A3) — modeled as event payload, not HTTP error |
| Server restart mid-audit | Out of contract scope (in-memory session lost, ASD §8.1); documented as known limitation |

### 3.4 Assumptions
| # | Assumption | Status |
|---|---|---|
| A-1 | OpenAPI 3.1 (not 3.0) is acceptable for the PoC | Confirmed via user (standard tooling choice) |
| A-2 | Health score is derived client-side in `mfe-metrics`; API does not need a dedicated score field | Confirmed (ASD §8.2) |
| A-3 | `GET /audits/{id}` returns the findings array consumed by the refactoring drawer + Markdown export source | Confirmed via user (endpoint chosen for metadata/report) |
| A-4 | MSW fixtures are seed fixtures (per event type + error scenarios), not exhaustive | Reasonable default; refinement happens per-feature |
| A-5 | Monorepo `packages/contracts` workspace is acceptable (equivalent directory naming allowed) | Confirmed via user ("o directorio equivalente") |

### 3.5 Conflicting Requirements
None found. PB, ASD, and user decisions are fully consistent for this milestone.

### 3.6 Existing Behavior Decisions
No existing implementation detected — greenfield repository (no `apps/`, no `specs/`, no source code). Nothing to preserve, override, or escalate.

### 3.7 ASD Friction
None. The work item *is* an ASD-mandated gate (C-04, C-08, §9.3); every design decision taken here aligns with §6.3.5 integration strategy and §8.3 event governance.

## 4. Architecture Alignment

**ASD Mode: `ASD-anchored`** (structured ASD at `docs/asd/`).

### Mandatory Patterns
- **Spec-first, contracts before code** — ASD §5.1, C-04: `/specs` is source of truth; MSW mocks generated against contracts (§10.2).
- **Shared types derived from contracts** — ASD §6.3.4, §8.3: TS types in `packages/*` derived from `/specs`, single source of truth.
- **Unidirectional SSE** — ASD §6.2, C-02: agent emits → hub fans out; events validated against `events-schema.json`.

### Technology Stack (ASD §6.3.2)
- Node.js ≥ 20, TypeScript, pnpm Workspaces + Turborepo
- Contract tooling (new, per user decision): `openapi-typescript`, `json-schema-to-typescript`, `ajv`, optionally `@stoplight/spectral-cli`
- MSW for contract-aligned mocks (§10.2)

### Relevant Architecture Components
- `specs/` — new top-level directory (constraint C-04)
- `packages/contracts/` (or equivalent) — new shared workspace package: generated types + MSW fixtures + fixtures validation
- Downstream consumers (not built in this milestone): `apps/api`, `apps/mfe-config`, `apps/mfe-metrics`

### NFR Constraints on This Feature
- **NFR-P1:** SSE < 500ms latency — spec defines immediate-flush semantics per event (no batching); contract-level note.
- **NFR-A2:** in-order delivery per audit — spec documents per-audit ordered channel guarantee.
- **NFR-S1:** no-auth, optional simulated `X-API-Key`.
- **NFR-S3:** stream is per-audit only, no cross-audit data — reflected in endpoint path scoping.
- **NFR-O2:** spec-first contracts with shared TS types — the core deliverable of this milestone.

### Integration Points (ASD §6.3.5)
| Integration | Contract | Direction |
|---|---|---|
| `mfe-config` → API | `openapi.yaml` (POST /audits) | Outbound REST |
| `mfe-metrics` → API | `openapi.yaml` (stream) + `events-schema.json` | Inbound SSE |
| `mfe-metrics` → API | `openapi.yaml` (GET /audits/{id}) | Markdown export source |
| Backend emitters | `events-schema.json` | Contract for hub validation |

### Decisions Made in This Plan (ADR candidates)
| ID | Decision | Rationale |
|---|---|---|
| D-1 | OpenAPI **3.1** (ASD/PB silent on version) | Modern tooling compatibility (`openapi-typescript` first-class support); 3.1 is JSON-Schema-aligned with events-schema |
| D-2 | RFC 9457 `application/problem+json` for REST errors | User-confirmed "Standard Problem Details"; consistent 400/404 shape |
| D-3 | SSE 404-before-headers for unknown auditId | User-confirmed; avoids half-open event streams on dead sessions |
| D-4 | Audit lifecycle `status` enum `queued\|running\|completed\|failed` on audit resource | Needed by GET endpoint for async audit; supports failed-terminal-state unhappy path |
| D-5 | `AGENT_THOUGHT`/`TOOL_EXECUTION` payloads carry loose `content`/`tool`/`status` string fields with JSON Schema `additionalProperties` allowance for PoC flexibility | Agent reasoning is free-form; strict typing only where consumers depend on it (`VULNERABILITY_FOUND`, `AUDIT_COMPLETED`) |
| D-6 | Event `id` = monotonic per-audit sequence number, also used as SSE `id:` field | Enables `Last-Event-ID` resync headers without violating NFR-A2 in-order guarantee |
| D-7 | `VULNERABILITY_FOUND` payload embeds Before/After snippets + location + severity (enum LOW/MEDIUM/HIGH/CRITICAL) | ASD §5.5: findings without fixes are incomplete output |

## 5. Technical Approach

### High-Level Strategy
Author both contracts by hand (they are small), back them with automated validation scripts, generate types, and author seed MSW fixtures — all inside the existing pnpm monorepo scaffold (`pnpm-workspace.yaml` already exists).

### Key Components
| Component | Purpose |
|---|---|
| `specs/openapi.yaml` | REST contract (3 endpoints + Problem Details error model) |
| `specs/events-schema.json` | draft-07: `$defs.commonEnvelope` + 4 event definitions + `oneOf` discriminator on `type` |
| `packages/contracts/` | Generated types (`api-schema.d.ts`, `events.d.ts`), hand-authored barrel export, MSW fixtures |
| `packages/contracts/src/fixtures/` | Seed MSW fixtures: one sample per event type + error sequences (LLM throttle, agent failure) |
| `packages/contracts/src/validate.ts` + scripts | Validation gate scripts (Ajv sample validation, YAML/JSON parse, optional Spectral) |
| `packages/contracts/tests/` | Round-trip tests: generated types compile; fixtures validate against schema |

### Data Model
No database (in-memory, ASD §8.1). The contracts define these domain shapes:

**Audit (REST):**
- `AuditConfig` (request): `repoUrl | localPath`, `ruleSets { owaspTop10, testQuality, codeSmellsPerformance }` (booleans), `severityThreshold` (enum)
- `Audit` (response): `auditId` (`aud_` prefix), `status` enum, `config`, `createdAt`, results (findings array, health summary placeholder)

**Event (SSE, envelope):** `{ id: integer, type: enum, timestamp: date-time, auditId: string, payload: object }` — `payload` discriminated per event type.

### API Changes
All new. Full endpoint/error matrix in Section 6, Task 2/3.

### External Dependencies (npm, all free)
`openapi-typescript`, `json-schema-to-typescript`, `ajv`, `ajv-formats`, `@stoplight/spectral-cli` (optional), `msw` (peer for fixtures), `vitest` (test runner, already mandated).

## 6. Detailed Task Breakdown

### Task 1 — Scaffold `packages/contracts` workspace
- **Files:** `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, entry `src/index.ts`; add workspace to `pnpm-workspace.yaml` if not glob-covered
- **Notes:** devDependencies: `openapi-typescript`, `json-schema-to-typescript`, `ajv`, `ajv-formats`, `msw`, `vitest`. Scripts: `generate:api`, `generate:events`, `validate`, `test`. Register `lint`/`typecheck`/`test` tasks in `turbo.json`.
- **Effort:** S · **Depends on:** none · **AC:** AC-4

### Task 2 — Author `specs/openapi.yaml`
- **Files:** `specs/openapi.yaml`
- **Content spec (acceptance-level):**
  - `info`, `servers` (local dev `http://localhost:3000`), `tags`: audits
  - **`POST /api/v1/audits`** → `201` `AuditCreated { auditId, status }`; `400`/`422` Problem Details (body validation: repo source, rule sets, severity enum). Request body = `AuditConfig`.
  - **`GET /api/v1/audits/{auditId}`** → `200` `Audit` (status, config, findings array with Before/After snippets, severity, location); `404` Problem Details. Powers refactoring drawer + Markdown export source.
  - **`GET /api/v1/audits/{auditId}/stream`** → `200` `text/event-stream` (document SSE headers, per-event schema = envelope; `Last-Event-ID` resync note); `404` before stream establishment; note on in-order delivery + buffered-replay-then-live semantics for completed audits (NFR-A2, ASD §8.1).
  - **Components:** `AuditConfig`, `Audit`, `AuditCreated`, `Finding`, `Severity` enum (`LOW|MEDIUM|HIGH|CRITICAL`), `AuditStatus` enum (`queued|running|completed|failed`), `Problem` (RFC 9457). Optional `ApiKeyAuth` securityScheme (`X-API-Key`, not required — NFR-S1).
- **Notes:** OpenAPI 3.1 (D-1). Keep schemas strict where consumers depend on them; document SSE as an extension (`text/event-stream` response) rather than faking it as JSON.
- **Effort:** M · **Depends on:** Task 1 · **AC:** AC-1 · **Edge cases:** 3.2 inputs/state/unhappy rows

### Task 3 — Author `specs/events-schema.json`
- **Files:** `specs/events-schema.json`
- **Content spec:**
  - `"$schema": "http://json-schema.org/draft-07/schema#"`
  - `$defs.commonEnvelope`: `{ id: integer (monotonic per audit), type: enum[4], timestamp: date-time, auditId: string, payload: object }`
  - `$defs` per event:
    - `AGENT_THOUGHT`: payload `{ content: string, step?: string }` (loose per D-5)
    - `TOOL_EXECUTION`: payload `{ tool: string, input?: object, status: enum[started|succeeded|failed|degraded], output?: string, error?: string }` (models LLM degradation — NFR-A3)
    - `VULNERABILITY_FOUND`: payload `{ ruleId, title, severity: enum[4], filePath, lineNumber?, description, beforeSnippet, afterSnippet, cweId?: string }` (ASD §5.5 — complete findings only)
    - `AUDIT_COMPLETED`: payload `{ status: enum[completed|failed], healthScore?: integer 0–100, summary?: object, error?: string }`
  - Top level: `oneOf` over the 4 concrete event schemas (each: envelope + typed payload via `allOf`).
- **Effort:** M · **Depends on:** Task 1 · **AC:** AC-2 · **Edge cases:** envelope validation, failed-terminal state, degradation event

### Task 4 — Validation gate scripts
- **Files:** `packages/contracts/src/validate.ts` (or `scripts/validate-specs.ts`), fixtures directory
- **Content:** (1) YAML/JSON parse + schema lint; (2) Ajv draft-07 with `ajv-formats` validating every fixture event against its schema **and** rejecting unknown event types; (3) optional Spectral run (` spectral lint specs/openapi.yaml --ruleset spectral:oas`) behind a flag; wire `validate` into `turbo` pipeline before `build`.
- **Effort:** S · **Depends on:** Tasks 2–3 · **AC:** AC-3

### Task 5 — Generate shared TypeScript types
- **Files:** `packages/contracts/src/generated/api-schema.d.ts` (openapi-typescript), `packages/contracts/src/generated/events.d.ts` (json-schema-to-typescript from `events-schema.json` `$defs`); hand-authored index re-exports + guards for the 4 event types
- **Notes:** generation is a build step; generated output is committed so consumers don't need the toolchain (and diffs make contract changes reviewable).
- **Effort:** S · **Depends on:** Tasks 2–3 · **AC:** AC-4

### Task 6 — Seed MSW fixtures & mocks
- **Files:** `packages/contracts/src/fixtures/events.ts` (sample per event type + throttle/degradation + failed-terminal sequences), `packages/contracts/src/mocks/handlers.ts` (MSW handlers for the 3 REST routes + an SSE stream helper aligned to `openapi.yaml` paths)
- **Notes:** fixtures double as Ajv validation inputs (Task 4) — one source feeding both. Include a deterministic full-audit sequence for the future Playwright suite (ASD §10.5).
- **Effort:** S–M · **Depends on:** Tasks 2–5 · **AC:** AC-5

### Task 7 — Contract round-trip tests + docs touch
- **Files:** `packages/contracts/tests/contracts.test.ts` (generated types compile; fixtures validate; envelope rejects unknown types), update `README.md` with a `/specs` section
- **Effort:** S · **Depends on:** Tasks 4–6 · **AC:** AC-3, AC-5

## 7. Implementation Sequence

- **Phase 1 — Foundation:** Task 1 (workspace scaffold)
- **Phase 2 — Contracts:** Tasks 2–3 (the two spec files; parallelizable)
- **Phase 3 — Integration:** Tasks 4–5 (validation gate + type generation)
- **Phase 4 — Polish & Validation:** Tasks 6–7 (fixtures, round-trip tests, docs)

Total: ~2–3 developer-days. Completing Tasks 1–5 satisfies the SDD gate (C-08) and unblocks app code.

## 8. Definition of Done

**Project Quality Gates (ASD-anchored):**
- [ ] Contracts validated before code — `/specs` passes validation scripts (C-04/C-08, §9.3)
- [ ] Architecture principles followed — spec-first (§5.1), shared-types-from-contracts (§6.3.4)
- [ ] CI/lint gates green — `turbo run lint` + `typecheck` zero errors (§9.2)
- [ ] Test coverage > 80% on `packages/contracts` logic (§10.3 — validation/fixture code, trivially testable)
- [ ] NFR alignment documented in specs — SSE latency note (NFR-P1), in-order delivery (NFR-A2), degradation-as-event (NFR-A3), per-audit stream scope (NFR-S3)

**Standard Checklist:**
- [ ] AC-1..AC-5 validated
- [ ] Edge cases from §3.2 represented in schema constraints/fixtures
- [ ] Unhappy paths from §3.3 have defined contract behavior
- [ ] Assumptions A-1..A-5 resolved (all confirmed during interrogation)
- [ ] Unit/round-trip tests passing
- [ ] README documents `/specs` usage and validation command
- [ ] Both specs reviewed by backend + frontend consumers before app code starts

## 9. Risks & Considerations

- **Technical risks:** OpenAPI's native SSE support is limited — the stream endpoint is documented as `text/event-stream` with prose + envelope schema reference rather than a fully typed response; mitigated by `events-schema.json` being the normative event contract.
- **Dependencies:** none blocking; all tooling free-tier.
- **Performance:** contracts don't enforce latency, but spec prose must state immediate-flush semantics (NFR-P1) so implementers don't batch.
- **Security:** `X-API-Key` optional placeholder only; no real auth (NFR-S1). Specs must not embed secrets or provider endpoints.
- **Drift risk (post-milestone):** contract edits without regenerating types/mocks — mitigated by committed generated files + `validate` in the default pipeline.

## 10. Open Questions

None blocking. All interrogation questions were answered by the user (endpoints, error semantics, schema standard, deliverable scope, validation approach, type generation).

Non-blocking items to confirm during implementation:
- Exact Problem Details field extensions (e.g., `errors[]` field list) — backend decision at implementation time.
- Whether `GET /audits/{id}` findings payload should reuse `VULNERABILITY_FOUND` payload shape (likely yes; finalize when the endpoint is implemented).

## 11. ASD Friction & ADR Candidates

Omitted — no ASD friction confirmed in Step 3f.
