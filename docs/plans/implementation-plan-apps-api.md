# Implementation Plan — `apps/api` (Express Backend)

> Work item: "Implement the backend application (`apps/api`) for the DevSecOps Sentinel AI MVP, consuming `@sentinel/contracts` and conforming to `specs/openapi.yaml` + `specs/events-schema.json`."
> Generated: 2026-09-24 · Source docs: `docs/PROJECT_BRIEF.md`, `docs/ARCHITECTURE.md`, `docs/asd/*`, `specs/openapi.yaml`, `specs/events-schema.json`, `packages/contracts/*`, prior plan `.globant-skills-docs/plans/implementation-plan-specs-contracts.md` (decisions D-1..D-7 inherited)
> Position in roadmap: **third milestone** — unblocked by the specs/contracts milestone (SDD gate C-08 already satisfied). This milestone unblocks `mfe-config` and `mfe-metrics` real-backend integration and the Playwright E2E suite.

---

## 1. Executive Summary

Build the Express REST API (`apps/api`) that implements the audit lifecycle defined in `specs/openapi.yaml`:

- **`POST /api/v1/audits`** — fail-fast validation (201 / 400 / 413, RFC 9457 Problem Details), in-memory persistence, async audit kickoff.
- **`GET /api/v1/audits/{auditId}`** — audit metadata + findings (200 / 404).
- **`GET /api/v1/audits/{auditId}/stream`** — per-audit SSE channel (200 event-stream / 404 *before* headers, per D-3) with in-order delivery, immediate flush, buffered replay + `Last-Event-ID` resync.

All request/response shapes and every outbound SSE event are typed and validated via **`@sentinel/contracts`** (generated types from `/specs` + Ajv). The Agent Engine is integrated through an emitter seam; a fixture-driven stub runner ships in US-4 so the SSE channel is fully testable before the real LLM-backed runner lands (US-5 completes the vertical slice).

**Estimated complexity:** M (3 Express routes, in-memory store, SSE hub, contract wiring; no DB, no auth, no LLM integration until US-5).

**Sequential User Stories:**
- **US-1** — App Scaffolding & Setup
- **US-2** — `POST /audits` & Fail-Fast Validation
- **US-3** — `GET /audits/{id}` & Session State
- **US-4** — `GET /audits/{id}/stream` SSE Channel & Resync
- **US-5** — Agent Runner Integration (contract-validated event emission)

## 2. Work Item Analysis

### Original Intent
From PB §3.C and ASD §6.1: the Express backend exposes the REST entry point (`/api/v1`), manages the audit lifecycle in memory, hosts the SSE Event Hub, and orchestrates the Agent Engine — validating everything against the `/specs` contracts. `apps/api` is explicitly named in ASD §6.3.4 as the backend workspace of the monorepo.

### Breakdown
1. Workspace scaffold (`apps/api`) with Express + TypeScript, wired into Turborepo tasks
2. Request validation + Problem Details error model + audit creation endpoint
3. Audit retrieval endpoint + session state (lifecycle Map, findings accumulation)
4. SSE hub + stream endpoint (404-first, replay, resync, flush semantics)
5. Agent runner seam emitting schema-validated events into the hub

### Acceptance Criteria (per story — see Section 6)
Every AC maps to a concrete OpenAPI response code and the RFC 9457 `Problem` schema (`#/components/schemas/Problem`): **201**, **400**, **404**, **413**.

### Dependencies
- **Upstream:** `@sentinel/contracts` (types, Ajv toolchain, fixtures, MSW handlers) — exists and validates green.
- **Downstream unblocked:** `mfe-config` (POST), `mfe-metrics` (GET + SSE), Playwright E2E (ASD §10.4).

## 3. Requirements & Edge Cases

### 3.1 Confirmed Requirements (from ASD + specs + interrogation)
- Express app at `http://localhost:3000`, base path `/api/v1` (openapi `servers`).
- Error model: **RFC 9457** `application/problem+json` for **all** REST failures (D-2), with field-level `errors[]` for validation problems.
- **Fail-fast** validation on POST: malformed body, missing repo source, zero enabled rule sets, invalid severity threshold, **nonexistent `localPath`** → 400 (prior plan §3.2 decision).
- Payload size limit → **413** Problem Details (openapi `413` response; prior plan §3.2 "oversized payload" edge case).
- Unknown `auditId` → **404** Problem Details on both GET endpoints; on the stream endpoint the 404 must be sent **before** any `text/event-stream` header (D-3).
- SSE channel: strictly in-order per audit (NFR-A2), immediate flush per event (NFR-P1, no batching), per-audit scope only (NFR-S3), buffered replay then `AUDIT_COMPLETED` + close for already-finished audits, `Last-Event-ID` resync (D-6: event `id` = SSE `id:` field).
- LLM/provider failures are **never** HTTP errors — they surface as `TOOL_EXECUTION` (failed/degraded) or terminal `AUDIT_COMPLETED` (status failed) events (NFR-A3, openapi stream description).
- Audit lifecycle enum: `queued | running | completed | failed` (D-4). In-memory Maps only (ASD §8.1); server restart loses everything (documented limitation).
- No-auth PoC (NFR-S1); `X-API-Key` securityScheme reserved but not enforced.
- Double-connect to the same stream is allowed — the hub fans out per connection (prior plan §3.2).

