# Implementation Plan — P2: MVP Completion and Contract Alignment

> Work item: Complete the remaining MVP deliverables and reconcile implementation, API contracts, architecture documentation, and ADRs with the shipped code.
> Prepared: 2026-11-12 · Baseline: P0 security boundaries and P1 main-flow reliability are complete.
> Scope: P2 implementation and documentation alignment. This plan does not change the P0 security boundaries, add persistence, or expand the product beyond the local PoC.

## 1. Goal and Decisions

Complete the user-visible MVP gaps and make the root quality gates and technical documentation accurately describe the running system. The following decisions define the implementation:

1. **Markdown export is client-side** and uses the terminal audit snapshot. It adds no API endpoint or server-side persistence.
2. **Implement the severity-distribution chart** required by the functional overview, alongside the existing counters and health score. Use Recharts in `mfe-metrics`; do not add TanStack Query or React Hook Form merely to match stale architecture prose.
3. **Add a full-flow Playwright suite** for configuration → shell navigation → live metrics, using deterministic test data and the local API rather than a real LLM or external repository.
4. **Make contracts validation a root quality gate.** Expose it through Turborepo and a root command so the same validation is runnable consistently from the repository root and CI.
5. **Keep the development processes separate.** `pnpm dev` continues to start the MFEs only; the API keeps its own command/process. Document this consistently rather than adding a second stack orchestrator.
6. **Include `/api/v1/health` in OpenAPI as an explicitly internal operation.** This makes the implemented route discoverable and typed without presenting it as a user-facing audit operation.
7. **Treat `AGENT_THOUGHT` as progress/status content, not model reasoning.** Preserve the event type and payload contract; correct descriptions and UI/documentation language.
8. **“Apply Fix” remains out of scope.** Findings provide suggested Before/After snippets for the user to apply manually outside Sentinel. No file mutation, patch application, PR, or commit operation is added.
9. **Update ADRs and plans to describe the implementation.** Keep runtime validators where they currently live unless a separate implementation requirement warrants a shared-validator refactor; ADR-007 must not claim that MFEs consume a shared Ajv export that does not exist.

## 2. Baseline and Risks

| Area | Observed state |
| --- | --- |
| Final report | The MFE implementation has audit findings and a terminal summary, but no Markdown download flow. Client-side export is already the planned design in the MFE plan. |
| Health dashboard | `mfe-metrics` displays the health score and severity counters. The functional overview requires an interactive severity-distribution chart; no chart implementation or Recharts dependency is present. |
| E2E | Playwright is installed and the P1 SSE latency test exists. There is no suite that launches an audit through the configuration form and verifies the federated metrics view. |
| Contract validation | `@sentinel/contracts` exposes `pnpm --filter @sentinel/contracts validate`. `turbo.json` has no `validate` task and the root has no validation command. |
| Development startup | Root `pnpm dev` orchestrates the three MFEs; `apps/api` has its own `dev` script. The README already documents separate terminals. |
| Health route | `GET /api/v1/health` is implemented in `apps/api/src/routes/api-v1.ts` and described in code as internal, but is absent from `specs/openapi.yaml`. |
| Frontend dependencies | Config and metrics use React and the shared contracts package; TanStack Query, React Hook Form, and Recharts are not dependencies. The form has local validation in `apps/mfe-config/src/lib/auditForm.ts`; the metrics stream uses `useAuditStream`. |
| ADR-007 | The shared barrel exports generated types and the API client, not Ajv validators. Server-side Ajv validators are in `apps/api/src/lib/validators.ts`; client form validation is local. |
| ADR-005/006 and MFE plan | Some code-location tables and state descriptions still refer to planned files, names, libraries, or work that has since changed. |
| Architecture and functional scope | `docs/ARCHITECTURE.md` describes `controllers/` although the API groups handlers in `apps/api/src/routes/`. The functional overview requires manual suggestions, while some older MFE-plan language can imply an in-product remediation action. |
| Event semantics | `AGENT_THOUGHT` currently feeds the progress timeline. Some ASD language calls these events the agent’s “reasoning,” which could imply exposure of internal model reasoning. |

The full-flow test must avoid nondeterministic LLM behavior and must not weaken the local-only API, repository allowlist, or provider-egress controls established in P0.

## 3. Phases and Dependencies

