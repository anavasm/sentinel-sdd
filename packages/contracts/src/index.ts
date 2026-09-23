/**
 * Shared contracts barrel.
 *
 * Types are generated from /specs (see package.json scripts):
 *  - api-schema.d.ts  ← specs/openapi.yaml       (openapi-typescript)
 *  - events.d.ts      ← specs/events-schema.json (json-schema-to-typescript)
 *
 * Downstream apps import from here; contract changes force a regeneration
 * (drift is impossible by construction — docs/asd/08-data-architecture.md §8.3).
 */

// ── Events (specs/events-schema.json) ────────────────────────────────────────
export type {
  SentinelAISSEEventContract,
  AgentThoughtEvent,
  ToolExecutionEvent,
  VulnerabilityFoundEvent,
  AuditCompletedEvent,
  CommonEnvelope,
  EventType,
} from './generated/events.js';

// ── API (specs/openapi.yaml) ─────────────────────────────────────────────────
import type { components } from './generated/api-schema.d.ts';

/** Audit launch configuration (repoUrl XOR localPath). */
export type AuditConfig = components['schemas']['AuditConfig'];
/** Full audit resource incl. lifecycle status and findings. */
export type Audit = components['schemas']['Audit'];
/** Response of POST /api/v1/audits. */
export type AuditCreated = components['schemas']['AuditCreated'];
/** One actionable finding with Before/After snippets. */
export type Finding = components['schemas']['Finding'];
/** Severity levels used for thresholds and findings. */
export type Severity = components['schemas']['Severity'];
/** Audit lifecycle state. */
export type AuditStatus = components['schemas']['AuditStatus'];
/** RFC 9457 Problem Details — single error model for all REST failures. */
export type Problem = components['schemas']['Problem'];