### 3.2 Edge Cases (by category)

**Inputs (POST body):**
- Empty/missing/invalid-JSON body → 400 Problem Details.
- Both `repoUrl` and `localPath` present → 400 (oneOf violation of `AuditConfig`).
- `repoUrl` not a valid URI → 400 (`format: uri`).
- `ruleSets` with all-false or unknown keys → 400 (`additionalProperties: false`; at least one `true`).
- `severityThreshold` outside `LOW|MEDIUM|HIGH|CRITICAL` → 400 with allowed enum in `detail`/`errors[]`.
- Body larger than the configured limit → 413 (boundary: exactly at limit is accepted).
- `localPath` exists check: race between check and agent read is accepted (PoC; agent re-checks and surfaces `TOOL_EXECUTION` failure).

**State transitions:**
- `GET /audits/{id}` mid-run → `status: running` + partial `findings` (spec: "findings accumulated so far").
- `GET /audits/{id}` after `failed` → `status: failed`, empty findings, `summary` optional.
- `GET .../stream` on `completed`/`failed` audit → replay buffer, terminal event, close (openapi 200 description).
- `Last-Event-ID` greater than buffer length or non-numeric → resume from end of buffer (defensive; log warning).
- Concurrent POSTs → both accepted, independent auditIds (NFR-P2 single-audit PoC does not forbid it).

**Concurrency:** per-audit monotonic sequence assigned inside the hub (single-process Node, no locking needed). Multiple SSE connections to one audit share the same buffer; each gets its own cursor.

**Permissions:** none enforced (NFR-S1). Stream exposes no cross-audit data (NFR-S3) — auditId in every event envelope must match the path parameter.

**Integrations:** Agent runner is decoupled from HTTP (ASD §6.1); slow LLM calls never block the channel (CONCERN-002 tactic).

### 3.3 Unhappy Path Mapping
| Failure | Behavior |
|---|---|
| Malformed/invalid POST body | `400` Problem Details + `errors[]` |
| Oversized body | `413` Problem Details |
| Unknown auditId (GET) | `404` Problem Details |
| Unknown auditId (stream) | `404` **before** event-stream headers (D-3) |
| Agent crash mid-audit | terminal `AUDIT_COMPLETED` `{ status: 'failed', error }`; status → `failed`; stream closes |
| LLM throttle/unavailable | `TOOL_EXECUTION` `degraded` event + Ollama fallback (NFR-A3); never an HTTP error |
| Server restart mid-audit | out of scope — in-memory session lost (ASD §8.1); known limitation |

### 3.4 Assumptions
| # | Assumption | Status |
|---|---|---|
| A-1 | `apps/api` does not exist yet — greenfield (verified: no `apps/` directory) | Confirmed |
| A-2 | Express 4.x (stable, free) with native streaming via Node `http` semantics | Reasonable default — Express 5 not required |
| A-3 | `@sentinel/contracts` may be extended with a **runtime validators export** (Ajv-compiled, committed) so the API never re-implements schemas | Plan decision D-API-1 (Section 4, ADR candidate) |
| A-4 | Payload size limit 1 MB is generous enough for the PoC | Plan decision D-API-2 |
| A-5 | Audit ids generated as `aud_` + base36/nanoid-style suffix matching `^aud_[0-9a-zA-Z]+$` | Confirmed by openapi pattern |