| Order | Deliverable | Dependencies |
| --- | --- | --- |
| 0 | Confirm baseline commands, current user-visible behavior, and test fixtures | None |
| 1 | Markdown export and severity chart | Phase 0 |
| 2 | OpenAPI health operation and Turborepo contracts gate | Phase 0; independent of phase 1 |
| 3 | Playwright config → shell → metrics suite | Phases 1 and 2; deterministic API test setup |
| 4 | Architecture, ADR, functional-scope, development, and MFE-plan reconciliation | Phases 1–3 for implementation status; may begin with independent factual corrections |
| 5 | Final root quality gate and evidence | Phases 1–4 |

Phases 1 and 2 may proceed in parallel. P2 is not complete until the full-flow test and root validation command pass, and the documentation reflects the final implementation rather than this plan’s assumptions.

## 4. Stories, Tasks, and Acceptance Criteria

### 4.1 Terminal Markdown Export

- Add a client-side report generator in `mfe-metrics` using the terminal `Audit` snapshot as the authoritative source. Do not introduce a backend export route.
- Include audit identity/status, terminal health score when available, severity totals, and every finding with location/rule/severity and Before/After snippets.
- Provide a download action only when the report is available. Generate a predictable `.md` filename from a safe audit identifier; do not make a network request or persist the report on the server.
- Cover empty findings, absent optional summary data, failed terminal audits, Markdown-sensitive text, and snippets containing code fences.

**Acceptance criteria:**

- A completed audit can be downloaded as a Markdown report containing all findings and available summary data.
- Missing optional fields do not produce misleading values or crash the view; failed audits are clearly identified.
- Tests verify report content and that the download action uses the generated Markdown without invoking a new API operation.
- Export remains local to the browser and does not change repository files or create a patch.

### 4.2 Severity Distribution Chart

- Add Recharts to `apps/mfe-metrics` and render the four contract severities in a chart using the same finding source/order as the summary counters.
- Keep the counters and health score; the chart supplements rather than replaces the existing summary.
- Provide a text alternative or equivalent accessible labels so exact counts and severity names are available without relying on color or chart interaction.
- Handle zero findings and missing/partial event data without inventing counts.

**Acceptance criteria:**

- The terminal dashboard displays a severity distribution chart whose values match the finding list and counters for `LOW`, `MEDIUM`, `HIGH`, and `CRITICAL`.
- Severity remains distinguishable without color alone, and chart labels/counts are available to assistive technology.
- Unit/component tests cover all-zero, single-severity, and mixed-severity distributions.
- Recharts is declared only where used; TanStack Query and React Hook Form are not added as part of this work.

### 4.3 Root Contract-Validation Gate and Health Contract

- Add a Turborepo `validate` task and a root `pnpm validate` command that runs the contracts package validator. Make this command part of the documented root verification/release gate.
- Add `GET /api/v1/health` to `specs/openapi.yaml`, mark it as internal (for example, with an `x-internal: true` operation extension), and define its current `200` response shape `{ "status": "ok" }`.
- Regenerate the API types and update contract-validation tests/fixtures as required. Keep the route response and OpenAPI shape aligned.
- Preserve the current separation between the health smoke operation and audit lifecycle operations; do not add health checks for providers or external systems unless separately required.

**Acceptance criteria:**

- `pnpm validate` runs the contracts validation through Turborepo from the repository root and exits non-zero on invalid specs or fixtures.
- The root verification instructions identify `pnpm validate` as a required gate.
- OpenAPI includes the internal health operation with its actual path, method, and response; generated types are current.
- API tests and contract checks verify that the implemented health response conforms to the documented shape.

### 4.4 Full-Flow Playwright Suite

- Add a deterministic Playwright suite for the real browser path: open the shell, submit the config form, navigate to the audit route, and observe metrics from the local API stream.
- Reuse the repository’s existing Playwright installation and test conventions. Use synthetic repository/audit content and a controlled runner or test server; do not call Ollama, a remote LLM, or public repositories.
- Make the test setup own and clean up its API/frontend processes. Keep any deterministic controls test-only; do not expose production control routes.
- Assert meaningful rendered behavior: configuration validation or successful submission, shell route transition, stream progress/finding or terminal state, and summary/chart rendering. Keep the existing latency test separate.

**Acceptance criteria:**

- A documented command runs the new Playwright suite from the root without manually starting services.
- The test completes the config → shell → metrics flow against the real browser and local API, with deterministic results and no external network dependency.
- It verifies at least one finding, the terminal summary, and matching severity presentation in counters/chart.
- Failure output identifies which process or user-visible step failed; setup errors are not converted into a passing or skipped test.
- The existing P1 SSE latency test and Vitest suites remain unaffected.

