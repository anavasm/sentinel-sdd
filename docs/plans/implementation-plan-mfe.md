# Implementation Plan — MFE Frontend (`apps/mfe-shell`, `apps/mfe-config`, `apps/mfe-metrics`)

> Work item: "Implement the frontend application of the DevSecOps Sentinel AI MVP as three Microfrontends (`apps/mfe-shell`, `apps/mfe-config`, `apps/mfe-metrics`) wired via Vite Module Federation, consuming `@sentinel/contracts` directly and the backend endpoints shipped in `@sentinel/api` (`specs/openapi.yaml` + `specs/events-schema.json`)."
> Generated: 2026-09-29 · Source docs: `docs/PROJECT_BRIEF.md`, `docs/ARCHITECTURE.md`, `docs/asd/*`, `specs/openapi.yaml`, `specs/events-schema.json`, `packages/contracts/*`, `docs/plans/implementation-plan-apps-api.md` (decisions D-API-1..6 inherited), backend ADRs `docs/adr/ADR-001..004`
> Position in roadmap: **fourth milestone** — unblocked by the shipped `@sentinel/api` (all 3 REST/SSE endpoints green, US-1..US-5 backend plan completed). This milestone unblocks the Playwright E2E suite (ASD §10.4) and closes the MVP vertical slice end-to-end.
> Status: **Planning — NOT committed** (left uncommitted for manual review; no application source code written yet).

---

## 1. Executive Summary

Build the frontend of the MVP as a **Module Federation microfrontend system** honoring constraint C-01:

- **`apps/mfe-shell`** (host) — app shell, global layout, host routing (`/` → config, `/audits/:auditId` → metrics), remote loading, cross-MFE navigation.
- **`apps/mfe-config`** (remote 1) — Audit Configuration form (repo source, rule sets, severity threshold) with **client-side fail-fast validation derived from `@sentinel/contracts`**, launching `POST /api/v1/audits` and redirecting to `/audits/{auditId}`.
- **`apps/mfe-metrics`** (remote 2) — Live Audit Execution Dashboard consuming the per-audit SSE stream via a custom `useAgentStream` hook (Last-Event-ID resync, dedup, reconnect), rendering `AGENT_THOUGHT` / `TOOL_EXECUTION` (incl. **LLM degradation indicators**), a Findings Viewer with Before/After code diffs, and the terminal summary report (healthScore, severity counters, Markdown export).

All DTOs, event types, Problem shapes, and SSE framing come from **`@sentinel/contracts`** (generated from `/specs` — drift impossible by construction, ASD §8.3). MSW mocks already exist in `packages/contracts/src/mocks/handlers.ts` and mirror the backend framing exactly (ADR-001), so every MFE is testable and demoable against contract-faithful mocks before/without the real backend.

**Estimated complexity:** L (3 workspaces + federation wiring + SSE hook with resync state machine + diff rendering + charts; no new backend work, no paid deps).

**Sequential User Stories:**
- **US-1** — MFE Workspaces Scaffolding, Module Federation Wiring, Routing & Smoke Tests
- **US-2** — Audit Launch Form (`mfe-config`) & Client-Side Fail-Fast Validation
- **US-3** — Real-Time SSE Stream Hook & Resync Management (`useAgentStream`, `mfe-metrics`)
- **US-4** — Live Audit Execution Dashboard (`mfe-metrics`)
- **US-5** — Findings Viewer (Before/After diffs) & Terminal Summary Metrics Report (`mfe-metrics`)

## 2. Work Item Analysis

### Original Intent
From PB §3 (Modules A & B), ASD §2.1, and `docs/ARCHITECTURE.md` §2: the UI is decomposed into one host + two remotes. `mfe-config` collects repo + rules and launches audits (`POST /api/v1/audits`); `mfe-shell` hosts both remotes and owns routing; `mfe-metrics` renders the live agent stream, health dashboard, refactoring drawer, and Markdown export. All types come from `@sentinel/contracts`; all endpoints/events conform to `/specs`; testing follows the Testing Trophy with MSW contract mocks (ASD §10).

### Breakdown
1. Three workspace scaffolds + Module Federation host/remote wiring + host routing + smoke tests
2. Launch form with contract-derived client-side validation + POST + redirect
3. SSE consumption hook: connect, replay handling, `Last-Event-ID` resync, dedup, terminal close, reconnect
4. Live dashboard components over the hook: event feed, tool status, degradation indicators
5. Findings viewer (Before/After diffs) + terminal metrics (healthScore, severity counters) + Markdown export

### Acceptance Criteria (per story — see Section 6)
Every AC maps to an openapi response, an `events-schema.json` event type, or an ASD constraint. Response codes covered: **201** (AuditCreated), **400/413** (Problem rendering), **404** (unknown audit → not-found state), **200** (SSE stream / Audit).

### Dependencies
- **Upstream:** `@sentinel/contracts` (types, fixtures, MSW handlers, `serializeSseEvents`) — green. `@sentinel/api` (all 3 endpoints implemented, ADR-001..004 Accepted) — green.
- **Downstream unblocked:** Playwright E2E suite (ASD §10.4), Markdown report export flow.

## 3. Requirements & Edge Cases

