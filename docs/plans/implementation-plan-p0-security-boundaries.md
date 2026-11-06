# Implementation Plan — P0 Security Boundaries

> Work item: Enforce the local-only network boundary, authorize local repository roots, and control source-code egress to LLM providers.
> Prepared: 2026-11-05 · Decision: `docs/adr/ADR-008-local-only-repository-and-llm-boundaries.md`
> Scope: Security hardening for the unauthenticated local PoC. No application code is changed by this plan.

## 1. Goal

Implement the security policies selected for the PoC:

- API is reachable only through loopback while authentication is absent.
- Local-path audits are restricted to server-configured, canonicalized repository roots.
- Local LLM processing is the default; external LLM egress requires explicit server-operator opt-in.
- Known sensitive files are excluded, detected secrets are redacted before provider calls, and detector/redactor failures block egress for the affected snippet.

The normative requirements are NFR-S1/S2/S4-S7 and constraints C-09-C-12 in the ASD. REST request and SSE event shapes do not need to change for these controls; rejected requests use the existing Problem Details contract, while sanitized audit outcomes use existing event types.

## 2. Decisions and Configuration

| Setting                       | Policy                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| API listener                  | Explicit loopback bind; no externally configurable non-loopback host in the unauthenticated PoC                                                       |
| `SENTINEL_ALLOWED_REPO_ROOTS` | Comma-separated server-side paths; unset/empty disables local-path audits                                                                             |
| Path containment              | Resolve real paths; permit symlinks only when their canonical targets remain inside an allowed root; reject escaping symlinks                         |
| `SENTINEL_ALLOW_EXTERNAL_LLM` | Defaults to `false`; only literal `true` enables a configured remote provider                                                                         |
| Local LLM                     | Ollama on loopback is the default; a non-loopback Ollama URL is treated as external                                                                   |
| Secret detector               | Select a maintained, offline-capable detector during implementation; establish and test a baseline exclusion/pattern set before wiring it into egress |
| Detector/redactor failure     | Fail closed for the affected snippet: do not call any LLM with the original content; emit only sanitized status/error information                     |

Remote-provider credentials, when supported by the selected adapter, are supplied through server-side environment/secret configuration. They are never committed, returned to the browser, or written to logs/events. Enabling external access is a server-operator decision, not a client-controlled request field.

## 3. User Stories and Acceptance Criteria

### US-1 — Loopback-Only API Listener

**Tasks:** update API bootstrap/configuration and add listener tests.

**Acceptance criteria:**

- The unauthenticated server binds only to a loopback address.
- The server does not bind to `0.0.0.0`, `::`, or another non-loopback interface.
- The documented browser/API development flow continues to work with the selected loopback address.
- CORS tests remain, but no test or documentation treats CORS as authentication.

### US-2 — Allowed Local Repository Roots

**Tasks:** parse and validate `SENTINEL_ALLOWED_REPO_ROOTS`; canonicalize configured roots; enforce containment in request validation and repository reading; map policy rejection to a sanitized `400` Problem Details response.

**Acceptance criteria:**

- An unset, empty, malformed, or inaccessible root configuration cannot broaden access; local-path audits are rejected when no valid roots remain.
- A path equal to or beneath an allowed root is accepted after canonicalization.
- A symlink whose canonical target remains inside an allowed root may be followed after target validation.
- Parent traversal, a root symlink resolving outside the allowlist, and nested file/directory symlinks resolving outside it are rejected without reading their targets.
- A path outside the allowlist is rejected before audit creation and before the runner starts.
- Git URL audits remain unaffected by the local filesystem allowlist and still use the existing file-count, file-size, and clone-time bounds.
- Tests cover normal containment, sibling-prefix confusion, `..` traversal, nonexistent paths, in-root symlinks, and symlink escapes on supported platforms.

### US-3 — Local-Only LLM Default and External Opt-In

**Tasks:** change default client construction; validate provider URLs against the selected mode; add configuration and mocked-fetch tests; document server-side configuration.

**Acceptance criteria:**

- With `SENTINEL_ALLOW_EXTERNAL_LLM` unset or false, no external endpoint is constructed or contacted; Ollama is the only provider attempted.
- A non-loopback `OLLAMA_URL` is rejected unless external LLM access is explicitly enabled.
- With external access enabled, a remote provider is used only when its required endpoint/model configuration is present; credentials are read from server-side configuration and never logged or emitted.
- Failure of local Ollama in local-only mode does not silently trigger a remote provider.
- Existing graceful-degradation events remain contract-valid and contain no provider credentials or source snippets.

### US-4 — Sensitive-File Exclusion and Secret Redaction

**Tasks:** select an offline-capable detector; define sensitive-path exclusions and supported secret patterns; add a pre-egress sanitizer for local and cloned repositories; sanitize generated findings and diagnostic output.

**Acceptance criteria:**

- The baseline excludes sensitive paths/files such as environment files, private keys/certificates, and credential/config files; the exact maintained list is documented with tests.
- The exact prompt snippet is scanned/redacted immediately before every LLM call, including calls to local Ollama.
- Tests with sentinel secrets prove original values do not appear in mocked provider requests, SSE event payloads, API errors, or captured logs.
- If scanning/redaction throws, returns an invalid result, or cannot establish a safe payload, the original snippet is never sent. The audit reports a sanitized skip/failure outcome.
- The redaction layer does not claim complete secret detection; residual risk is documented.

### US-5 — Security Regression and Documentation Gate

**Tasks:** add API/repository-reader/LLM boundary tests; update ASD/ADR references and the local environment instructions for the new settings; run existing workspace checks.

**Acceptance criteria:**

- Automated tests cover listener binding policy, root parsing/containment, symlink escapes, external-provider opt-in, and egress redaction/fail-closed behavior.
- Existing audit lifecycle and SSE tests remain green.
- `pnpm --filter @sentinel/api lint`, `typecheck`, and `test` pass; `pnpm --filter @sentinel/contracts validate` remains green.
- The security policy and required local configuration are documented consistently in the ASD and ADR-008.

## 4. Implementation Sequence

1. **Network boundary:** explicit loopback bind and tests; preserve the current local MFE workflow.
2. **Filesystem boundary:** allowlist parsing and canonical path checks at audit creation, then revalidation during repository traversal.
3. **LLM egress gate:** local-only provider construction by default; external provider construction only after operator opt-in.
4. **Content sanitization:** select detector, add file exclusions, sanitize exact outbound snippets and model-generated outputs, fail closed.
5. **Regression and documentation:** run security-focused tests and workspace gates; update operational configuration documentation without changing the product/API contract unless implementation reveals a contract requirement.

US-1 and US-2 can be developed independently. US-3 and US-4 should be integrated through one provider-egress boundary so no runner call bypasses the policy. US-5 closes the gate.

## 5. Out of Scope

- Authentication/authorization for a shared or remote deployment. Such deployment remains prohibited until a separate security design is accepted.
- Database persistence, multi-user tenancy, and production deployment.
- A guarantee that secret scanning detects every possible credential format.
- Changes to the audit request shape or SSE event schema unless implementation demonstrates that an existing contract cannot express a sanitized outcome.
