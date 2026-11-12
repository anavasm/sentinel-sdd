# 9. DevOps (CI/CD)

> PB names no CI/CD tool; pipeline design confirmed by user: simplified Gitflow, local-first quality gates (2026-09-22).

## 9.1 Branching Strategy

**Simplified Gitflow:** feature branches → `main`.

- `main` always buildable; SDD acceptance gates (specs) live in `/specs` on `main` before app code merges (constraint C-08).
- Feature branches named per module (e.g., `feat/mfe-config-rules-form`).

## 9.2 Local-First Pipeline

For a 15-day $0 PoC, the pipeline is a set of Turborepo tasks runnable locally and portable to any CI later:

```
pnpm install
pnpm validate         # required contracts gate, through Turborepo
pnpm lint             # eslint across all packages
pnpm typecheck        # Playwright files and workspace types
pnpm test             # vitest (see 10-testing.md)
pnpm test:e2e:flow    # Playwright: config → shell → metrics with test-only runner
pnpm test:e2e:latency # P1 latency; run separately from flow (shared ports)
pnpm build            # all apps build cleanly
```

| Gate | Tool | Blocking rule |
|---|---|---|
| Lint | ESLint (per workspace config) | Zero errors |
| Types | `tsc --noEmit` | Zero errors |
| Unit/Integration | Vitest + RTL + MSW | Coverage > 80% (constraint §4.2) |
| E2E | Playwright | 1 suite green (config → shell → metrics flow) |
| Contracts | `pnpm validate` | Spec syntax, SSE fixtures and negative samples, and current generated OpenAPI types |

The browser suite starts and stops its own local API, shell, and remotes. It
uses synthetic events from a test-only runner rather than an external LLM or
Git repository. See the README for browser installation, required ports, and
the separate P1 latency test.

## 9.3 Contract Validation Step

Before application code merges, run `pnpm validate` from the repository root.
The uncached Turborepo task checks OpenAPI YAML and SSE JSON syntax, validates
SSE fixtures and negative samples against the event schema, and checks generated
OpenAPI types for drift. It does not perform comprehensive OpenAPI semantic
linting. Run the relevant workspace tests separately for API response and MSW
coverage. This is the SDD acceptance gate (constraint C-04, C-08).

For development, `pnpm dev` starts only the shell and the two remotes. Start
the API in a separate terminal with `pnpm --filter @sentinel/api dev`; see the
README for security configuration and prerequisites.

## 9.4 CI/CD (post-MVP)

> **[TO BE DEFINED]** — No hosted CI is mandated for the MVP ($0 budget, local execution). The task graph above is CI-agnostic; when a shared environment appears (see `07-infrastructure.md` §7.5), wire the same tasks into GitHub Actions or equivalent.
