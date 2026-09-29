# ADR-005: MFE Topology — Vite Module Federation across `mfe-shell`, `mfe-config`, `mfe-metrics`

- **Status:** Accepted
- **Date:** 2026-09-29
- **Decides:** Frontend topology — three separate workspace apps (`apps/mfe-shell` host, `apps/mfe-config` and `apps/mfe-metrics` remotes) wired at runtime via Vite + `@originjs/vite-plugin-federation`, per constraint C-01
- **Sources:** ASD §4.1 (C-01), `docs/ARCHITECTURE.md` §1–§2, ASD §6.2, `docs/plans/implementation-plan-mfe.md` (D-WEB-1/D-WEB-2)
- **Supersedes:** The earlier working name `apps/web` (single-SPA idea) — superseded by user decision (2026-09-29) to honor C-01 strictly
- **Related:** ADR-006 (SSE hook in `mfe-metrics`), ADR-007 (shared contracts in all MFEs)

## Context

Core Objective 2 of the Project Brief requires the Configuration module and the Metrics/Analytics module to be **independently evolvable** ("distinct frontend teams"). The ASD therefore mandates (C-01) a microfrontend architecture: one host (`mfe-shell`: layout, routing, global concerns) and two remotes (`mfe-config`: audit launch; `mfe-metrics`: live stream, dashboard, findings). `docs/ARCHITECTURE.md` §2 already names the concrete stack: Vite + `@originjs/vite-plugin-federation`, with TanStack Query for cross-MFE server state and React Router owned by the host.

Alternatives considered:

1. **Single SPA (`apps/web`) with module-folder boundaries** — rejected: satisfies neither C-01 nor Core Objective 2; build-time module boundaries do not give independent deployment/evolution.
2. **Webpack Module Federation** — rejected: the repo standardizes on Vite; the ASD names the Vite plugin explicitly.
3. **iframe composition** — rejected: routing/state sharing across the shell boundary (POST → redirect to `/audits/{auditId}`) would be fragile and un-idiomatic.

## Decision

**Build the frontend as three pnpm/Turborepo workspaces under `apps/`, federated at runtime:**

| Workspace | Role | Federated surface |
|---|---|---|
| `apps/mfe-shell` | Host: app shell, global layout, React Router (`/` → config, `/audits/:auditId` → metrics), shared API client + Problem rendering | exposes `./Layout`; consumes both remotes |
| `apps/mfe-config` | Remote 1: audit launch form, client-side fail-fast validation, POST + redirect | exposes `./ConfigView` |
| `apps/mfe-metrics` | Remote 2: `useAgentStream` SSE hook, live dashboard, findings viewer, terminal report | exposes `./MetricsView` |

Rules established with the topology:

1. **Routing belongs to the shell only.** Remotes render views; cross-MFE navigation happens exclusively through the host's router (mirrors the ASD §6.1 sequence diagram: config POST → shell redirect → metrics view).
2. **Shared singletons:** `react`, `react-dom`, and `@sentinel/contracts` are declared shared-singleton in all three Vite configs — duplicate React copies break hooks, duplicate contract modules break identity checks.
3. **Fixed dev ports (D-WEB-2):** shell 5173, config 5174, metrics 5175 — required for stable remote URLs and the future Playwright suite (ASD §10.4).
4. **Dual-mode remotes:** every remote must also run standalone (`vite dev` on its own port) so teams develop without booting the host; federation is added at the edges, not baked into component code.
5. **No remote-to-remote imports.** Shared UI/API helpers live in the shell (or a future `packages/` module) — never in a sibling remote.
6. **Styling standardizes on Tailwind CSS (v3/v4) across all three workspaces** (`mfe-shell`, `mfe-config`, `mfe-metrics`). Tailwind (plus PostCSS) and the base `@tailwind` directives are initialized **per workspace** — each remote owns its own `tailwind.config.ts`, `postcss.config.js`, and CSS entry with its own `@tailwind base/components/utilities` directives. Rationale: under runtime Module Federation each remote is built independently, so per-workspace scoping guarantees design consistency (identical utility vocabulary, shared design tokens via each config's `theme` extension) while avoiding duplicate/generated class collisions when remote bundles are injected into the host at runtime. No CSS-in-JS, no second styling framework, and no shared global stylesheet imported across the federation boundary (only Tailwind tokens/theme values are kept in sync manually, or via a future shared `packages/` preset if drift becomes a problem).

### Code references (planned placement — no code written yet)

| Concern | Location |
|---|---|
| Host routing + lazy remote loading | `apps/mfe-shell/src/` — React Router (`/`, `/audits/:auditId`), lazy `ConfigView`/`MetricsView` |
| Federation host config | `apps/mfe-shell/vite.config.ts` (`remotes: { config, metrics }`) |
| Federation remote exposures | `apps/mfe-config/vite.config.ts` (`exposes: ['./ConfigView']`), `apps/mfe-metrics/vite.config.ts` (`exposes: ['./MetricsView']`) |
| Cross-MFE server state | TanStack Query in each remote (per `docs/ARCHITECTURE.md` §2), invalidation kept remote-local |
| Backend integration surface | `specs/openapi.yaml` endpoints implemented by `@sentinel/api` (`src/routes/audits.ts`, per ADR-001..004) |

## Consequences

### Pros

- **Independent evolution:** config and metrics teams can ship, test, and demo their remote standalone without coordinating releases (C-01's stated rationale).
- **Right-sized bundles:** the metrics MFE pulls Recharts and the SSE machinery only where the metrics view is loaded; the config form stays light.
- **E2E-ready:** fixed ports + a single Playwright flow (`mfe-config` → shell → `mfe-metrics`, ASD §10.4) map 1:1 onto the topology.
- **Seam for growth:** a future third remote (e.g., reports) slots in without touching existing remotes.

### Cons

- **Runtime dependency risk:** remote load failure renders a broken shell unless handled — mitigated by US1 fallback UI (friendly error, retry) and the standalone mode for debugging.
- **Shared-singleton discipline is manual:** Vite federation does not enforce React/contracts singletons; a misconfigured remote compiles but crashes at runtime. Protected by the US-1 smoke test.
- **CORS overhead in dev:** remotes fetch the API and the shell fetches remotes cross-port; the API needs a dev CORS allowlist (5173–5175) — tracked as an `apps/api` follow-up (plan Q-2), not a client workaround.
- **Two build modes to maintain** per remote (standalone + federated) — accepted for the PoC; documented in each README.

## Status

**Accepted** (2026-09-29). Implementation tracked by `docs/plans/implementation-plan-mfe.md` US-1.
