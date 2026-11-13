# Implementation Plan — P3: PoC Limits and Evolution

> Work item: Resolve the audit-concurrency mismatch and make the current in-memory and SSE-buffer limits explicit without prematurely expanding the local PoC.
> Prepared: 2026-11-13 · Baseline: P0 security boundaries, P1 main-flow reliability, and P2 MVP completion are complete.
> Scope: P3 planning and implementation. This plan does not introduce persistent storage, shared deployment, authentication, or multi-user support.

## 1. Goal and Decisions

Keep the current local PoC intentionally small, close the mismatch between its concurrency requirement and API behavior, and avoid re-implementing behavior already delivered in P1. The decisions for this plan are:

1. **One active audit at a time.** Enforce the single-user / single-audit PoC requirement in the API. An audit is active while its status is `queued` or `running`; `completed` and `failed` audits do not occupy the slot. A valid creation request received while the slot is occupied is rejected with `409 Conflict` Problem Details, without creating an audit or starting the runner. Concurrent SSE subscribers to an audit are not restricted.
2. **Keep audit state in memory for the local PoC.** A process restart continues to lose audit state, and completed audits continue to occupy memory for the process lifetime. Do not select or implement a database, TTL, or eviction policy as part of this work.
3. **Gate persistence and expiry on a future deployment decision.** Sharing the service or deploying it beyond the current local PoC requires a separate design decision before that deployment. That decision must choose storage and define audit/event retention, expiry, and deletion behavior alongside the applicable security and operational controls.
4. **Treat the SSE buffer-gap signal as already implemented by P1.** The API snapshot exposes `lastEventId` and `firstAvailableEventId`; the client reconciles from the snapshot and reports when historical events are unavailable. Do not duplicate this implementation. Verify it remains covered and document its status; fix only if the existing behavior or tests have regressed.

The concurrency decision resolves NFR-P2 in favor of its current “single-user / single-audit” wording, rather than changing the requirement to allow concurrent audits.

## 2. Baseline and Risks

| Area | Observed state |
| --- | --- |
| Audit storage | `apps/api/src/store/audits.ts` holds every audit in a process-level `Map`. It has no expiry or removal path other than test reset. A restart loses all records. ADR-004 and ASD §8.5 already identify this as a PoC limitation/future decision. |
| Event buffer | `apps/api/src/sse/hub.ts` retains up to 1000 events per audit and evicts the oldest event FIFO. The audit snapshot carries the retained-history boundary and event watermark. |
| Gap recovery | P1 added `firstAvailableEventId`/`lastEventId` to the REST contract and client-side snapshot reconciliation with an unavailable-history warning. ADR-001 and the P1 phase 3/4 evidence describe the behavior. This P3 item is verification/documentation only unless a regression is found. |
| Concurrent audits | `POST /api/v1/audits` currently accepts concurrent requests and creates independent audit IDs. `docs/plans/implementation-plan-apps-api.md` explicitly says concurrent POSTs are accepted, while NFR-P2 says “Single-user / single-audit session.” |
| API response contract | Audit creation documents `201`, `400`, and `413`; it does not currently describe a concurrency rejection. The RFC 9457 `Problem` response is already used for API failures. |
| Security boundary | The PoC is loopback-only and unauthenticated. A shared or remote deployment is prohibited until a separate security design is accepted (ADR-008/NFR-S1). Persistence work must not be interpreted as approval for such deployment. |

Primary references: `docs/asd/03-nfr.md`, `docs/asd/08-data-architecture.md`, `docs/adr/ADR-001-sse-framing-and-pre-header-404.md`, `docs/adr/ADR-004-in-memory-state-machine-and-immutability.md`, `docs/plans/implementation-plan-apps-api.md`, `specs/openapi.yaml`, `apps/api/src/store/audits.ts`, `apps/api/src/routes/audits.ts`, and `apps/api/src/sse/hub.ts`.

## 3. Phases and Dependencies

| Order | Deliverable | Dependencies |
| --- | --- | --- |
| 0 | Confirm baseline behavior and P1 gap-signal coverage | None |
| 1 | Enforce one active audit and document the `409` contract | Phase 0 |
| 2 | Reconcile requirements, architecture notes, and operational boundary | Phases 0–1 |
| 3 | Run focused API, contract, and client regression gates | Phases 1–2 |

The persistence/expiry design is deliberately not an implementation phase. It is activated only when a future sharing/deployment proposal is made and must be planned separately.

## 4. Stories, Tasks, and Acceptance Criteria

### 4.1 Single Active Audit

