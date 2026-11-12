# ADR-006: Frontend State Management and SSE Reconnection/Resync

- **Status:** Accepted; implementation reconciled during P2
- **Date:** 2026-09-29
- **Decides:** Native `EventSource` with view-local stream state and snapshot reconciliation in `mfe-metrics`.
- **Related:** ADR-001 (SSE framing and replay), ADR-003 (server event validation), ADR-004 (bounded buffer), ADR-005 and ADR-007.

## Context and decision

The metrics view needs ordered, deduplicated events, a terminal state, and an honest indication when the bounded replay buffer cannot restore the complete timeline. Native `EventSource` supplies automatic reconnection with `Last-Event-ID`; a custom parser or global store was not needed for this PoC. The original plan proposed TanStack Query for REST state and a hook named `useAgentStream`; the implementation instead uses local React state, fetch and `useAuditStream`. TanStack Query is not installed.

`apps/mfe-metrics/src/hooks/useAuditStream.ts` fetches the audit snapshot before opening a stream and reconciles again on transport errors, invalid frames and terminal events. A snapshot showing a terminal or unknown audit prevents or closes the stream. EventSource reconnects automatically after recoverable transport errors; the server's `retry: 5000` hint and retained replay support that path. The server buffers at most 1000 events and exposes `firstAvailableEventId` and `lastEventId` in the snapshot; expired or missing events can leave a timeline gap, which is surfaced to the user. Snapshot findings and status can be recovered, but an evicted timeline cannot.

The hook checks JSON structure, event name, audit scope and native SSE ID before accepting a frame. It logs and discards malformed or inconsistent frames without logging payloads; these checks are not a full JSON Schema validator. Accepted events are deduplicated by ID and sorted; conflicting duplicates are logged. Terminal completion closes the EventSource and refreshes the final snapshot. `AGENT_THOUGHT` carries progress/status rather than internal model reasoning.

The config remote submits using the contracts API client and local form state. Metrics performs its own snapshot fetch; it does not use a query cache. See ADR-007 for the validation boundaries.

## Implementation and verification

| Concern | Location |
| --- | --- |
| Hook, ordering, validation and reconciliation | `apps/mfe-metrics/src/hooks/useAuditStream.ts` |
| UI and snapshot/event merge | `apps/mfe-metrics/src/MetricsView.tsx`, `apps/mfe-metrics/src/lib/dashboard.ts` |
| Server replay, terminal close and watermarks | `apps/api/src/sse/hub.ts`, `apps/api/src/store/audits.ts` |
| Framing and retry | `apps/api/src/sse/serializer.ts` |
| Client tests | `apps/mfe-metrics/tests/useAuditStream.test.ts`, `apps/mfe-metrics/tests/MetricsView.test.tsx` |
| Real browser flow and latency | `tests/e2e/audit-flow.spec.ts`, `pnpm test:e2e:latency` |

## Consequences

Replay and native reconnection avoid a custom protocol; local state avoids a global store, but every tab maintains its own connection. Gaps after eviction cannot be reconstructed from snapshots. Native EventSource cannot attach arbitrary headers on its initial request; future authenticated remote deployment would require a separately approved design. Ordering and validation depend on server protocol discipline and tests, not on compile-time types alone.