### 3.1 Confirmed Requirements (from ASD + specs + backend reality)
- **Topology (C-01, user-confirmed 2026-09-29):** `apps/mfe-shell` (host) + `apps/mfe-config` + `apps/mfe-metrics` (remotes) via **Vite + `@originjs/vite-plugin-federation`**. All three under `apps/`, registered in `pnpm-workspace.yaml` (glob `apps/*` already covers them).
- **Spec-first (C-04, §5.1):** every network interaction conforms to `specs/openapi.yaml`; every rendered event conforms to `specs/events-schema.json`. Zero hand-written duplicate contract types (ASD §6.3.4/§8.3) — all imported from `@sentinel/contracts`.
- **Backend surface consumed (already live in `@sentinel/api`):**
  - `POST /api/v1/audits` → 201 `{ auditId, status }` · 400/413 RFC 9457 Problem.
  - `GET /api/v1/audits/{auditId}` → 200 `Audit` / 404 Problem.
  - `GET /api/v1/audits/{auditId}/stream` → 200 SSE, `retry: 5000` hint, `id:` = envelope id (D-6), buffered replay for late joiners, 404 Problem **before** headers (D-3), terminal `AUDIT_COMPLETED` then close (D-API-6).
- **SSE client contract:** envelope `id` = monotonic per-audit sequence starting at 1 (D-6); frames `id:`/`event:`/`data:` + blank line; `retry: 5000` on connect. Native `EventSource` **cannot send custom headers**, so `Last-Event-ID` resync relies on the browser's built-in header replay on automatic reconnection; manual reconnects pass the cursor via `EventSource`'s native behavior or re-subscribe from the server's buffered replay (see ADR-006).
- **Degradation UX (NFR-A3):** `TOOL_EXECUTION { status: 'degraded' }` renders a visible, non-fatal degradation indicator (throttle/fallback); `status: 'failed'` + terminal `AUDIT_COMPLETED { status: 'failed' }` render a terminal failure state. Provider failure is **never** shown as a transport/HTTP error.
- **Findings completeness (§5.5):** every `VULNERABILITY_FOUND` carries `beforeSnippet`/`afterSnippet` — the viewer renders side-by-side diffs; missing snippets would indicate a contract violation (surface as an anomaly, not a crash).
- **State ownership:** TanStack Query for REST server-state (`Audit`, POST mutation); the SSE hook owns the streaming event list (streaming state is **not** query cache — ADR-006/007 territory).
- **No-auth PoC (NFR-S1)**; dev ports: shell 5173, config 5174, metrics 5175 (assigned in this plan, D-WEB-2); API at `http://localhost:3000` (openapi `servers`).
- Testing per ASD §10: Vitest + RTL + MSW (>80% coverage on hooks/components), 1 Playwright E2E suite (shell→config→metrics full flow), MSW fixtures including the LLM-degradation sequence (`stub-runner.ts` `failureSequence` parity).

### 3.2 Edge Cases (by category)

**Inputs (launch form):**
- Both `repoUrl` and `localPath` filled, or neither → block submit with field-level error (mirrors backend `oneOf`; fail fast **before** the POST).
- `repoUrl` invalid URI → inline validation error (same rules as backend Ajv: `format: uri`).
- Zero enabled rule sets → block submit (openapi `RuleSets` semantics: at least one `true`).
- `severityThreshold` unset → default `LOW` (contract enum `LOW|MEDIUM|HIGH|CRITICAL`).
- Double-submit while POST in flight → disabled button / in-flight state; second POST would create a second audit (store has no dedup).
- Server rejects with 400 Problem → render `errors[]` field messages inline; **400/413 never leave the user on a dead screen** (RFC 9457 Problem rendered).

**State transitions (metrics view):**
- Direct navigation to `/audits/:id` for an unknown id → GET returns 404 Problem → render a "not found" state, never a blank dashboard.
- Joining an already-running audit → SSE replay delivers buffered events first; hook must dedupe against anything already rendered and place events in id order (gaps = await replay, not assume loss).
- Joining a finished audit → replay ends with terminal `AUDIT_COMPLETED` and the server closes (D-API-6); UI shows final state immediately (replay-then-close, backend ADR-001).
- `AUDIT_COMPLETED { status: 'failed' }` → render failed terminal state with `error` detail; no reconnect loop against a closed stream (D-3/A-3 semantics).
- Server restart mid-audit → audit vanishes (in-memory backend, ADR-004); stream 404s; UI renders a "session lost" state rather than retrying forever.