### 4.5 Documentation, ADRs, and Plan Status

- **Architecture and dependency truth:** update `docs/ARCHITECTURE.md` and relevant ASD sections to show Recharts for metrics, remove unimplemented TanStack Query/React Hook Form claims, and describe actual state/fetch/validation approaches. Replace backend `controllers/` references with the `apps/api/src/routes/` organization and actual handler responsibilities.
- **ADR-005:** replace planned code-location claims with current Vite federation files, remote exports, shell routing, and development startup behavior; retain the topology decision.
- **ADR-006:** correct the implemented hook name/location (`apps/mfe-metrics/src/hooks/useAuditStream.ts`), reconciliation/state ownership, actual API client usage, and remove claims that TanStack Query is used if it is not. Keep protocol decisions that remain accurate.
- **ADR-007:** retain shared generated contract types and the prohibition on duplicate contract shapes, but document actual runtime validation boundaries: contracts validation script, API Ajv validators, form validation, and client-side SSE shape checks. Do not claim shared validators are exported or consumed by the MFEs.
- **`implementation-plan-mfe.md`:** reconcile every task/story status against code and test evidence. Mark completed work only when its acceptance criteria are met; identify Markdown export, chart, and full-flow E2E as P2 work until proven complete.
- **Remediation scope:** state consistently that `After` is a recommendation for manual application outside the product. No “Apply Fix” control, file mutation, patch download, PR creation, or commit is in scope.
- **`AGENT_THOUGHT`:** describe it as a progress/status event (such as current step), not chain-of-thought or private model reasoning. Preserve contract compatibility and correct user-facing labels/documentation.
- **Development startup:** keep `pnpm dev` as the frontend MFE workflow and the API as a separate process. Ensure README, ASD DevOps instructions, and relevant ADR/plan text all say which commands start which services.
- Update contract/architecture/testing documentation to include the new export, chart, health operation, root validation command, and Playwright suite.

**Acceptance criteria:**

- The affected architecture, ASD, ADR, and plan documents agree with one another and with the verified source locations and package manifests.
- No documentation suggests Sentinel applies fixes or exposes internal model reasoning.
- The MFE plan distinguishes implemented work from work still open at the end of P2.
- Development instructions unambiguously state how to start the API and frontends, including that `pnpm dev` does not start the API.

## 5. Definition of Done

- Markdown export and the severity chart work for completed audits and have focused tests.
- `GET /api/v1/health` is represented in OpenAPI as internal and matches the implementation.
- Contracts validation is callable and required from the root through Turborepo.
- The new deterministic Playwright suite passes for the complete config → shell → metrics flow.
- Relevant lint, typecheck, unit/integration tests, build, contract validation, and the existing P1 latency test pass.
- ADR-005, ADR-006, ADR-007, `implementation-plan-mfe.md`, architecture/ASD docs, and development instructions are reconciled with implementation evidence.
- P0 security boundaries and P1 flow reliability behavior are preserved; no backend remediation, persistence, authentication, or external LLM behavior is introduced.

## 6. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Export can diverge from the final UI if built from the transient event list | Generate it from the terminal `Audit` snapshot; test parity for every finding and summary field. |
| Chart colors or layout hide severity information | Use explicit labels/counts and an accessible text alternative; test semantic values, not pixels alone. |
| Full-flow test becomes flaky due to asynchronous federation startup or SSE timing | Use deterministic test data, readiness checks, bounded timeouts, and explicit process cleanup; do not use arbitrary sleeps as synchronization. |
| Root validation adds unexpected work to unrelated commands | Keep the Turborepo task scoped to `@sentinel/contracts`; document the root command and invoke it as an explicit required gate. |
| Documentation updates accidentally revive rejected remediation or reasoning exposure | Treat the P1 decision and current event semantics as normative; review all affected copy for these terms before closing P2. |

## 7. Out of Scope

- Automatically applying suggested code, modifying audited repositories, creating patches, pull requests, or commits.
- New API endpoints for Markdown export or persistent report storage.
- Audit-history persistence, multi-user access, authentication, remote/shared deployment, or broader API exposure.
- Replacing the implemented client state/validation approach with TanStack Query, React Hook Form, or a shared Ajv runtime package solely to match historical documentation.
- Real-provider or public-repository dependencies in Playwright tests.
