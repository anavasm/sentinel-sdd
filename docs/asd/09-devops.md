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
turbo run lint        # eslint across all packages
turbo run typecheck   # tsc --noEmit across apps/packages
turbo run test        # vitest, coverage > 80% gate (see 10-testing.md)
turbo run e2e         # playwright suite (full monorepo environment)
turbo run build       # all apps build cleanly
```

| Gate | Tool | Blocking rule |
|---|---|---|
| Lint | ESLint (per workspace config) | Zero errors |
| Types | `tsc --noEmit` | Zero errors |
| Unit/Integration | Vitest + RTL + MSW | Coverage > 80% (constraint §4.2) |
| E2E | Playwright | 1 suite green (config → shell → metrics flow) |
| Contracts | `/specs` validated before code | SDD acceptance criteria (see `02-functional-overview.md` §2.4) |

## 9.3 Contract Validation Step

Before application code merges, `specs/openapi.yaml` and `specs/events-schema.json` are validated (schema-lint / sample-driven checks with MSW). This is the SDD acceptance gate (constraint C-04, C-08).

## 9.4 CI/CD (post-MVP)

> **[TO BE DEFINED]** — No hosted CI is mandated for the MVP ($0 budget, local execution). The task graph above is CI-agnostic; when a shared environment appears (see `07-infrastructure.md` §7.5), wire the same tasks into GitHub Actions or equivalent.
