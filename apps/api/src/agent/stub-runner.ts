import type {
  AgentThoughtEvent,
  AuditCompletedEvent,
  SentinelAISSEEventContract,
  ToolExecutionEvent,
  VulnerabilityFoundEvent,
} from '@sentinel/contracts';

import {
  agentThoughtEvent,
  auditCompletedEvent,
  auditFailedEvent,
  toolExecutionDegradedEvent,
  toolExecutionStartedEvent,
  toolExecutionSucceededEvent,
  vulnerabilityFoundEvent,
} from '@sentinel/contracts/fixtures';

import type { AuditRunner } from './runner.js';
import { emitAuditEvent } from '../sse/hub.js';
import { validateSentinelEvent } from '../lib/validators.js';

/**
 * Fixture-driven stub Audit Runner (plan US-4, Task 4.5 / D-API-3).
 *
 * Replays deterministic fixture sequences from `@sentinel/contracts` through
 * the SSE hub so the channel is fully testable before the real LLM-backed
 * runner lands (US-5). Every event is re-targeted to the live auditId,
 * re-stamped, and Ajv-validated against specs/events-schema.json before it
 * is pushed to the hub (the hub re-validates as validator of record).
 *
 * Execution starts on `setImmediate` so POST never blocks on the runner
 * (NFR-P1 / CONCERN-002), and events are spaced by a small delay so
 * consumers can connect mid-stream (live delivery, not instant replay).
 */

/** All fixture event types the stub runner can emit. */
type StubFixtureEvent =
  | AgentThoughtEvent
  | ToolExecutionEvent
  | VulnerabilityFoundEvent
  | AuditCompletedEvent;

/** Deterministic stub scenarios selectable per runner instance. */
export type StubRunnerScenario = 'happy-path' | 'failure';

/** Failure path: degrade → abort. Provider failure is an event, not an HTTP error (NFR-A3). */
const failureSequence: readonly StubFixtureEvent[] = [
  agentThoughtEvent,
  toolExecutionStartedEvent,
  toolExecutionDegradedEvent,
  auditFailedEvent,
];

const SCENARIOS: Readonly<Record<StubRunnerScenario, readonly StubFixtureEvent[]>> = {
  'happy-path': [
    agentThoughtEvent,
    toolExecutionStartedEvent,
    toolExecutionSucceededEvent,
    toolExecutionDegradedEvent,
    vulnerabilityFoundEvent,
    auditCompletedEvent,
  ],
  failure: failureSequence,
};

export interface StubRunnerOptions {
  /** Which fixture sequence to emit (default: the full happy path). */
  readonly scenario?: StubRunnerScenario;
  /** Delay in ms between consecutive events (default 10ms — live delivery). */
  readonly interEventDelayMs?: number;
  /** Scheduling seam; defaults to `setImmediate` (never blocks the response). */
  readonly schedule?: (callback: () => void) => void;
  /** Delay seam; defaults to `setTimeout` (injectable for tests). */
  readonly delay?: (ms: number) => Promise<void>;
}

/** Waits `ms` milliseconds (macro-task; lets SSE clients attach mid-run). */
function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Re-stamps a fixture event for the live audit: the fixture auditId is
 * replaced (NFR-S3 — envelope auditId must match the stream path) and the
 * timestamp is refreshed. The id is omitted; the hub assigns the
 * authoritative monotonic sequence (D-6).
 */
function retargetEvent(
  fixture: StubFixtureEvent,
  auditId: string,
): Omit<SentinelAISSEEventContract, 'id'> {
  return {
    type: fixture.type,
    timestamp: new Date().toISOString(),
    auditId,
    payload: fixture.payload,
  };
}

export class StubAuditRunner implements AuditRunner {
  private readonly scenario: StubRunnerScenario;
  private readonly interEventDelayMs: number;
  private readonly schedule: (callback: () => void) => void;
  private readonly delay: (ms: number) => Promise<void>;

  constructor(options: StubRunnerOptions = {}) {
    this.scenario = options.scenario ?? 'happy-path';
    this.interEventDelayMs = options.interEventDelayMs ?? 10;
    this.schedule = options.schedule ?? setImmediate;
    this.delay = options.delay ?? defaultDelay;
  }

  /** Async kickoff — the POST response is sent before any event is emitted. */
  run(auditId: string): void {
    this.schedule(() => {
      void this.execute(auditId);
    });
  }

  private async execute(auditId: string): Promise<void> {
    const fixtures: readonly StubFixtureEvent[] = SCENARIOS[this.scenario] ?? [];
    for (const fixture of fixtures) {
      const envelope = retargetEvent(fixture, auditId);

      // Every emitted event must satisfy the contract before reaching the hub.
      const candidate = { ...envelope, id: 1 } as SentinelAISSEEventContract;
      if (!validateSentinelEvent(candidate)) {
        const ajvErrors = validateSentinelEvent.errors
          ?.map((error) => `${error.instancePath} ${error.message ?? ''}`)
          .join('; ');
        console.error(
          `[stub-runner] contract-violating event dropped for audit ${auditId}: ${ajvErrors ?? 'unknown'}`,
        );
        continue;
      }

      emitAuditEvent(auditId, envelope);
      if (this.interEventDelayMs > 0) {
        await this.delay(this.interEventDelayMs);
      }
    }
  }
}
