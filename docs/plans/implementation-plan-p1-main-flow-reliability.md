# Implementation Plan — P1: Main Flow Reliability

> Prepared: 2026-11-11. Scope: planning; this document does not implement or demonstrate the changes or results described.
> Baseline: P0 and ADR-008 remain in effect; persistence and replay are limited to the lifetime of the server process.

## 1. Goal and Decisions

Ensure that an audit uses a verifiable LLM provider, honestly describes its scope, presents consistent results after connection loss, and has reproducible quality gates. The following functional decisions were confirmed for P1:

1. The three categories are **LLM-assisted review focuses**, not specialized rule engines. Test coverage is not measured, and OWASP scanners, benchmarks, or dedicated analyzers are not run. No claim of completeness or compliance is made.
2. **Fixes are not applied automatically**. Before/After snippets remain as suggestions for review and manual application. The UI must not offer an action that calls a nonexistent API. This applies to both local and remote repositories: no files are modified, no downloadable diff is generated, and the temporary clone is not retained for remediation. A future implementation requires a separate decision and design.

No persistence, authentication, multiuser deployment, or changes to the P0 security boundaries are introduced. Audited content remains confidential; local Ollama is the default, external access requires operator opt-in, and sanitization fails closed.

## 2. Baseline and Risks

| Area | Observed state, not an execution validation |
| --- | --- |
| LLM | `apps/api/src/agent/llm.ts` uses Ollama `llama3.2` and `/api/generate`; the generic remote adapter expects `{model, prompt}` and `{text}`, without demonstrated compatibility with a real service. The parser requires finding fields even for `{"finding":null}`, which is the response requested by the prompt. |
| Rules | `runner.ts` passes the selected names to the prompt; it does not measure coverage or run category-specific tools. Reading is limited to 200 files, 64 KiB per file, and snippets truncated to 2000 characters; omissions must be visible. |
| Fix | OpenAPI and the metrics client advertise remediation, but `api-v1.ts` does not register that route. The remote clone is deleted after reading. |
| SSE | The hook uses `JSON.parse` and a cast, appends without deduplication, and does not query the REST snapshot. The hub limits the buffer to 1000 events; its current cursor treats an ID as a buffer index and becomes incorrect after eviction. |
| Snapshot | `GET /audits/:id` contains status and findings, but no event watermark; the current state does not explicitly retain all terminal data needed to reconstruct the header if the terminal event is lost. |
| Gates | The four `apps` workspaces configure thresholds of 80 and their test scripts run coverage; `packages/contracts` runs Vitest without coverage. This planning exercise has not verified actual coverage or that the gate requires **strictly greater** than 80%. The latency KPI has not been demonstrated. |
| Tests | The `App.test.tsx` failure due to missing `EventSource` and an unexpected worker exit were reported by the previous analysis, not reproduced during this planning exercise. |

Normative references: `docs/asd/03-nfr.md`, `docs/asd/08-data-architecture.md`, `docs/asd/10-testing.md`, `docs/adr/ADR-001-sse-framing-and-pre-header-404.md`, `docs/adr/ADR-006-frontend-state-management-and-sse-resync.md`, and `docs/adr/ADR-008-local-only-repository-and-llm-boundaries.md`. Replay decisions that contradict the corrected implementation must be explicitly updated.

## 3. Phases and Dependencies

| Order | Deliverable | Dependencies |
| --- | --- | --- |
| 0 | Baseline and shell test repair | None |
| 1 | LLM provider and honest category scope | P0; phase 0 for the regression gate |
| 2 | Consistent removal of Apply Fix | Section 1 decision; independent of phase 1 |
| 3 | Snapshot/replay contract and hub correction | Section 4.4 design |
| 4 | Client validation, ordering, and reconciliation | Phase 3; contract fixtures and types |
| 5 | Coverage, latency, and documentation closeout | Phases 0–4 for the final gate |

Phases 1 and 2 can proceed in parallel with phase 3; P1 must not be closed while a gate is blocked or lacks evidence.

## 4. Stories, Tasks, and Acceptance Criteria