**Concurrency / reconnection:**
- Network blip mid-stream → browser auto-reconnects with `Last-Event-ID`; hook dedupes by envelope `id` (already-rendered ids are dropped; out-of-order inserts are sorted by id — ADR-006).
- Reconnect after buffer eviction (client cursor older than the server's 1000-event buffer, backend ADR-004) → server resumes from buffer end; UI shows a **gap indicator** rather than silently pretending continuity.
- Tab visibility changes / laptop sleep → EventSource may drop; reconnect policy is bounded backoff (see ADR-006), not hammering.

**Permissions:** none (NFR-S1). Stream is per-audit (NFR-S3) — the hook must reject/discard events whose envelope `auditId` ≠ route param.

**Integrations:** MSW handlers from `packages/contracts` mock REST + SSE for tests and pre-backend dev; backend must be reachable at the configured `VITE_API_BASE_URL` for live runs.

### 3.3 Unhappy Path Mapping
| Failure | Behavior |
|---|---|
| POST validation failure (400 Problem) | Inline field errors from `Problem.errors[]`; form stays filled; no navigation |
| POST 413 (oversized body) | Problem rendered as form-level error banner |
| Stream 404 (unknown audit, D-3) | "Audit not found" terminal UI state; no EventSource retry loop |
| SSE drop mid-stream | Auto-reconnect (browser `retry: 5000` + hook backoff); resume via `Last-Event-ID`/replay; dedupe + reorder |
| Buffer-evicted reconnect (gap) | Reconcile via `GET /audits/{id}` (findings so far) + reconnect from buffer end; UI banner "some early events may be missing" |
| `TOOL_EXECUTION degraded` | Amber degradation indicator; analysis continues (NFR-A3) |
| Both providers down → terminal failed event | Red terminal state + `AUDIT_COMPLETED.failed` error detail; stream closed by server |
| Backend down entirely (ECONNREFUSED / fetch error) | Error state with retry affordance; no crash, no blank page |
| Malformed SSE frame (schema-invalid `data`) | Client-side contract validation discards + logs loudly (console.error); UI shows "skipped an invalid event" counter — the browser never renders an unvalidated payload as a finding |

### 3.4 Assumptions
| # | Assumption | Status |
|---|---|---|
| A-1 | No frontend code exists yet — greenfield `apps/*` directories (verified: only `apps/api` exists) | Confirmed |
| A-2 | `@originjs/vite-plugin-federation` (free, MIT) is acceptable for Module Federation per `docs/ARCHITECTURE.md` §2 | Confirmed (ASD §2 names it) |
| A-3 | TanStack Query + React Hook Form + Recharts (all free) per ARCHITECTURE.md §2 topology | Confirmed by ARCHITECTURE.md |
| A-4 | Native `EventSource` (not `fetch`-based SSE polyfill) — sufficient because the stream needs no custom headers beyond what the browser replays natively | Plan decision D-WEB-1 (ADR-006) |
| A-5 | Client-side validation reuses the contract JSON Schemas via `@sentinel/contracts` rather than a parallel hand-written schema — mirrors backend D-API-1 | Plan decision (ADR-007) |
| A-6 | Markdown export is client-side generation from the terminal `Audit` resource (GET), not a new backend endpoint | Plan decision D-WEB-3 (openapi has no export endpoint) |

### 3.5 Conflicting Requirements
- **C-01 (MFE) vs. original work-item phrasing "apps/web":** resolved by user decision (2026-09-29) — the MFE topology inside `apps/` is authoritative (`mfe-shell` + `mfe-config` + `mfe-metrics`); the earlier `apps/web` naming is superseded by this plan and ADR-005.
- None further. ARCHITECTURE.md §2 (federation plugin, ports of entry), ASD §4/§6, and the shipped backend are mutually consistent.

### 3.6 Existing Behavior Decisions
No existing frontend implementation detected — greenfield `apps/` (only `apps/api` exists). Nothing to preserve, override, or escalate. Protected surfaces this plan **consumes, never modifies**: `packages/contracts` (barrel, fixtures, MSW handlers) and `apps/api` (all ADR-001..004 behaviors).

### 3.7 ASD Friction
None remaining — the C-01 topology question was surfaced and resolved by the user (MFE topology confirmed, ADR-005 drafted). All other asks align with ASD §4 (C-01..C-08), §5, §6, §10.

## 4. Architecture Alignment

**ASD Mode: `ASD-anchored`** (structured ASD at `docs/asd/`).

### Mandatory Patterns
- **Spec-first, contracts before code** — §5.1, C-04: components render only contract-validated data; MSW mocks derive from `/specs`.
- **Shared types from `@sentinel/contracts`, zero duplication** — §5.2, §6.3.4, §8.3: every DTO/event type in all 3 MFEs is imported from the barrel; client-side validation compiles `/specs` schemas (D-WEB-4, ADR-007).
- **MFE federation topology** — C-01, §6.2: shell hosts; config + metrics are remotes; shell owns routing/navigation; remotes never route across each other directly.
- **Streaming-first UX** — §5.4: events render live; hook flushes every event immediately (no debounce/batching) to honor NFR-P1 end-to-end.
- **Testing Trophy** — §10: MSW integration tests around the SSE hook and dashboard; unit tests for pure logic (reducer, validation); E2E deferred to the dedicated Playwright suite (ASD §10.4, single suite).
- **Simplicity over premature scale** — §5.3: no global state library beyond TanStack Query + one streaming reducer; no router lib beyond React Router (already named by ARCHITECTURE.md §2).

### Technology Stack (ASD §6.2 / `docs/ARCHITECTURE.md` §2)
| Layer | Technology |
|---|---|
| Framework | React 18 + TypeScript (strict), Vite |
| Federation | `@originjs/vite-plugin-federation` (shell exposes layout; remotes expose `ConfigView` / `MetricsView`) |
| Routing | React Router (shell-owned) |
| Server state | TanStack Query (POST/GET caching & invalidation across MFE boundaries) |
| Forms | React Hook Form (+ resolver wired to contract validators, ADR-007) |
| Charts | Recharts (severity distribution, health score) |
| Streaming | Native `EventSource` behind `useAgentStream` custom hook |
| Testing | Vitest + React Testing Library + MSW (>80% coverage, §4.2/§10.3); Playwright E2E (1 suite, separate milestone) |
| Monorepo | pnpm Workspaces + Turborepo (`@sentinel/mfe-shell`, `@sentinel/mfe-config`, `@sentinel/mfe-metrics`, all depending on `@sentinel/contracts: "workspace:*"`) |

### Relevant Architecture Components (ASD §6.1/§6.2 + `docs/ARCHITECTURE.md` §2)
| Component | Placement |
|---|---|
| Host layout + routing + remote wiring | `apps/mfe-shell/src/` |
| Audit config form + launch | `apps/mfe-config/src/` (exposed as `./ConfigView`) |
| Live console + metrics + findings | `apps/mfe-metrics/src/` (exposed as `./MetricsView`) |
| SSE hook (shared concern of metrics) | `apps/mfe-metrics/src/hooks/useAgentStream.ts` — lives in the consuming MFE, **not** in contracts (UI-reactive state, §ADR-006) |
| Contract glue | `@sentinel/contracts` barrel + `mocks/handlers.ts` (MSW) + `serializeSseEvents` (mock/dev stream parity, backend ADR-001) |
| Shared API client base | `apps/mfe-shell/src/lib/apiClient.ts` (fetch wrapper honoring Problem Details) — re-exported to remotes via federation or thin per-remote copies (decision D-WEB-4) |

### NFR Constraints on This Feature
- **NFR-P1:** end-to-end SSE render latency < 500ms — hook renders per event immediately; no batching/debounce; no heavy sync work on the event path (list virtualization only if profiling demands it, MINOR).
- **NFR-A2:** client must preserve in-order rendering — dedupe by envelope `id`, sort by `id` within the audit; never re-order live events.
- **NFR-A3:** degradation is a **feature on screen**, not an error state (amber indicators; red only for terminal failure).
- **NFR-S2:** snippets shown in diffs are confidential source — render only what the contract already carries; no client-side telemetry/logging of snippet contents.
- **NFR-O1/O3:** one-command bootstrap (`turbo dev` runs 3 Vite dev servers + API); lint/typecheck/test gates for every MFE.

### Integration Points
| Integration | Direction | Contract |
|---|---|---|
| `mfe-config` → API | Outbound REST | `specs/openapi.yaml` POST /audits (201/400/413) |
| `mfe-shell` routing | Internal | `/` (config), `/audits/:auditId` (metrics) — mirrors ASD §6.1 sequence diagram |
| `mfe-metrics` → API | Inbound SSE | `GET /audits/{id}/stream` + `events-schema.json` (4 types, `retry: 5000`) |
| `mfe-metrics` → API | Outbound REST | `GET /audits/{id}` (200 Audit / 404 Problem) — reconciliation + Markdown export source |
| All MFEs → contracts | Import | `@sentinel/contracts` types + Ajv validators + MSW handlers (ADR-007) |

### Decisions Made in This Plan (ADR candidates)
| ID | Decision | Rationale |
|---|---|---|
| D-WEB-1 | MFE topology inside `apps/` (shell/config/metrics as separate workspaces) — **ADR-005** | User-confirmed strict C-01 honoring; supersedes earlier `apps/web` naming |
| D-WEB-2 | Dev ports: shell 5173, config 5174, metrics 5175; remotes also build standalone (federation + standalone modes) | Parallel team dev; E2E needs fixed ports |
| D-WEB-3 | Markdown report export generated client-side from the terminal `Audit` (GET) — no new backend endpoint | OpenAPI defines no export endpoint; §2.1 Module B lists export as frontend capability |
| D-WEB-4 | API client + Problem rendering implemented once in the shell and shared to remotes via a tiny `shared/` federation module (types-only alternative: duplicate the thin wrapper per remote) | DRY for Problem rendering; avoids remote→remote deps |
| D-WEB-5 | Streaming state lives in `mfe-metrics` (`useAgentStream` reducer), TanStack Query only for REST state | Streaming state is append-only/ordered — query caching semantics fit poorly (ADR-006) |
| D-WEB-6 | Client-side Ajv validation of inbound SSE events (defense in depth, dev-mode strict / prod log-and-skip) | Hub is validator of record server-side (ADR-003); client re-checks cheaply to fail loud in dev, never render garbage |

## 5. Technical Approach

### High-Level Strategy
Vertical slices: federation skeleton (US-1) → write path UX (US-2) → streaming substrate (US-3) → dashboard rendering (US-4) → terminal artifacts (US-5). Each slice ends green under turbo gates and runs against MSW mocks until wired to the real API.

### Key Components
| Component | Purpose |
|---|---|
| `apps/mfe-shell` | Host: layout, React Router (`/`, `/audits/:auditId`), federation host config, global notification bar, shared API client |
| `apps/mfe-config` | Remote: launch form (repo source XOR, rule sets, severity), client-side fail-fast validation, POST, redirect to `/audits/{auditId}` |
| `apps/mfe-metrics` | Remote: `useAgentStream` hook (EventSource + resync + dedup + terminal close), event feed, tool status, degradation indicators, findings diff viewer, health dashboard (Recharts), Markdown export |
| `packages/contracts` (consumed) | Types (`AuditConfig`, `Audit`, `Finding`, `Problem`, `SentinelAISSEEventContract`, 4 event types), MSW handlers, `serializeSseEvents`, seed fixtures |

### Data Model (client-side)
Derived view state per audit: `events[]` (ordered, deduped by `id`), `findings[]` (from `VULNERABILITY_FOUND`), `streamStatus` (`connecting | open | resyncing | closed`), `terminal` (`completed | failed | null`), `degradationCounters` (per-tool degraded/failed tallies). No persistence (§2.2 out of scope: dashboards persistence).

### API Changes
None — the backend is frozen; this plan only consumes it. Any contract gap discovered becomes a `/specs` change proposal, never a client-side workaround.

### External Dependencies
`react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`, `react-hook-form`, `recharts`, `@originjs/vite-plugin-federation` (all free — C-06); dev: `vitest`, `@testing-library/react`, `msw` (already in contracts), `jsdom`. Diff rendering: hand-rolled side-by-side `<pre>` panels (Before/After are separate fields, not unified diffs — no diff library needed, honoring $0/simplicity).

## 6. Detailed Task Breakdown — User Stories

Verification gate (applies to **every** story):
```
pnpm --filter @sentinel/mfe-shell lint && pnpm --filter @sentinel/mfe-shell typecheck && pnpm --filter @sentinel/mfe-shell test
# (same for mfe-config / mfe-metrics)
pnpm --filter @sentinel/contracts validate   # contract gate stays green (C-04)
```

---

### US-1 — MFE Scaffolding, Federation Wiring, Routing & Health/Smoke Tests  `(Phase 1 — Foundation)`

**Goal:** Three Vite React workspaces exist, federation host/remotes resolve at runtime, the shell routes between them, and all quality gates pass with smoke tests.

**Tasks:**
- **Task 1.1** — Scaffold `apps/mfe-shell`, `apps/mfe-config`, `apps/mfe-metrics`: `package.json` (`@sentinel/mfe-*`, scripts `dev`/`build`/`preview`/`lint`/`typecheck`/`test`), strict `tsconfig.json`, Vite config with `@originjs/vite-plugin-federation` (shell remotes: config@/remotes/config.js, metrics@/remotes/metrics.js; remotes expose `./ConfigView`, `./MetricsView`; shared singleton: react, react-dom, `@sentinel/contracts`). **Effort:** M · **AC:** US1-AC1, US1-AC2
- **Task 1.2** — Wire dev ports (D-WEB-2: 5173/5174/5175) and CORS for cross-MFE remote fetching in dev; register workspaces in `turbo.json` (`dev` runs all 3 + `apps/api` via `turbo run dev --parallel`). **Effort:** S · **AC:** US1-AC3
- **Task 1.3** — Host routing in `mfe-shell`: React Router with `/` → lazy `ConfigView`, `/audits/:auditId` → lazy `MetricsView`; fallback route → friendly not-found. **Effort:** S · **AC:** US1-AC4
- **Task 1.4** — Shared API client seam in the shell (`src/lib/apiClient.ts`): typed `fetch` wrapper reading `VITE_API_BASE_URL` (default `http://localhost:3000/api/v1`), parsing RFC 9457 Problems into a typed `ApiProblem` error. **Effort:** S · **AC:** US1-AC4
- **Task 1.5** — Smoke/health tests: each MFE mounts and renders its root; shell resolves both remotes in an integration test (Vitest + RTL); turbo lint/typecheck/test green for all 3. **Effort:** S · **AC:** US1-AC3, US1-AC4

**Acceptance Criteria:**
| # | Criterion | Maps to |
|---|---|---|
| US1-AC1 | `pnpm dev` boots shell (5173), config (5174), metrics (5175); shell renders both remotes via Module Federation without page reload | C-01, ASD §6.2 |
| US1-AC2 | All 3 workspaces depend on `@sentinel/contracts: workspace:*`; zero hand-written duplicate contract types | §5.2, §8.3 |
| US1-AC3 | `turbo run lint/typecheck/test` cover the 3 MFEs and pass | §9.2 |
| US1-AC4 | Smoke tests: shell routes render remote views; apiClient parses a mocked Problem payload | §10.3 |

**Edge cases addressed:** remote load failure (friendly fallback UI, not blank page). · **Depends on:** `@sentinel/contracts`, `@sentinel/api` (both done).

---

### US-2 — Audit Launch Form & Client-Side Fail-Fast Validation  `(Phase 2 — Core Logic — mfe-config)`

**Goal:** `mfe-config` renders the Audit Configuration form, validates client-side against the **same contract rules the backend enforces** (fail fast before any network call), launches the audit, and routes to the metrics view.

**Tasks:**
- **Task 2.1** — Contract-derived client validation (D-WEB-4 / ADR-007): compile the `AuditConfig` schema (from `/specs`, via the `@sentinel/contracts` validators export — same Ajv compile as backend `src/lib/validators.ts`) into a React Hook Form resolver: `repoUrl XOR localPath` oneOf, `format: uri`, `ruleSets` at least one `true` + no unknown keys, `severityThreshold` enum. **Effort:** M · **AC:** US2-AC2, US2-AC3
- **Task 2.2** — `LaunchAuditForm` component: repo source toggle (Git URL / local path) with exclusive fields, three rule-set checkboxes (OWASP Top 10 / Test Quality / Code Smells & Performance), severity threshold select (default LOW), submit disabled while in flight (no double-submit). **Effort:** M · **AC:** US2-AC1
- **Task 2.3** — POST integration via TanStack Query mutation + `apiClient`: on **201** `AuditCreated` → navigate `/audits/{auditId}`; on **400/413 Problem** → map `errors[]` to field-level inline messages (fallback banner for `detail`). **Effort:** M · **AC:** US2-AC4, US2-AC5
- **Task 2.4** — Tests (Vitest + RTL + MSW from `packages/contracts`): happy 201 → navigation asserted; each 400 class renders the matching inline error; 413 banner; submit disabled during flight; validation blocked before network (assert no fetch on invalid input). **Effort:** M · **AC:** all US2 ACs

**Acceptance Criteria:**
| # | Criterion | Mapping |
|---|---|---|
| US2-AC1 | Valid config → POST → 201 → user lands on `/audits/{auditId}` showing the live dashboard | openapi POST 201; ASD §6.1 flow |
| US2-AC2 | Invalid input (both/neither repo source, bad URI, zero rule sets, bad threshold) → **client-side** inline errors, no network request | §2.1 Module A; ADR-007 |
| US2-AC3 | Server-side rejection (400/413 Problem) renders field-level messages from `Problem.errors[]` (defense in depth — never silently swallowed) | openapi 400/413 → `$ref Problem` |
| US2-AC4 | Form is inert against double-submission while the mutation is pending | §3.2 concurrency |

**Edge cases addressed:** §3.2 inputs (all rows); unhappy path rows 1, 8. · **Depends on:** US-1.

---

### US-3 — Real-Time SSE Stream Hook & Resync Management  `(Phase 3 — Integration — mfe-metrics)`

**Goal:** `useAgentStream(auditId)` delivers ordered, deduplicated, contract-validated events with automatic resync on reconnect and clean terminal handling.

**Tasks:**
- **Task 3.1** — `useAgentStream` hook (native `EventSource`, D-WEB-1/ADR-006): connect `/api/v1/audits/{id}/stream`; parse `id:`/`event:`/`data:` frames via `onmessage` + `addEventListener` per type; maintain `lastEventId`; expose ordered `events[]` + `streamStatus` (`connecting | open | resyncing | closed | error`). **Effort:** L · **AC:** US3-AC1, US3-AC3
- **Task 3.2** — Dedup + ordering reducer: drop envelope ids already rendered; buffer-and-sort out-of-order arrivals (resync replay vs. live race); never re-order already-rendered live tail. **Effort:** M · **AC:** US3-AC2
- **Task 3.3** — Resync management: rely on browser-native `Last-Event-ID` replay on auto-reconnect (server `retry: 5000` hint); on manual/terminal-error reconnect, re-subscribe fresh (server replays from buffer start or resumes from cursor per backend ADR-001) and reconcile against `GET /audits/{id}` (findings so far) when a gap is detected. **Effort:** M · **AC:** US3-AC4
- **Task 3.4** — Client-side contract gate: every inbound `data:` payload validated against `events-schema.json` via the shared validators export (dev: throw loud; prod: discard + `console.error` + anomaly counter) — invalid frames are never rendered. **Effort:** S · **AC:** US3-AC5
- **Task 3.5** — Terminal semantics: on `AUDIT_COMPLETED` mark stream closed and **stop reconnection** (server closes anyway, D-API-6); on persistent connection error after bounded backoff → `error` status + retry affordance (no infinite loop). **Effort:** S · **AC:** US3-AC6
- **Task 3.6** — Tests (Vitest + RTL + MSW SSE streaming, ASD §10.3): in-order render; duplicate id dropped; out-of-order arrival sorted; reconnect with cursor resumes without dupes/gaps; invalid frame discarded in prod mode; terminal event ends the stream; degradation sequence (`failureSequence` fixture parity with backend stub) surfaces statuses. **Effort:** L · **AC:** all US3 ACs

**Acceptance Criteria:**
| # | Criterion | Mapping |
|---|---|---|
| US3-AC1 | Events render strictly in envelope-id order per audit, each within the 500ms budget of receipt (no batching) | NFR-P1, NFR-A2, D-6 |
| US3-AC2 | Duplicate envelope ids are dropped; a replayed event never renders twice | D-6 resync semantics |
| US3-AC3 | `streamStatus` reflects the connection lifecycle; UI can render connecting/reconnecting states | §2.1 Module B live console |
| US3-AC4 | Reconnect after drop resumes strictly after the last seen id (`Last-Event-ID`), reconciling any gap via `GET /audits/{id}` | openapi `LastEventId` param; backend ADR-001 |
| US3-AC5 | No schema-invalid payload is ever rendered; violations are logged + counted, never crash the UI | events-schema; ADR-003 parity |
| US3-AC6 | Terminal `AUDIT_COMPLETED` (either status) ends the stream; no reconnection storm after the server closes | D-API-6; NFR-A3 |

**Edge cases addressed:** §3.2 state transitions (all rows), reconnection, dedup. · **Depends on:** US-1. (Independent of US-2 — deep-linking to an audit id works.)

---

### US-4 — Live Audit Execution Dashboard  `(Phase 3 — Integration — mfe-metrics)`

**Goal:** Render the live stream as an observable agent timeline: thoughts, tool executions with statuses, findings-as-they-arrive, and visible LLM degradation indicators.

**Tasks:**
- **Task 4.1** — `EventTimeline` component: reverse-chronological feed of `AGENT_THOUGHT` (content + step badge) and `TOOL_EXECUTION` (tool name, status chip `started|succeeded|degraded|failed`, truncated `input`/`output`/`error`); virtualized only if profiling shows need (MINOR). **Effort:** M · **AC:** US4-AC1, US4-AC2
- **Task 4.2** — Degradation indicators (NFR-A3): amber `degraded` chip with tooltip from `payload.error`/`output` ("Falling back to …"); red `failed` chip; a session-level banner once any degradation occurred — degradations are **never** rendered as stream/transport errors. **Effort:** S · **AC:** US4-AC3
- **Task 4.3** — `FindingsFeed` (live section of US-5's viewer): append each `VULNERABILITY_FOUND` (severity badge, file/line) as it arrives; `AUDIT_COMPLETED` swaps the timeline into terminal state (spinner → final report, or failed banner with `error`). **Effort:** M · **AC:** US4-AC4
- **Task 4.4** — Reconciliation view: on mount or reconnect, hydrate from `GET /audits/{id}` (status, findings so far) so a mid-audit join or gap reconnect shows a coherent state (merge with hook events by id). **Effort:** M · **AC:** US4-AC5
- **Task 4.5** — Tests: fixture-driven render of full happy sequence + degradation sequence; assertion of chips/badges per status; terminal states (completed vs failed); reconnect mid-audit renders replay + live without dupes. **Effort:** M · **AC:** all US4 ACs

**Acceptance Criteria:**
| # | Criterion | Mapping |
|---|---|---|
| US4-AC1 | Every `AGENT_THOUGHT`/`TOOL_EXECUTION` event appears in the timeline as it is emitted | §2.1 Module B; §5.4 streaming-first |
| US4-AC2 | `TOOL_EXECUTION` statuses render as distinct chips; `input` payloads are shown sanitized (never raw credentials — backend already sanitizes, client renders as-is) | events-schema; NFR-S2 |
| US4-AC3 | LLM degradation (`degraded`) is visible and non-fatal; both-providers-down ends in a failed terminal state with the `error` detail — never a generic HTTP error screen | NFR-A3, ADR-002 |
| US4-AC4 | Findings appear live on arrival and persist in the view until terminal | §5.5 actionable output |
| US4-AC5 | Joining mid-audit (or reconnecting) yields a coherent view: prior findings present, no duplicated timeline entries | D-API-6 replay; US3-AC4 |

**Edge cases addressed:** §3.2 state transitions; unhappy paths 5–7. · **Depends on:** US-3.

---

### US-5 — Findings Viewer (Before/After Diffs) & Terminal Summary Metrics  `(Phase 4 — Polish & Validation — mfe-metrics)`

**Goal:** Post-terminal experience: side-by-side Before/After code diffs per finding, health dashboard (healthScore + severity distribution), and Markdown report export.

**Tasks:**
- **Task 5.1** — `FindingDetail` with side-by-side diffs: `beforeSnippet` / `afterSnippet` panels (monospace, line numbers, severity color), rule metadata (`ruleId`, `cweId`, description, filePath/lineNumber) from the `Finding` contract; copy-to-clipboard per panel. **Effort:** M · **AC:** US5-AC1
- **Task 5.2** — `HealthDashboard`: overall healthScore gauge (0–100 from terminal `AUDIT_COMPLETED` payload or `Audit.summary`), severity-distribution chart (Recharts bar/pie from `summary.findings` counters, falling back to client-side counting from `findings[]` when summary is absent mid-run). **Effort:** M · **AC:** US5-AC2
- **Task 5.3** — Markdown export (D-WEB-3): client-side generator from the terminal `Audit` (GET) + final event summary — headings, counters table, per-finding sections with Before/After code fences; download as `.md`. **Effort:** S · **AC:** US5-AC3
- **Task 5.4** — Failed-audit terminal view: error detail from `AUDIT_COMPLETED { status: 'failed' }` (or `Audit.summary`), guidance text, "launch a new audit" link back to config. **Effort:** S · **AC:** US5-AC4
- **Task 5.5** — Tests: rendered diff panels assert snippet content + severity styling; dashboard counters match fixture summaries; exported Markdown contains counters + findings (string snapshot); failed audit renders error state. **Effort:** M · **AC:** all US5 ACs

**Acceptance Criteria:**
| # | Criterion | Mapping |
|---|---|---|
| US5-AC1 | Each finding renders side-by-side Before/After snippets with location/severity/rule metadata — actionable output, no noise | §5.5, §2.1 Module B Refactoring Drawer |
| US5-AC2 | Terminal `completed` audit shows healthScore (0–100) + severity counters consistent with `summary` (or computed from findings when absent) | `AUDIT_COMPLETED` payload; openapi `Audit.summary` |
| US5-AC3 | Markdown export downloads a report containing counters and all findings with Before/After snippets | §2.1 Module B report export (client-side, D-WEB-3) |
| US5-AC4 | Terminal `failed` audit renders the failure reason; UI never implies a transport error | NFR-A3; backend ADR-002 |

**Edge cases addressed:** unhappy paths 6–7; terminal rendering. · **Depends on:** US-3 (uses the same hook/reconciliation), US-2 (for the "new audit" return path).

## 7. Implementation Sequence

- **Phase 1 — Foundation:** US-1 (3 workspaces + federation + routing + smoke)
- **Phase 2 — Core Logic:** US-2 (launch form + contract-derived validation), US-3 (SSE hook — parallelizable with US-2; independent seams)
- **Phase 3 — Integration:** US-4 (dashboard over the hook), then US-5 (terminal views + export) on top
- **Phase 4 — Polish & Validation:** coverage hardening (>80%), README per workspace, joint run with real `@sentinel/api` (E2E suite itself is the *next* milestone per ASD §10.4)

Estimated total: ~7–9 developer-days (US-3 is the critical path).

## 8. Definition of Done

**Project Quality Gates (ASD-anchored):**
- [ ] Contract gate stays green — `pnpm --filter @sentinel/contracts validate` (C-04, §9.3); contracts consumed, never modified
- [ ] `turbo run lint` zero ESLint errors across the 3 MFEs (§9.2)
- [ ] `turbo run typecheck` zero `tsc --noEmit` errors (§9.2)
- [ ] Coverage > 80% on hooks/utils/components per MFE (Vitest + RTL, §10.3; C §4.2)
- [ ] Required test types present — unit (reducer, validation resolver, markdown generator) + integration (RTL against MSW REST/SSE from `packages/contracts`) (§10.2/§10.3)
- [ ] Architecture principles followed — MFE topology (C-01), spec-first (§5.1), contracts-only types (§5.2/§8.3), streaming-first UX (§5.4), no deviations from §5
- [ ] NFRs validated in-browser: render latency < 500ms per event (P1), in-order + dedup + resync (A2 + D-6), degradation-as-feature (A3), no-auth (S1), confidential snippets not logged (S2)

**Standard Checklist:**
- [ ] All US-1..US-5 acceptance criteria validated by tests
- [ ] All §3.2 edge cases handled and tested; §3.3 unhappy paths have defined UI behavior
- [ ] Assumptions A-1..A-6 resolved (ADR-005..007 drafted — included in this delivery)
- [ ] No hand-written duplicate of any `@sentinel/contracts` type (grep-verified)
- [ ] Every MFE runs standalone (`vite dev`) AND federated under the shell (both modes documented)
- [ ] Unit + integration tests passing; no critical/high bugs
- [ ] READMEs: run instructions, port map, env (`VITE_API_BASE_URL`)

## 9. Risks & Considerations

- **Technical risks:** `@originjs/vite-plugin-federation` shared-singleton pitfalls (duplicate React copies → hooks break); mitigated by strict shared-singleton config + a federation smoke test in US-1. `EventSource` cross-origin needs explicit CORS on the API dev server (backend already plain Express — may need `cors` allowlist for 5173–5175; flagged as an `apps/api` follow-up, not a frontend workaround).
- **Dependencies:** none blocking — backend shipped; contracts green; MSW handlers exist.
- **Performance:** the hook must not re-render the whole timeline per event; recommend keyed list + stable row components; measure before optimizing (NFR-P1).
- **Security:** snippets are confidential (NFR-S2) — no third-party error tracking on event payloads; Markdown export stays client-side (no new data flows); no-auth (S1).
- **Migration/backward compatibility:** greenfield; the earlier `apps/web` naming is superseded (see §3.5) — no migration needed.

## 10. Open Questions

| # | Question | Owner | Blocking? |
|---|---|---|---|
| Q-1 | Promote client-side Ajv validators via the `@sentinel/contracts` validators export (ADR-007) vs. per-MFE local compile from `/specs`? | Contracts owner | No (ADR-007 drafted with the export as the decision) |
| Q-2 | CORS allowlist for dev ports 5173–5175 on `@sentinel/api` (needed for live federation runs) | Backend | Only for live integration, not for MSW-based development |
| Q-3 | Charts library scope — Recharts confirmed by ARCHITECTURE.md §2; confirm no lighter alternative is preferred | Lead Dev | No |

## 11. ASD Friction & ADR Candidates

- **C-01 vs. the original "apps/web" work item:** flagged, sanity-checked, and resolved by the user — **strict C-01 honored** (shell + 2 remotes). Recorded as plan decision D-WEB-1 and formalized in **ADR-005**. No unresolved friction remains.
- Gaps the ASD is silent on (dev ports, client-side validation reuse, client-side Markdown export) are tracked as D-WEB-2..6 in Section 4, not friction.

## 12. Contracts Consumption Reference (normative for the MFEs)

```ts
// Types — compile-time only, from the contracts barrel (packages/contracts/src/index.ts):
import type {
  AuditConfig, Audit, AuditCreated, Finding, Problem, Severity, AuditStatus,
  SentinelAISSEEventContract, AgentThoughtEvent, ToolExecutionEvent,
  VulnerabilityFoundEvent, AuditCompletedEvent,
} from '@sentinel/contracts';

// Runtime validation (ADR-007): Ajv compiled from /specs via the shared validators
// export — used at:
//  1. Launch form resolver   → AuditConfig JSON Schema   → inline field errors (US-2)
//  2. Inbound SSE gate       → events-schema.json oneOf  → invalid frames never render (US-3)

// Endpoints consumed (specs/openapi.yaml, implemented by @sentinel/api):
//  POST /api/v1/audits                → 201 AuditCreated | 400/413 Problem
//  GET  /api/v1/audits/{auditId}      → 200 Audit | 404 Problem
//  GET  /api/v1/audits/{auditId}/stream → 200 text/event-stream (retry: 5000,
//     id: = envelope id per D-6, replay for late joiners, close after AUDIT_COMPLETED)
```
