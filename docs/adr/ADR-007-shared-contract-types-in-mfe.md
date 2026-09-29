# ADR-007: Shared Contract Types in the MFEs — Direct Reuse of `@sentinel/contracts`, No Client Duplicates

- **Status:** Accepted
- **Date:** 2026-09-29
- **Decides:** All three MFEs import types **and** runtime validators for API/SSE boundaries directly from `@sentinel/contracts` (workspace dependency, shared federation singleton); hand-written client-side duplicates of contract types are prohibited
- **Sources:** ASD §5.1 (spec-first), §5.2 (one language, one repo), §8.3 (drift impossible by construction), `docs/plans/implementation-plan-apps-api.md` (D-API-1 — validators export), `packages/contracts/src/index.ts` (barrel), `docs/plans/implementation-plan-mfe.md` (D-WEB-4, D-WEB-6)
- **Supersedes:** None
- **Related:** ADR-005 (contracts as federation shared singleton), ADR-006 (client-side SSE validation gate), ADR-003 (hub as server-side validator of record)

## Context

The contracts package already exists and is green: `packages/contracts` generates `api-schema.d.ts` (from `specs/openapi.yaml` via openapi-typescript) and `events.d.ts` (from `specs/events-schema.json` via json-schema-to-typescript), exports them through a barrel (`src/index.ts`: `AuditConfig`, `Audit`, `AuditCreated`, `Finding`, `Problem`, `Severity`, `AuditStatus`, the 4 SSE event types), and ships MSW handlers + fixtures alongside the specs (§8.3 — "a `/specs` change forces mock + type updates; drift is impossible"). The backend consumes exactly this barrel (`apps/api` — types in `store/audits.ts`, `routes/audits.ts`, `agent/runner.ts`; Ajv validators in `src/lib/validators.ts` compiled from `/specs` per ADR-003).

The frontend must interact with the same boundaries: the launch form (client-side fail-fast validation of `AuditConfig`), the REST client (typed `Audit`/`AuditCreated`/`Problem`), and the SSE hook (per-event validation against `events-schema.json`, ADR-006). Writing a second set of hand-rolled TypeScript interfaces (or — worse — `any`-typed JSON) would reintroduce the exact drift the contracts package exists to prevent, and would break the backend's guarantee that "no contract-violating frame ever reaches the wire" (ADR-003) at the last possible checkpoint: the browser.

## Decision

**Every MFE consumes `@sentinel/contracts` directly as a `workspace:*` dependency, declared as a Vite federation shared singleton, with zero duplicated contract types or schemas:**

1. **Types (compile-time):** all component props, hook signatures, query results, and reducer state are typed from the barrel — `AuditConfig` (form model), `Audit` (GET response), `AuditCreated` (POST response), `Finding` (diff viewer), `Problem` (error rendering), `SentinelAISSEEventContract` + the 4 event types (SSE reducer). **No client-side re-declaration of any contract shape.**
2. **Runtime validators (Ajv, from `/specs`):** the validators compiled from the normative `/specs` schemas (the same compile used by the backend `apps/api/src/lib/validators.ts`, promoted to the shared validators export per backend plan decision D-API-1) are reused by:
   - **Launch form resolver (US-2):** `AuditConfig` JSON Schema rules (`repoUrl XOR localPath` oneOf, `format: uri`, `ruleSets` at-least-one-true + `additionalProperties: false`, `severityThreshold` enum) drive React Hook Form field-level errors — client-side fail-fast **mirrors the backend's 400s** (defense in depth, not a reimplementation: same schema artifact, same Ajv options `allErrors: true, strict: false`).
   - **Inbound SSE gate (ADR-006):** every stream `data:` payload is validated before rendering; invalid frames are discarded + logged, never rendered as findings.
3. **MSW mocks come from the contracts package** (`src/mocks/handlers.ts`, fixtures from `src/fixtures/events.ts`) for both dev mode and integration tests — the MFEs never author their own mock payloads, so mocked and real streams are indistinguishable (backend ADR-001 framing parity).
4. **No client-side re-statement of endpoints:** URL paths, status codes, and Problem shapes are consumed from `specs/openapi.yaml`-derived types; a spec change forces regeneration and compile errors at every consumer.

### Code references

| Concern | Location |
|---|---|
| Types barrel (single source of truth) | `packages/contracts/src/index.ts` — re-exports generated `api-schema.d.ts` / `events.d.ts` |
| SSE event types consumed by `useAgentStream` | `packages/contracts/src/generated/events.d.ts` (`SentinelAISSEEventContract`, `AgentThoughtEvent`, `ToolExecutionEvent`, `VulnerabilityFoundEvent`, `AuditCompletedEvent`) |
| REST shapes for the form/dashboard | `packages/contracts/src/index.ts` — `AuditConfig`, `Audit`, `AuditCreated`, `Problem`, `Finding`, `Severity` |
| Ajv compile pattern (shared by backend gate and client validators) | `packages/contracts/src/validate.ts` (`allErrors: true, strict: false`); backend precedent `apps/api/src/lib/validators.ts` — `validateSentinelEvent`, `validateAuditConfig` |
| MSW handlers + fixtures (dev/tests) | `packages/contracts/src/mocks/handlers.ts`, `packages/contracts/src/fixtures/events.ts` (ASD §10.2 — mocks live beside contracts) |
| Wire-format parity | `packages/contracts` `serializeSseEvents` ⇔ `apps/api/src/sse/serializer.ts` (ADR-001) |
| Backend endpoints consumed | `@sentinel/api` `src/routes/audits.ts` (POST/GET/stream), `src/lib/validators.ts` (server-side gate) |

## Consequences

### Pros

- **Drift is impossible by construction:** a `/specs` edit breaks the frontend compile (and the contracts gate) rather than producing runtime surprises — the same guarantee the backend already enjoys (§8.3).
- **One validation story end-to-end:** the same Ajv schemas guard POST input client-side (instant feedback), server-side (400 Problems), and inbound SSE frames browser-side — three checkpoints, one schema source.
- **MSW mocks are contract-true by construction:** fixtures and handlers ship beside the schemas, so integration tests exercise exactly what production sends (including degradation sequences — NFR-A3 parity with backend ADR-002).
- **Single federation singleton:** sharing `@sentinel/contracts` in the federation config guarantees one module instance across all MFEs (no duplicate-module identity bugs).

### Cons

- **Contract regeneration is a coupled event:** every spec change triggers regeneration + recompile across all MFEs. This is the intended friction (fail fast), but it means frontend and backend contract work must be sequenced, not parallelized blindly.
- **Validators in the client bundle:** Ajv + the compiled event schema add bundle weight to the metrics remote (and the form resolver in config). Accepted: schemas are small, the packages are free (C-06), and per-event validation cost is negligible at PoC rates (mirrors ADR-003's server-side tradeoff).
- **Generated types are only as good as the generators:** `json-schema-to-typescript` output occasionally needs lint alignment; the barrel exists precisely to keep consumers insulated from generation quirks — clients must never import `generated/*` directly, only the barrel.

## Status

**Accepted** (2026-09-29). Implementation tracked by `docs/plans/implementation-plan-mfe.md` US-2 (form resolver), US-3 (SSE gate), and the shared-singleton wiring in US-1.