### 3.5 Conflicting Requirements
None found. OpenAPI, events schema, ASD, and prior plan decisions are mutually consistent (prior plan's §3.2/§3.3 decisions are already encoded in the shipped spec files).

### 3.6 Existing Behavior Decisions
No existing implementation detected for `apps/api` — greenfield directory (verified: no `apps/` in the repo). Nothing to preserve, override, or escalate. The only protected surface is `packages/contracts`, which this plan **consumes, never modifies** (except the optional ADR-candidate validator export, D-API-1).

### 3.7 ASD Friction
None. All work item asks align with ASD §4 (C-02, C-03, C-04, C-05), §5, §6, §8, §10. Gaps (e.g., ASD does not prescribe where Ajv validators live) are recorded as **Decisions Made in This Plan**, not friction.

## 4. Architecture Alignment

**ASD Mode: `ASD-anchored`** (structured ASD at `.globant-skills-docs/asd/`, mirrored in `docs/asd/`).

### Mandatory Patterns
- **Spec-first, contracts before code** — ASD §5.1, C-04: `apps/api` implements `specs/openapi.yaml`; no endpoint outside the contract.
- **Shared types derived from contracts** — ASD §6.3.4, §8.3: all DTOs and event types imported from `@sentinel/contracts`; **no hand-written duplicate types**.
- **Layered lightweight backend** — ASD §6.2: Controllers → SSE Hub / Agent Runner; no heavy framework.
- **Unidirectional SSE** — ASD §6.2, C-02: agent emits → hub fans out; hub validates events against `specs/events-schema.json`.
- **In-memory persistence only** — ASD §8.1: Maps inside the Express process; no DB/ORM/migrations.
- **Simplicity over premature scale** — ASD §5.3 (keep seams: hub, runner interface).

### Technology Stack (ASD §6.3.2)
| Layer | Technology |
|---|---|
| Runtime | Node.js ≥ 20 (repo `engines`), TypeScript (strict), ESM (`"type": "module"`) |
| HTTP | Express |
| Validation | Ajv 8 + ajv-formats (already in `@sentinel/contracts` devDependencies) |
| Real-time | Native Server-Sent Events over Node HTTP streaming |
| Testing | Vitest + Supertest-style integration tests (in-process `app.listen(0)`), coverage > 80% (ASD §10.3, C §4.2) |
| Monorepo | pnpm Workspaces + Turborepo (`apps/api` workspace, dependency `@sentinel/contracts: "workspace:*"`) |

### Relevant Architecture Components (ASD §6.1)
| Component | Placement in `apps/api` |
|---|---|
| Express REST API | `src/app.ts` (routes/middleware), `src/server.ts` (bootstrap) |
| SSE Event Stream Hub | `src/sse/hub.ts` — per-audit ordered channel + buffer + fan-out |
| Agent Runner (seam) | `src/agent/runner.ts` — interface + stub implementation (ASD §6.3.4) |
| In-memory stores | `src/store/audits.ts` (Map), event buffer inside the hub |
| Contract glue | `src/lib/problems.ts` (Problem builder), validators from `@sentinel/contracts` |

### NFR Constraints on This Feature
- **NFR-P1:** SSE transport latency < 500ms — flush every event immediately; never batch; hub decoupled from agent task.
- **NFR-A2:** in-order per-audit delivery — monotonic sequence per audit; resync via `Last-Event-ID`.
- **NFR-A3:** provider resilience — degradation modeled as events, never transport errors.
- **NFR-S1:** no-auth; optional simulated `X-API-Key` header check only.
- **NFR-S3:** stream is per-audit; no cross-audit data leakage.
- **NFR-O1/O3:** one-command bootstrap (`turbo dev`); quality gates lint/typecheck/test enforced.

### Integration Points (ASD §6.3.5)
| Integration | Direction | Contract |
|---|---|---|
| `mfe-config` → API | Inbound REST | `specs/openapi.yaml` (POST /audits) |
| `mfe-metrics` → API | Inbound SSE | `openapi.yaml` + `events-schema.json` |
| `mfe-metrics` → API | Inbound REST | `openapi.yaml` (GET /audits/{id}, Markdown export source) |
| Agent Engine → Hub | Internal | `events-schema.json` (every emitted event Ajv-validated) |
| Agent Engine → LLM/Git | Outbound (US-5) | Internal abstraction; stub in US-4 |

### How `apps/api` Consumes `@sentinel/contracts`
1. **Types (compile-time):** import `AuditConfig`, `Audit`, `AuditCreated`, `Finding`, `Problem`, `Severity`, `AuditStatus` from the barrel (`packages/contracts/src/index.ts`). Controllers, store, and hub signatures use only these types — the generated `api-schema.d.ts`/`events.d.ts` make drift impossible by construction (§8.3).
2. **Ajv validators (runtime):**
   - **Inbound (POST body):** compile the `AuditConfig` shape from the contract once at startup (`ajv.compile` with `ajv-formats` for `uri`/`date-time`). Reuse the exact JSON Schema constraints already validated by the contracts gate (`packages/contracts/src/validate.ts` pattern: `allErrors: true, strict: false`). Ajv error instances map 1:1 into the `Problem.errors[]` field list.
   - **Outbound (SSE):** compile `specs/events-schema.json` (draft-07, `oneOf` over 4 types) and validate **every** event before it enters a connection buffer. An invalid event is a programming error: log loudly + fail the audit with terminal `AUDIT_COMPLETED(failed)` rather than emitting a contract-violating frame (hub is the validator of record per ASD §6.1).
   - **Where the compiled validators live:** the API compiles them from `/specs` at bootstrap via a small `src/lib/validators.ts` adapter. To avoid two consumers re-deriving schemas, prefer promoting them into `@sentinel/contracts` as a `validators.ts` export (mirroring the existing `validate.ts` gate) — tracked as **D-API-1 / ADR candidate**; until the ADR lands, the local adapter is the fallback and MUST import the schema JSON from `/specs` (never restate it).
3. **SSE framing:** follow the wire format already canonicalized in `packages/contracts/src/mocks/handlers.ts` (`serializeSseEvents`): `id: <envelope.id>` / `event: <envelope.type>` / `data: <JSON.stringify(envelope)>` + blank line, `retry: 5000` hint on connect. The API's production serializer mirrors this exactly so MSW-mocked and real streams are indistinguishable to consumers.
4. **Fixtures for tests:** reuse `allEventFixtures` / `happyPathAuditSequence` / Problem fixtures from `packages/contracts/src/fixtures/events.ts` as deterministic stub-runner output (ASD §10.2 — mocks live alongside contracts so drift is impossible).
5. **MSW handlers (tests only):** `packages/contracts/src/mocks/handlers.ts` stays the *frontend-facing* mock; the API's own tests exercise the real Express app in-process (Supertest) — MSW is not used to test the implementation itself.

### Decisions Made in This Plan (ADR candidates)
| ID | Decision | Rationale |
|---|---|---|
| D-API-1 | Runtime Ajv validators compiled from `/specs` (promote to `@sentinel/contracts` export via ADR) | Single source of truth; hub is validator of record (ASD §6.1); prevents schema restatement drift |
| D-API-2 | Request body limit **1 MB** → 413 | OpenAPI mandates 413; generous for PoC |
| D-API-3 | Stub agent runner driven by `happyPathAuditSequence` fixtures in US-4; real runner in US-5 | Decouples SSE channel correctness from LLM integration; deterministic tests (ASD §10.5) |
| D-API-4 | Event buffer capped (e.g., last 1000 events per audit) | Replay must terminate; PoC audits are short; cap documented, not configurable |
| D-API-5 | Express `ErrorRequestHandler` centralizes Problem Details rendering (400/404/413 + fallback 500) | Consistent RFC 9457 shape (D-2); single exit point for errors |
| D-API-6 | SSE close after terminal `AUDIT_COMPLETED` for replayed/finished audits; keep open for live audits until terminal event | Matches openapi 200 description; prevents orphan streams (prior plan §3.3) |

## 5. Technical Approach

### High-Level Strategy
Vertical slices per story: scaffold → write path (POST + validation) → read path (GET + session state) → streaming path (SSE hub + resync) → agent integration. Each slice ends green under the local pipeline gates (ASD §9.2).

### Key Components
| Component | Purpose |
|---|---|
| `src/server.ts` | Bootstrap: http server on `PORT` (default 3000), graceful shutdown |
| `src/app.ts` | Express app: JSON parser (limit D-API-2), routes, error handler |
| `src/lib/problems.ts` | RFC 9457 builder: `problem(status, title, detail, errors?, instance?)` with `type` URI per category |
| `src/lib/validators.ts` | Ajv compilation of `AuditConfig` + `events-schema.json` (per D-API-1) |
| `src/store/audits.ts` | `Map<auditId, Audit>`; lifecycle transitions; findings accumulation |
| `src/sse/hub.ts` | Per-audit channel: subscribe/unsubscribe, buffer, monotonic ids, `Last-Event-ID` resync, replay-then-close, immediate flush |
| `src/agent/runner.ts` | `AuditRunner` interface + `StubAuditRunner` (fixtures) — US-5 adds the real runner |
| `tests/**` | Vitest unit + integration suites per story |

### Data Model
In-memory only (ASD §8.1): `Audit` (auditId, status, config, createdAt, findings[], summary?) keyed by `auditId`; per-audit ordered event buffer inside the hub. No database, no migrations.

### API Changes
All new, exactly the 3 contract paths. Full response matrix per story in Section 6.

### External Dependencies
`express` (free); dev: `vitest`, `supertest` + `@types/supertest`, `@types/express`. Everything else comes from the workspace (`@sentinel/contracts`) — honoring C-06 ($0, no paid deps).

## 6. Detailed Task Breakdown — User Stories

Verification gate (applies to **every** story, non-negotiable before merge):
```
pnpm --filter @sentinel/api lint        # zero ESLint errors (§9.2)
pnpm --filter @sentinel/api typecheck   # tsc --noEmit, zero errors
pnpm --filter @sentinel/api test        # Vitest, coverage > 80% (§10.3)
pnpm --filter @sentinel/contracts validate   # contract gate stays green (C-04)
```

---

### US-1 — App Scaffolding & Setup  `(Phase 1 — Foundation)`

**Goal:** `apps/api` exists in the monorepo, boots an Express server on port 3000, depends on `@sentinel/contracts`, and passes all pipeline gates.

**Tasks:**
- **Task 1.1** — Scaffold `apps/api`: `package.json` (name `@sentinel/api`, `"type": "module"`, scripts `dev`/`build`/`lint`/`typecheck`/`test`), `tsconfig.json` (strict, ESM, Node20 module resolution), `src/server.ts` + `src/app.ts` skeleton with `/api/v1` router and a temporary `GET /api/v1/health` (internal smoke route; removed or kept out of contract docs at US-2 review). **Effort:** S · **AC:** US1-AC1, US1-AC2
- **Task 1.2** — Register the workspace: add `apps/api` to `pnpm-workspace.yaml` globs, add `"@sentinel/contracts": "workspace:*"` dependency, wire `lint`/`typecheck`/`test`/`build` into `turbo.json`. **Effort:** S · **AC:** US1-AC3
- **Task 1.3** — Test scaffolding: Vitest config with coverage thresholds (> 80% lines/branches per ASD §10.3), one smoke integration test (server boots, base route responds). **Effort:** S · **AC:** US1-AC4

**Acceptance Criteria:**
| # | Criterion | Maps to |
|---|---|---|
| US1-AC1 | `apps/api` boots an Express server on `http://localhost:3000` and serves `/api/v1` | openapi `servers` |
| US1-AC2 | All domain types/DTOs referenced by the app are imported from `@sentinel/contracts` — zero hand-written duplicates of contract types | ASD §6.3.4, §8.3 |
| US1-AC3 | `turbo run lint/typecheck/test` include `apps/api` and pass | ASD §9.2 |
| US1-AC4 | Coverage gate (> 80%) enforced by Vitest config | ASD §10.3, §4.2 |

**Edge cases addressed:** none (scaffold). · **Depends on:** `@sentinel/contracts` (done).

---

### US-2 — `POST /audits` & Fail-Fast Validation  `(Phase 2 — Core Logic)`

**Goal:** `POST /api/v1/audits` validates `AuditConfig` fail-fast, returns `201 AuditCreated`, and renders every rejection as RFC 9457 Problem Details.

**Tasks:**
- **Task 2.1** — `src/lib/validators.ts`: compile the `AuditConfig` JSON Schema (`repoUrl XOR localPath` oneOf, `format: uri`, `RuleSets.additionalProperties: false`, `Severity` enum) with Ajv + ajv-formats, per D-API-1. **Effort:** S · **AC:** US2-AC2, US2-AC3
- **Task 2.2** — `src/lib/problems.ts`: Problem builder emitting `application/problem+json` with `type`, `title`, `status`, `detail`, `instance`, `errors[]` (openapi `Problem` schema). Distinct `type` URIs per failure class (validation-error, payload-too-large, not-found). **Effort:** S · **AC:** US2-AC2, US2-AC3, US2-AC4
- **Task 2.3** — `POST /audits` controller: JSON parse (limit 1 MB per D-API-2), Ajv validation, `localPath` existence check via `fs/promises` (fail fast, prior plan §3.2 decision), audit id generation (`aud_` + suffix matching `^aud_[0-9a-zA-Z]+$`), persist `Audit { status: 'queued' }` in `src/store/audits.ts`, respond `201 { auditId, status: 'queued' }`. **Effort:** M · **AC:** US2-AC1..3
- **Task 2.4** — Central error handler (D-API-5): map body-parse overflow → **413**, validation errors → **400** with `errors[]`, unknown routes → 404, fallback → 500 Problem. **Effort:** S · **AC:** US2-AC3, US2-AC4
- **Task 2.5** — Tests: happy path 201 (schema of `AuditCreated`); each 400 class (empty body, both repo sources, neither, zero-enabled ruleSets, unknown ruleSet key, bad severity, nonexistent localPath); 413 boundary (payload just over limit); header assertion `Content-Type: application/problem+json`. **Effort:** M · **AC:** all US2 ACs

**Acceptance Criteria:**
| # | Criterion | OpenAPI mapping |
|---|---|---|
| US2-AC1 | Valid `AuditConfig` → **201** with body `{ auditId, status }` where `auditId` matches `^aud_[0-9a-zA-Z]+$` and `status: 'queued'`; audit persisted in memory and (from US-4) execution spawned | `POST /audits` → `201 AuditCreated` |
| US2-AC2 | Malformed body, missing/ambiguous repo source, zero enabled rule sets, or invalid `severityThreshold` → **400** `application/problem+json` with field-level `errors[]` | `400` → `$ref Problem` |
| US2-AC3 | Nonexistent `localPath` rejected at request time (fail fast) → **400** Problem Details, never deferred to agent runtime | `400` description (fail fast) |
| US2-AC4 | Request body exceeding 1 MB → **413** `application/problem+json` (no half-parsed state) | `413` → `$ref Problem` |

**Edge cases addressed:** §3.2 inputs (all rows). · **Depends on:** US-1.

---

### US-3 — `GET /audits/{id}` & Session State  `(Phase 3 — Integration)`

**Goal:** `GET /api/v1/audits/{auditId}` returns the session-scoped audit resource; unknown ids return 404 Problem Details.

**Tasks:**
- **Task 3.1** — Extend `src/store/audits.ts`: lifecycle transitions (`queued → running → completed | failed`), `findings[]` accumulation from stream events, `summary` set on terminal status (openapi `Audit` semantics). **Effort:** S · **AC:** US3-AC1
- **Task 3.2** — `GET /audits/:auditId` controller: path-param pattern check (`^aud_[0-9a-zA-Z]+$`), store lookup, **200** `Audit` (config echo, createdAt ISO date-time, findings so far) or **404** Problem Details. **Effort:** S · **AC:** US3-AC1, US3-AC2
- **Task 3.3** — Tests: 200 for queued/running/completed/failed fixtures (findings present only when accumulated; `summary` only when terminal); 404 for unknown id and for id violating the pattern; response validates against `Audit` generated type. **Effort:** S · **AC:** all US3 ACs

**Acceptance Criteria:**
| # | Criterion | OpenAPI mapping |
|---|---|---|
| US3-AC1 | Known `auditId` → **200** `Audit`: `status` ∈ `queued|running|completed|failed`, `config` echoes the request, `createdAt` is RFC 3339, `findings` = accumulated-so-far (complete once completed) | `GET /audits/{auditId}` → `200 Audit` |
| US3-AC2 | Unknown `auditId` → **404** `application/problem+json` (type `not-found`), never an empty 200 | `404` → `$ref Problem` |
| US3-AC3 | Response payload round-trips against the `@sentinel/contracts` `Audit` type (compile-time) and openapi schema (runtime sample check) | `#/components/schemas/Audit` |

**Edge cases addressed:** §3.2 state transitions (rows 1–2). · **Depends on:** US-2.

---

### US-4 — `GET /audits/{id}/stream` SSE Channel & Resync  `(Phase 3 — Integration)`

**Goal:** Per-audit SSE hub delivering the 4 contract event types in order, with immediate flush, buffered replay + close for finished audits, and `Last-Event-ID` resync. 404-before-headers for unknown ids.

**Tasks:**
- **Task 4.1** — `src/sse/hub.ts`: per-audit channel with subscribe (fan-out, multiple concurrent connections allowed), monotonic per-audit sequence (starts at 1, D-6), capped buffer (D-API-4), `Last-Event-ID` resume, immediate per-event flush (NFR-P1). **Effort:** M · **AC:** US4-AC2, US4-AC3, US4-AC5
- **Task 4.2** — SSE serializer mirroring `@sentinel/contracts` `serializeSseEvents` framing: `id: <envelope.id>`, `event: <type>`, `data: <envelope JSON>`, trailing blank line, `retry: 5000`; headers `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`. **Effort:** S · **AC:** US4-AC2
- **Task 4.3** — `GET /audits/:auditId/stream` controller: **404 Problem Details before any event-stream header** when the audit is unknown (D-3); otherwise 200 event-stream, replay buffer (finished audits) → terminal `AUDIT_COMPLETED` → close (D-API-6); live audits stay open until terminal event. Enforce envelope `auditId` === path `auditId` (NFR-S3). **Effort:** M · **AC:** US4-AC1, US4-AC3, US4-AC4
- **Task 4.4** — `Last-Event-ID` resync: on reconnect, resume strictly after the given id; non-numeric/unknown ids resume from buffer end (defensive, §3.2). **Effort:** S · **AC:** US4-AC5
- **Task 4.5** — Stub runner (D-API-3): `AuditRunner` interface + fixture-driven implementation emitting `happyPathAuditSequence` (and a failure sequence) through the hub; POST triggers it async (`setImmediate`) so the HTTP response is never blocked. **Effort:** M · **AC:** US4-AC5, US4-AC6
- **Task 4.6** — Tests: 404-before-headers (assert no `text/event-stream` header on 404); replay-then-close on completed audit; in-order ids 1..n per audit; resync mid-stream via header; event payload of every emitted frame validates against `specs/events-schema.json` via Ajv; double-connect fan-out; latency sanity (no artificial batching). **Effort:** L · **AC:** all US4 ACs

**Acceptance Criteria:**
| # | Criterion | OpenAPI / contract mapping |
|---|---|---|
| US4-AC1 | Unknown `auditId` → **404** `application/problem+json` sent **before** any `text/event-stream` header (D-3) | `stream` → `404` description |
| US4-AC2 | Known `auditId` → **200** `text/event-stream`; every frame: `event:` ∈ {AGENT_THOUGHT, TOOL_EXECUTION, VULNERABILITY_FOUND, AUDIT_COMPLETED}, `data:` validates against `specs/events-schema.json`, `id:` = envelope `id` (D-6) | `stream` → `200` description + events-schema |
| US4-AC3 | Stream for already-finished audit replays buffered events, delivers terminal `AUDIT_COMPLETED`, then closes (D-API-6) | `200` description (replay semantics) |
| US4-AC4 | Delivery strictly in-order per audit with immediate flush (no batching) — NFR-A2/NFR-P1 | `200` description; ASD §3.1 |
| US4-AC5 | Reconnect with `Last-Event-ID` resumes after that event id without duplicates or gaps | `LastEventId` parameter description |
| US4-AC6 | Provider failure never produces an HTTP error on the stream — degraded/failed outcomes arrive as contract events (NFR-A3); agent crash emits terminal `AUDIT_COMPLETED { status: 'failed' }` and closes | `TOOL_EXECUTION` payload spec; §3.3 unhappy paths |

**Edge cases addressed:** §3.2 state transitions (rows 3–5), concurrency (fan-out), unhappy paths (rows 4–5). · **Depends on:** US-2, US-3.

---

### US-5 — Agent Runner Integration  `(Phase 4 — Polish & Validation)`

**Goal:** Replace the fixture stub with the real Audit Runner behind the LLM abstraction (ASD §6.1, §5.6), completing the vertical slice `POST → stream → completed audit with findings`.

**Tasks:**
- **Task 5.1** — `AuditRunner` real implementation: clone/read repo (Git URL or local path), inspect snippets via LLM abstraction layer (free-tier provider, Ollama fallback per CONCERN-004). **Effort:** L · **AC:** US5-AC1
- **Task 5.2** — Emission discipline: every thought/tool/finding/completion event passes the hub's Ajv gate; `VULNERABILITY_FOUND` always carries Before/After snippets (ASD §5.5); `AUDIT_COMPLETED(failed)` on any engine crash (no orphan streams). **Effort:** M · **AC:** US5-AC2, US5-AC3
- **Task 5.3** — Degradation path: provider throttle → `TOOL_EXECUTION(degraded)` + Ollama fallback; both providers down → audit fails via terminal event, never an HTTP error (NFR-A3). **Effort:** M · **AC:** US5-AC3
- **Task 5.4** — Integration tests with stub LLM adapter (ASD §10.3): full-audit sequence asserted against the events schema; findings surfaced in `GET /audits/{id}` after completion. **Effort:** M · **AC:** US5-AC1..3

**Acceptance Criteria:**
| # | Criterion | Mapping |
|---|---|---|
| US5-AC1 | Full flow: `POST /audits` 201 → stream events → `GET /audits/{id}` 200 with `status: 'completed'`, findings + `summary` present | openapi POST/GET 200/201 |
| US5-AC2 | Every emitted event validates against `events-schema.json`; ids monotonic per audit | events-schema (normative) |
| US5-AC3 | LLM throttling/unavailability → `TOOL_EXECUTION` degraded/failed events + Ollama fallback; engine crash → terminal failed `AUDIT_COMPLETED`; stream never left open, never errors at transport level | NFR-A3, CONCERN-004, D-6 stream description |

**Edge cases addressed:** §3.2 integrations; §3.3 rows 4–5. · **Depends on:** US-4. (US-5 may be scheduled as its own follow-up milestone if the 15-day window demands; US-1–4 deliver the full contract surface.)

## 7. Implementation Sequence

- **Phase 1 — Foundation:** US-1 (scaffold, gates wired)
- **Phase 2 — Core Logic:** US-2 (POST + validation + Problem Details + store)
- **Phase 3 — Integration:** US-3 (GET + session state), US-4 (SSE hub + stream + resync + stub runner)
- **Phase 4 — Polish & Validation:** US-5 (real runner), coverage hardening, README/docs touch

Estimated total: ~5–7 developer-days (US-5 excluded: ~4–5).

## 8. Definition of Done

**Project Quality Gates (ASD-anchored):**
- [ ] Contract gate green before merge — `pnpm --filter @sentinel/contracts validate` (C-04, §9.3)
- [ ] `turbo run lint` zero ESLint errors across `apps/api` (§9.2)
- [ ] `turbo run typecheck` zero `tsc --noEmit` errors (§9.2)
- [ ] Coverage > 80% on `apps/api` logic (Vitest, §10.3; C §4.2)
- [ ] Required test types present — unit (validators, store, hub) + integration (supertest REST, in-process SSE reads); runner unit-tested with stub LLM adapter (§10.3)
- [ ] Architecture principles followed — spec-first (§5.1), contracts-only types (§6.3.4), in-memory only (§8.1), no deviations from §5 patterns
- [ ] NFRs validated: SSE flush-per-event (P1), in-order + resync (A2), degradation-as-event (A3), no-auth (S1), per-audit stream scope (S3)

**Standard Checklist:**
- [ ] All US-1..US-5 acceptance criteria validated (201/400/404/413 paths covered by tests)
- [ ] Every REST error response is RFC 9457 `application/problem+json` with correct `type`/`title`/`status`/`detail`/`errors[]`
- [ ] All edge cases from §3.2 handled and tested; unhappy paths from §3.3 have defined behavior
- [ ] Assumptions A-1..A-5 resolved (A-3 ADR drafted or fallback documented)
- [ ] Unit + integration tests passing; no critical/high bugs
- [ ] `apps/api` README section: how to run, contract references, env/PORT
- [ ] Consumed `@sentinel/contracts` without modification (or ADR filed per D-API-1)

## 9. Risks & Considerations

- **Technical risks:** Express + SSE needs manual response handling (`res.write`, heartbeat comments to defeat proxy buffering); mitigated by a thin hub with explicit flush and tests reading raw chunks. OpenAPI 3.1 SSE typing is prose-backed — `events-schema.json` remains normative (accepted in prior plan §9).
- **Dependencies:** none blocking; `@sentinel/contracts` already green.
- **Performance:** NFR-P1 (< 500ms) — no batching, no middleware that buffers the stream response; hub decouples agent latency from the channel (CONCERN-002 tactic).
- **Security:** no-auth PoC (NFR-S1); `localPath` handling must not leak filesystem details beyond Problem `detail` (confidential source, NFR-S2); stream scoped per audit (NFR-S3); tool `input` payloads sanitized (events-schema note — no secrets/full file dumps).
- **Migration/backward compatibility:** none — greenfield; in-memory data is session-scoped by design (ASD §8.1).

## 10. Open Questions

| # | Question | Owner | Blocking? |
|---|---|---|---|
| Q-1 | Promote Ajv validators into `@sentinel/contracts` (D-API-1) or keep local adapter in `apps/api`? | Backend + contracts owner | No (ADR during US-2) |
| Q-2 | Which free-tier LLM provider is primary for US-5 (drives the abstraction layer's first adapter)? | Product / Lead Dev | Only for US-5 |
| Q-3 | Event buffer cap value (D-API-4) — 1000 events sufficient for PoC audits? | Backend | No |

## 11. ASD Friction & ADR Candidates

Omitted — no ASD friction confirmed. All plan-specific choices (D-API-1..D-API-5) are gaps the ASD is silent on, tracked as ADR candidates in Section 4, not conflicts.

## 12. Contracts Consumption Reference (normative for `apps/api`)

```ts
// Types — compile-time only, from the contracts barrel (packages/contracts/src/index.ts):
import type {
  AuditConfig, Audit, AuditCreated, Finding, Problem, Severity, AuditStatus,
  AgentThoughtEvent, ToolExecutionEvent, VulnerabilityFoundEvent, AuditCompletedEvent,
} from '@sentinel/contracts';

// Runtime validation — Ajv compiled from /specs (D-API-1), used at:
//  1. POST /audits body        → AuditConfig JSON Schema  → 400 Problem on failure
//  2. SSE hub emission gate    → events-schema.json oneOf → contract-violating events never hit the wire
//  3. Test assertions          → every fixture/stub event re-validated

// SSE framing (mirror of packages/contracts/src/mocks/handlers.ts serializeSseEvents):
//   id: <envelope.id>\nevent: <envelope.type>\ndata: <JSON.stringify(envelope)>\n\n
//   + retry: 5000 on connect; flush per frame; close after terminal AUDIT_COMPLETED
```
