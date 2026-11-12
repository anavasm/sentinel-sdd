# ADR-007: Shared Contract Types in the MFEs

- **Status:** Accepted; runtime validation assumptions reconciled during P2
- **Date:** 2026-09-29
- **Decides:** Reuse types generated from `/specs` through `@sentinel/contracts`, rather than maintaining duplicate API or event contract shapes in clients.
- **Related:** ADR-003 (server validation), ADR-005 (federation), ADR-006 (stream reconciliation).

## Context and decision

The MFEs, API and test fixtures share REST and SSE contracts. `packages/contracts/src/index.ts` exports generated types and the API fetch/Problem helpers. The federation configs declare the package shared. A generated type is a compile-time aid, not runtime validation or a guarantee against drift.

The original plan proposed sharing Ajv runtime validators and a React Hook Form resolver with the clients. Neither is implemented: contracts does not export Ajv validators and React Hook Form is not installed. Runtime boundaries instead are:

1. **Contract gate:** `pnpm validate` runs the uncached contracts Turborepo task. It checks spec syntax, validates SSE fixtures and negative samples, and checks generated OpenAPI types for drift. It is not comprehensive OpenAPI semantic linting and does not check event-type generation drift.
2. **API:** `apps/api/src/lib/validators.ts` compiles and applies Ajv validators from the specs for audit configuration and event validation. The server remains the validation authority.
3. **Form:** `apps/mfe-config/src/lib/auditForm.ts` implements fail-fast checks and builds an `AuditConfig`. These checks are independently maintained and do not guarantee schema equivalence; the API validates submissions.
4. **Browser stream:** `apps/mfe-metrics/src/hooks/useAuditStream.ts` performs structural and envelope consistency checks, not full Ajv schema validation. Invalid or inconsistent frames are logged without payload contents and discarded.

The contracts package contains fixtures and mock handlers for tests; a colocated fixture is not automatically equivalent to every production response. API and client tests, explicit contract validation and regeneration reduce drift, but do not make it impossible.

## Implementation references

| Concern | Location |
| --- | --- |
| Generated types and client exports | `packages/contracts/src/index.ts`, `packages/contracts/src/generated/`, `packages/contracts/src/api-client.ts` |
| Contract checks and fixtures | `packages/contracts/src/validate.ts`, `packages/contracts/src/fixtures/events.ts`, `packages/contracts/src/mocks/handlers.ts` |
| Server validation | `apps/api/src/lib/validators.ts` |
| Form and stream checks | `apps/mfe-config/src/lib/auditForm.ts`, `apps/mfe-metrics/src/hooks/useAuditStream.ts` |

## Consequences

Shared types and client helpers reduce duplicate contract definitions, but changes still require regeneration, validation and tests. Independent client checks can diverge from server rules and must not be presented as a security boundary or full schema validation. Shared federation configuration alone does not guarantee runtime singleton behavior.