### 4.1 Baseline and Shell Test

- First run `pnpm test` and record the command, Node version, result per workspace, and complete worker failure output. Isolate the shell test and reproduce both individually and in parallel before attributing a cause to the worker failure.
- Reuse or adapt the controllable `EventSource` mock in `apps/mfe-metrics/tests/mocks/eventSource.ts` in the shell setup; clean up instances and handlers between tests. Add the REST mock needed for reconciliation without replacing the routing behavior under test.
- Investigate the worker exit with reproducible results and fix its cause. Reduce concurrency only if a resource limit is identified and documented; do not hide failures or discard tests.

**Acceptance:** the `/audits/:auditId` route actually mounts metrics in jsdom, its isolated tests pass repeatedly, and `pnpm test` passes with the documented concurrency configuration and no worker crashes. If the failure cannot be reproduced, record the evidence and retain it as a risk rather than claiming the cause is resolved.

**Phase 0 evidence (2026-11-11):** On Node `v24.22.1` and pnpm `9.12.0`, `pnpm run test --force` initially failed in the shell with `EventSource is not defined`; contracts (15 tests), API (118), metrics (46), and config (7) passed. The shell's isolated `App.test.tsx` reproduced the same failure. After installing the existing metrics EventSource mock in the shell test setup, the isolated route tests passed three consecutive runs, and `pnpm run test --force` passed all five workspaces without cache using the existing concurrency configuration (shell: 11 tests). Shell lint and typecheck also passed. No worker crash occurred in these runs; its previously reported cause remains unknown and is retained as a risk. These results do not establish the strict coverage gate or latency target in phases 4.6–4.7.

### 4.2 LLM Provider and Rule Semantics

- Define **local Ollama** as the minimum operational provider: endpoint, Ollama version, installed model, and reproducible configuration, including configurable model selection if necessary. The real test must use synthetic code, not confidential code. Document installation, startup, diagnostics, and availability limits; an automated protocol test does not replace a real smoke test.
- Test the actual `/api/generate` HTTP format (`model`, `prompt`, `stream: false`, `response` field), timeouts, and invalid responses. Explicitly accept both a valid finding and `{"finding":null}`; verify the severity threshold, shape, inspected file location, and rejection of invalid data. Do not turn provider errors into an absence of findings.
- Keep local-only as the default. If a remote provider is enabled, choose and document a real protocol and its credentials in server configuration, test requests/responses with fixtures, and run a real smoke test only with opt-in and authorized access. If no remote provider is verified, do not present one as functional: minimum P1 closure requires real Ollama and automated chain tests; real remote verification remains explicitly blocked until an authorized provider and credentials are available.
- Test an enabled primary succeeding, 429/error/timeout with Ollama fallback, both providers unavailable, and failed sanitization; failed sanitization must not invoke another provider with unsafe content. Verify `degraded`/`failed` events and the corresponding terminal event, with no secrets in requests, events, or logs.
- Define the focuses in the prompt and UX: `owaspTop10` looks for indications of common vulnerabilities; `testQuality` qualitatively reviews available test code, without percentages or execution; `codeSmellsPerformance` looks for indications of smells and potential issues, without measuring performance. Existing identifiers may remain for compatibility, but their descriptions, examples, and messages must not promise nonexistent tools or metrics.
- Identify omitted or truncated files and snippets, reading limits, findings subject to false positives/negatives, and the absence of a coverage guarantee; include these limitations in configuration/results and documentation. Do not present an incomplete audit as evidence that no problems exist.

**Acceptance:** a synthetic repository is audited end to end using real Ollama and an identified model, including a no-finding case; deterministic tests cover the HTTP contract, errors, and fallback without external network access. The UI and documentation make clear what each category does and does not do. The result of any real remote check is reported separately, without simulating success.