- Add a store-level query or admission helper that determines whether an audit is `queued` or `running`. Keep the check and audit creation synchronous with respect to one another so competing POST requests cannot both claim the slot.
- Enforce the limit in `POST /api/v1/audits` after request and local-path validation, but before audit creation and runner kickoff. A rejected request must not allocate an audit ID, mutate the store, or invoke the runner.
- Return `409 Conflict` with the existing RFC 9457 Problem Details shape and a stable problem type that identifies the active-audit limit. Keep malformed or unauthorized requests on their existing validation-error paths.
- Add the `409` response to OpenAPI, regenerate any derived contract types if required, and update API tests and fixtures.
- Test that only `queued`/`running` audits occupy the slot; a terminal `completed` or `failed` audit permits the next audit. Test competing creation requests, runner invocation counts, and that rejected requests leave no stored audit.
- Preserve multiple subscribers and replay behavior for the one active audit; this limit applies to active audits, not SSE connections.

**Acceptance criteria:**

- At most one audit per API process is in `queued` or `running` state.
- When one audit is active, a valid second POST receives `409` Problem Details and does not create an audit or call the runner.
- A rejected request does not prevent a new audit after the active audit becomes `completed` or `failed`.
- Existing request-validation status codes and the P0 loopback, repository-allowlist, and provider-egress boundaries are unchanged.
- OpenAPI, generated contracts, implementation, and tests agree on the `409` response.

### 4.2 In-Memory Retention and Evolution Gate

- Preserve the current process-local `Map` behavior for this PoC: no persistence dependency, expiry timer, or audit eviction is introduced.
- Keep restart loss and unbounded audit-record lifetime visible in ADR-004 and ASD data-architecture documentation. State that the 1000-event SSE buffer is bounded independently and does not expire the audit or its findings.
- Define the future decision trigger as any proposal to share or deploy the service beyond its current local PoC. Before that deployment, require a separate design to select durable storage and specify retention/expiry and deletion behavior for audits, findings, and event history, including how retention interacts with snapshot/replay semantics.
- Keep the future storage/expiry choice open; do not imply that SQLite, PostgreSQL, or a particular TTL has been selected.

**Acceptance criteria:**

- Current documentation unambiguously distinguishes process-restart loss, audit-record lifetime, and the bounded per-audit event replay buffer.
- The docs identify storage and retention/expiry as required decisions before a future shared/deployed mode, without adding an implementation or committing to a technology.
- No shared/remote deployment, authentication, or multi-user capability is enabled or implied by this P3 work.

### 4.3 SSE Buffer-Eviction Signal — Verify Existing P1 Work

- Confirm the `Audit` contract and API snapshot expose `lastEventId` and `firstAvailableEventId`, including empty and evicted-buffer cases.
- Confirm the hub maintains the watermark when events are evicted and continues assigning monotonic IDs.
- Confirm the metrics client reconciles from `GET /audits/{auditId}` and displays an unavailable-history warning when a cursor falls behind the retained range.
- Reuse existing API and `useAuditStream` tests; add no parallel gap mechanism or contract field. If these checks fail, make the smallest correction consistent with ADR-001/006 and update their evidence.

**Acceptance criteria:**

- A client can determine that requested historical events have been evicted from the REST watermarks, without waiting for another SSE event.
- The current snapshot is recovered while missing timeline events are not represented as if replayed.
- Existing P1 tests cover buffer eviction, cursor positions, REST reconciliation, and the user-visible warning; no duplicate P3 implementation is introduced.

## 5. Definition of Done

- API concurrency is limited to one active audit, with deterministic admission behavior and a documented/tested `409` response.
- NFR-P2, the API implementation plan, OpenAPI, and ADR/ASD documentation consistently describe the single-active-audit policy.
- In-memory persistence remains unchanged for the PoC, with restart loss and process-lifetime retention accurately documented and a clear future design trigger.
- Existing buffer-gap detection is verified against the P1 implementation and remains covered; no redundant SSE contract or client mechanism is added.
- Focused API tests and contract validation pass; the metrics stream regression tests pass if client-facing gap behavior is touched.
- P0 security boundaries and P1 snapshot/replay behavior remain intact.

## 6. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Two near-simultaneous POSTs both pass an asynchronous admission check | Keep admission and creation in one synchronous store operation after asynchronous validation has completed; cover competing requests in an integration test. |
| A terminal audit accidentally holds the active slot forever | Count only `queued` and `running`; test both successful and failed terminal transitions. |
| A `409` is handled as an unexpected client error or omitted from generated API types | Add the response and stable problem type to OpenAPI and contract fixtures, then run contract validation and API tests. |
| Future persistence work is mistaken for authorization to deploy the unauthenticated PoC | Keep the ADR-008/NFR-S1 deployment restriction explicit; persistence alone does not satisfy the required security design. |
| P3 duplicates work already done in P1 or overstates history recovery | Treat watermarks and the client warning as existing behavior; verify coverage and continue to state that evicted events are not reconstructed. |

## 7. Out of Scope

- Database or other durable storage, audit TTL/expiry, automatic deletion, or event-buffer policy changes.
- Shared or remote deployment, authentication, authorization, multi-user tenancy, or horizontal scaling.
- Changing the SSE event schema or adding a second gap-detection mechanism.
- Limiting the number of SSE clients connected to the single active audit.
- Changing the established P0 repository-path or LLM-egress security policies.
