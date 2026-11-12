# ADR-005: MFE Topology — Vite Module Federation

- **Status:** Accepted; implementation reconciled during P2
- **Date:** 2026-09-29
- **Decides:** Three workspace apps under `apps/`, composed at runtime using Vite and `@originjs/vite-plugin-federation` (C-01).
- **Supersedes:** The earlier single-SPA working name `apps/web`.
- **Related:** ADR-006 (stream state), ADR-007 (contracts), ADR-008 (local security boundaries).

## Context and decision

The configuration and metrics modules must be independently evolvable. A single SPA was rejected because build-time boundaries alone do not provide the selected MFE topology. Webpack federation was rejected in favor of the repository's Vite stack; iframes were rejected because routing and navigation across boundaries would be awkward.

| Workspace | Responsibility | Federation |
| --- | --- | --- |
| `apps/mfe-shell` | Layout, routing and lazy remote loading | Host; `/` mounts config, `/audits/:auditId` mounts metrics |
| `apps/mfe-config` | Audit configuration and launch | Exposes `./ConfigView` |
| `apps/mfe-metrics` | Stream, findings, dashboard and client-side Markdown export | Exposes `./MetricsView` |

The shell owns navigation; remotes do not import one another. Each remote also supports standalone development. The Vite configurations declare React, React DOM and contracts in the federation share scope; the plugin does not offer a Webpack-style singleton flag, so runtime sharing requires care. The metrics build additionally routes the React import in `use-sync-external-store` through the federation share scope to avoid a second React instance in the Recharts dependency chain. Both federated and standalone metrics rendering are exercised by Playwright.

Tailwind configuration and CSS entries are owned per workspace. The API client is provided by `packages/contracts`, not by a shell federation module; REST and stream state are local to the consuming view (ADR-006). Recharts is used by metrics; neither TanStack Query nor React Hook Form is installed.

## Implementation references

- Host routing and fallback: `apps/mfe-shell/src/App.tsx`; host federation: `apps/mfe-shell/vite.config.ts`.
- Remote exposures and shared modules: `apps/mfe-config/vite.config.ts`, `apps/mfe-metrics/vite.config.ts`.
- API routing: `apps/api/src/routes/api-v1.ts` and `apps/api/src/routes/audits.ts`.
- `pnpm dev` runs `scripts/dev-federation.mjs`, building and serving config on 5174 and metrics on 5175 and starting the shell on 5173. Start the API separately with `pnpm --filter @sentinel/api dev` (port 3000). API CORS permits the configured local origins; the API still binds only to loopback.
- Browser coverage: `pnpm test:e2e:flow`; the separate `pnpm test:e2e:latency` covers P1 latency.

## Consequences

Independent remotes permit local standalone development and isolate the chart dependency to metrics, at the cost of runtime loading failures and shared-dependency complexity. The shell provides error handling for remote failures. A successful build alone does not guarantee a single compatible React instance, so browser tests remain important. Fixed local ports simplify federation and tests but require coordination when already in use.