**Phase 1 evidence (2026-11-11):** Ollama model selection, no-finding parsing, file identity checks, category descriptions, omission warnings, and deterministic protocol/fallback tests have been implemented. `pnpm run test --force` passed all five workspaces (207 tests), as did `pnpm lint`, `pnpm typecheck`, `pnpm build`, and contract validation. With operator approval, Ollama `0.40.16` and `llama3.2:latest` (`a80c4f17acd5`) were installed and tested locally. A synthetic repository containing only `export function add(a: number, b: number): number { return a + b; }` was audited with `owaspTop10: true` and `severityThreshold: LOW`: the real Ollama adapter returned no findings; SSE reached `AUDIT_COMPLETED` and GET reported `completed`, zero findings, and one analyzed file. The temporary API and Ollama processes were stopped afterward. This is a local smoke result, not a guarantee of model accuracy. The experimental remote adapter has not been validated against a real provider.

To reproduce, start Ollama and the API as described in the README, configure `SENTINEL_ALLOWED_REPO_ROOTS` to include a directory containing only the synthetic file, and submit that directory as `localPath` with the above focus and threshold to `POST /api/v1/audits`. Follow the returned audit's `/stream` and confirm its final state with `GET /api/v1/audits/{auditId}`.

### 4.3 Removal of Automatic Remediation

- Explicitly remove or disable the button and all remediation calls in `FindingCard.tsx`, `FindingsList.tsx`, and their client; show that After is a suggestion requiring review and manual application.
- Align `specs/openapi.yaml`: remove the unimplemented operation and exclusively associated schemas when unnecessary; regenerate types and update affected mocks, fixtures, and tests. Review references in the README, ASD, and active plans so they do not advertise automatic application. Preserve the findings and Before/After contract.
- Preserve temporary clone cleanup and P0 path restrictions. Do not create a replacement endpoint that appears to succeed or send snippets or paths to a disk-writing operation.

**Acceptance:** no UI interaction calls remediation, the published specification does not promise the operation, and the suggestion remains visible. Tests cover a local and a remote finding, absence of the button/call, Before/After rendering, and no files being written. Future application, including safeguards against conflicts and symlinks, is outside P1.

**Phase 2 evidence (2026-11-11):** Removed the Apply Fix UI, client and its tests, OpenAPI operation, and remediation-only schemas/types. Finding cards now label After as a manual suggestion and state that repository files are not modified; README, project brief, ASD, event schema, and contract descriptions were aligned. Metrics tests verify Before/After display and no action or network call for local/remote findings; the code path has no file-writing operation. OpenAPI types were regenerated; contract validation passed. All 34 metrics tests passed with coverage of 98.89% statements/lines, 94.66% branches, and 100% functions. Metrics lint, typecheck, and production build passed. No Apply Fix endpoint or client reference remains; the only negative mentions are assertions verifying the control is absent.

### 4.4 Replay Contract and Consistent Snapshot

- Correct the hub to select events by `event.id > Last-Event-ID`, never by index or current size; test with more than 1000 emissions and cursors before the buffer, within the buffer, at the last event, and beyond it. The ID remains monotonic per audit, including after eviction and validation failure.
- Replay from a cursor older than the first retained event begins with the first available event, without pretending continuity. Explicitly expose the unavailable range; if no later event allows the gap to be detected, use replay/snapshot metadata to detect it as well. Evicted historical events are not reconstructed.
- Extend the REST contract in a coordinated way with a snapshot `lastEventId` watermark consistent with findings, status, and terminal data. `0` represents an audit with no events. Store event IDs for findings and the necessary terminal data—including score/error when present—or define an equivalent unambiguous representation in the contract; a `ruleId + filePath + lineNumber` locator does not guarantee uniqueness.
- Snapshot and watermark updates must be atomic from the perspective of GET and SSE delivery: do not publish a watermark before incorporating its effects. Explicitly define statuses and optional fields in OpenAPI, regenerate types, and validate fixtures. Preserve in-memory limits and session loss after restart.
- Update ADR-001/004/006 and affected documentation if replay semantics or the REST shape change; do not claim history recovery when only state is recovered.

**Acceptance:** API integration tests cover a snapshot during emission, more than 1000 events, potential duplicates, completed/failed terminal events, an expired cursor, a cursor ahead of the buffer, and no events. The snapshot and watermark represent the same point in time; GET retains recoverable state and results even if the terminal event has left the buffer. Gap detection does not rely exclusively on another event arriving.

