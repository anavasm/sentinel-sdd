# ADR-008: Local-Only API, Allowlisted Repository Access, and Controlled LLM Egress

- **Status:** Accepted
- **Date:** 2026-11-05
- **Decides:** NFR-S1/S2/S4-S7 and constraints C-09-C-12
- **Sources:** User decisions (2026-11-05), `docs/asd/03-nfr.md`, `docs/asd/04-constraints.md`, `docs/asd/06-software-architecture.md`, `docs/asd/07-infrastructure.md`, `docs/asd/08-data-architecture.md`
- **Supersedes:** The interpretation that the no-auth PoC may be reachable on non-loopback interfaces
- **Related:** `docs/adr/ADR-002-llm-degradation-as-sse-data.md`, `docs/adr/ADR-004-in-memory-state-machine-and-immutability.md`

## Context

The MVP accepts local filesystem paths and sends source snippets to an LLM. The source code is classified as confidential, while the API intentionally has no authentication. These choices are safe together only when the API is local-only and the repository and model egress boundaries are enforced by the server.

The current architecture uses an unspecified API listen host, accepts any accessible `localPath`, and constructs a remote HTTP LLM client as the primary provider by default. A CORS allowlist does not prevent non-browser clients from reaching the API. The PoC therefore needs explicit network, filesystem, and outbound-data policies before implementation hardening.

## Decision

1. **Network boundary:** The unauthenticated PoC API listens only on loopback. No non-loopback/shared deployment is allowed under this ADR. A future remote deployment requires a separate threat model and an approved authentication/authorization design. CORS is not considered an access-control mechanism.
2. **Local repository authorization:** `SENTINEL_ALLOWED_REPO_ROOTS` is a comma-separated server-side allowlist. If unset or empty, local-path audits are rejected. The API canonicalizes configured roots and requested paths and rejects any resolved path outside every allowed root. Repository traversal must not follow symlinks whose resolved targets escape an allowed root.
3. **LLM egress:** Local Ollama is the default and only provider when external access is not explicitly enabled. External provider access requires the server operator to set `SENTINEL_ALLOW_EXTERNAL_LLM=true`. Non-loopback LLM endpoints, including a non-loopback Ollama endpoint, are external. Remote credentials are configured server-side and must never be embedded in source, audit events, or logs.
4. **Sensitive content:** `@secretlint/core` with `@secretlint/secretlint-rule-preset-recommend` is the offline detector. Known sensitive files are excluded and detected secret values are redacted from the complete prompt immediately before any provider receives it. If detection or redaction is unavailable or fails, the affected snippet is not sent. Generated findings, audit diagnostics, and logs use the same redaction policy. The baseline exclusions, supported credential patterns, and residual-risk note are documented in the repository README and tested. Detection is defense in depth and is not represented as a guarantee of finding every secret.
5. **Failure behavior:** A rejected path fails before audit creation with a sanitized RFC 9457 `400` response. A snippet that cannot be safely inspected is skipped or reported through a sanitized audit outcome; secret material is never included in the outcome.

## Consequences

### Pros

- The no-auth PoC has an explicit local network boundary instead of relying on developer convention or CORS.
- A caller cannot use the API to scan arbitrary readable paths outside configured repository roots.
- Remote code egress is opt-in by the server operator; local analysis remains the default.
- Secret scanning/redaction failure cannot silently fall back to sending the original snippet.

### Cons

- Local-path audits require explicit server configuration and are unavailable when no allowed roots are configured.
- Secret detection can have false negatives; the system must communicate this limitation and avoid claiming complete sanitization.
- Enabling a remote provider requires operator-managed configuration and credentials; the provider adapter must not leak them.
- Any use beyond a single developer machine requires a new authentication, authorization, and transport-security decision.

## Implementation References

| Concern                                             | Current location / planned change                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| API listener currently omits an explicit host       | `apps/api/src/server.ts` — bind to loopback                                                                                                      |
| Port and CORS configuration                         | `apps/api/src/lib/config.ts` — add listener and repository/LLM policy configuration as appropriate                                               |
| Local path currently checked only for accessibility | `apps/api/src/routes/audits.ts` and `apps/api/src/agent/repo-reader.ts` — enforce canonicalized roots and symlink containment                    |
| LLM currently creates remote primary by default     | `apps/api/src/agent/llm.ts` — local-only default and explicit external opt-in                                                                    |
| Source acquisition and snippet limits               | `apps/api/src/agent/repo-reader.ts`, `apps/api/src/agent/runner.ts`, `apps/api/src/agent/llm.ts` — exclusions, redaction, and fail-closed egress |
| Detailed implementation sequence                    | `docs/plans/implementation-plan-p0-security-boundaries.md`                                                                                       |

## Status

**Accepted** (2026-11-05). This ADR records the user's selected security policy; code changes are tracked separately in the P0 implementation plan.