**Phase 3 evidence:** The OpenAPI `Audit` contract now requires `lastEventId` and nullable `firstAvailableEventId`; snapshot findings include their originating `eventId`. The hub assigns IDs from the snapshot watermark, filters replay by actual event IDs, and synchronously records each validated event, replay boundary, finding, lifecycle transition, and terminal score/error before fan-out. A >1000-event test verifies eviction, retained and expired cursors, the final and ahead-of-stream cursors, monotonic replay IDs, and a REST snapshot that retains a finding whose event was evicted plus terminal summary data. Failure-path assertions verify terminal error reconciliation; empty snapshots and no-event metadata are also covered. ADR-001/003/004/006 and ASD data architecture were aligned. API tests: 129 passed; API coverage: 93.09% statements/lines, 87.36% branches, and 99.07% functions. Contracts: validation gate green and 15 tests passed. API/contracts lint and typechecks passed.

### 4.5 Client Validation, Identity, Reconnection, and Reconciliation

- Reuse or extract a browser-compatible runtime validator from the contract, compiled once; generated types and the CLI validation script alone do not validate data at runtime. Reject invalid JSON, invalid payloads, non-integer/non-positive IDs, mismatched `auditId`, `event.type` that differs from the SSE event name, and `MessageEvent.lastEventId` that differs from the envelope ID. Log anomalies without exposing confidential payloads.
- Maintain a per-audit reducer with ID deduplication, ascending order, and gap detection; do not render duplicates or an invalid terminal event. Distinguish duplicate replay from the same ID with conflicting content and log the latter as an anomaly. Avoid mixing late responses or streams when changing audits or unmounting.
- On entry, query GET to distinguish a 404 from a recoverable failure; a 404 shows “audit not found” and does not open or retry SSE. Since `EventSource.onerror` does not expose the HTTP status and a restart may occur between GET and connection, repeat GET on errors/reconnections: 404 closes the stream and is terminal; network/5xx errors are recoverable and visible. Cancel stale requests and retries.
- Connect/reconnect and query the snapshot using the watermark so that a late REST response does not overwrite later events: combine the snapshot through its watermark with subsequent valid events, deduplicating by ID; do not deduplicate findings by text or locator. Reconcile on entry, reconnection, and gaps or discarded frames. Also cover the race between GET, stream opening, and the terminal event.
- Warn when there is an unrecoverable timeline gap; recover findings, status, and terminal data from GET without inventing historical events. Close EventSource upon a recovered terminal status or valid terminal event. Define behavior for a failed snapshot without claiming full synchronization.
- Account for the browser potentially advancing its native cursor even for a rejected frame: reconciliation and warnings must still work in that case, without relying solely on the last accepted event.

**Acceptance:** hook and view tests cover all four event variants, malformed formats, type/ID/auditId inconsistencies, duplicates, out-of-order events, gaps, buffer loss, invalid frames, stale snapshots, concurrent reconnection, route changes, initial GET 404 and 404 after restart, transient errors, and terminal events. Findings/counters/terminal state are shown once and incomplete history is reported. Preserve API tests for 404 before SSE headers.

**Phase 4 iteration evidence:** `useAuditStream` now validates JSON envelopes at runtime before rendering, including positive integer IDs, active `auditId`, named event type, payload shape, and `MessageEvent.lastEventId`. Accepted events are deduplicated by ID, conflicting duplicates are discarded, and the reducer keeps ascending order while reporting gaps. The hook performs `GET /audits/{id}` before opening SSE, treats 404 as terminal `NOT_FOUND`, reconciles again after transport errors, ignores stale snapshot data by watermark, and recovers terminal status/findings/summary from REST when no stream remains. Metrics renders recovered findings and terminal score/error and displays an explicit unavailable-history warning. The client test suite covers malformed JSON, identity mismatch, deduplication, out-of-order events, gaps, initial 404, terminal snapshots, route changes, and normal terminal events. Results: 38 metrics tests passed; metrics coverage is 95.46% statements/lines, 86.84% branches, and 100% functions; metrics lint, typecheck, and build passed. Full P1 acceptance remains open for additional reconnection race cases and real-browser latency evidence in §4.7.

### 4.6 Coverage Gate and Stability

- Run `pnpm test` without cache to obtain a baseline per workspace and the four metrics: lines, statements, functions, and branches. Verify `include`/`exclude` and that all four `apps` workspaces actually participate.
- The specification says **>80%**, while Vitest with a threshold of `80` normally permits exactly 80%. Implement a gate that fails each applicable metric at `<= 80`, using unrounded percentages or covered/total counts; explicitly test controls at `<80`, `=80`, and `>80`, and verify a nonzero exit code. Do not lower thresholds or exclude production code to achieve the target.
- Determine the relevant scope of `packages/contracts`: include its own runtime logic and tests in the gate if they are within the quality scope; exclude only generated types, fixtures, and bootstrap with justification, documenting the rules. Add the minimum configuration/tooling necessary to measure it.
- Add tests until each workspace and applicable metric exceeds the threshold. Connect the gate to the required local command and the existing pipeline if present; document the command and evidence per workspace. Confirm that no cache is reused in a way that hides changes.

**Acceptance:** negative controls demonstrate that exactly 80% fails; a real full run succeeds with every metric strictly above 80% in the documented scopes. Record percentages and justified exclusions; do not confuse a generated report with a passed gate.

### 4.7 End-to-End SSE Latency

- Create a reproducible test in a real browser against the real API and dashboard, with a deterministic synthetic-event emitter and without waiting for LLM inference. Do not measure only the hub, socket, or jsdom: the endpoint is the event visible in the UI DOM.
- Use a single monotonic time source in the test process: start measurement immediately before requesting emission and include an acknowledgment after observing the rendered event. The additional control and acknowledgment path makes the measurement conservative; correlate by auditId/ID, not wall clocks across processes. Confirm that the request corresponds to the observed emission and that clocks or instrumentation do not replace actual rendering.
- Proposed protocol: local stack, one user/one audit, documented browser and versions; open, warmed-up connection; 30 sequentially measured events, without duplicates, with individual measurements and min/median/p95/maximum results. **Every measured event must be strictly below 500 ms**, consistent with NFR-P1; no timeout or missing event counts as success. Document the machine, load, and reproduction command.
- Add a negative control with an injected delay >500 ms and verify that the test fails; keep instrumentation out of the production API or strictly limited to the test environment. If the browser or E2E tool is not installed, record the blocker and install only what is needed for this test.

**Acceptance:** the command returns a nonzero exit code for any event >=500 ms, missing event, or out-of-order event; all 30 measurements and execution conditions are attached. The target remains unproven if it has not been run in a real browser, even if the test is written or mocks pass.

## 5. Verification and Closeout

1. Run contract validation and type generation, checking that no generated diff remains pending: `pnpm --filter @sentinel/contracts validate` and the relevant `generate:api`/`generate:events` scripts.
2. Run focused API, contracts, hook, metrics, and shell tests during each phase; then run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`, with full coverage and without cache for the final evidence.
3. Run a real Ollama smoke test with a synthetic fixture and document the version/model, result, and commands; if a remote provider is considered supported, provide separate authorized real-world evidence. Verify that no secrets appear in the output.
4. Run the real latency test in §4.7 and attach the results. Do not declare P1 complete with simulated tests alone.
5. Update the affected README, contracts, ADRs, and ASD, particularly the data limitations in `docs/asd/08-data-architecture.md`, rule focuses, clone lifecycle, replay, and reconciliation. Record evidence, contract changes, and outstanding blockers.

**Definition of done:** all applicable acceptance criteria pass; `>80%` and `<500 ms` are measured, not inferred; local Ollama has been tested for real; the UI does not promise measurement or automatic application; reconciliation and 404 behavior are verifiable; P0 controls and in-memory-only persistence remain in effect. A real remote provider cannot be declared validated without specific evidence.
