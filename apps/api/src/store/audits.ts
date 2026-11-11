import { randomBytes } from 'node:crypto';

import type {
  Audit,
  AuditConfig,
  AuditStatus,
  AuditFinding,
  SentinelAISSEEventContract,
} from '@sentinel/contracts';

/**
 * In-memory audit lifecycle store (ASD §8.1).
 *
 * Maps auditId → Audit inside the Express process. No database, no
 * migrations; server restart loses all session state (documented PoC
 * limitation). Lifecycle: `queued → running → completed | failed`;
 * terminal states have no outgoing transitions (openapi `Audit` semantics).
 */

/** Length of the random alphanumeric audit id suffix. */
const AUDIT_ID_SUFFIX_LENGTH = 12;

/** Characters allowed by the openapi pattern `^aud_[0-9a-zA-Z]+$`. */
const AUDIT_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** openapi `auditId` pattern — shared by id generation and path-param validation. */
export const AUDIT_ID_PATTERN = /^aud_[0-9a-zA-Z]+$/;

/** Allowed lifecycle edges (openapi `AuditStatus` semantics; terminal states have none). */
const VALID_TRANSITIONS: Readonly<Record<AuditStatus, readonly AuditStatus[]>> = {
  queued: ['running'],
  running: ['completed', 'failed'],
  completed: [],
  failed: [],
};

const audits = new Map<string, Audit>();

/** Generates an audit id matching the openapi pattern `^aud_[0-9a-zA-Z]+$`. */
export function generateAuditId(): string {
  const randomBytesBuffer = randomBytes(AUDIT_ID_SUFFIX_LENGTH);
  let suffix = '';
  for (const byte of randomBytesBuffer) {
    suffix += AUDIT_ID_ALPHABET[byte % AUDIT_ID_ALPHABET.length];
  }
  return `aud_${suffix}`;
}

export interface CreateAuditInput {
  readonly config: AuditConfig;
  readonly generateId?: () => string;
}

/** Persists a new audit in `queued` state and returns the stored record. */
export function createAudit({ config, generateId = generateAuditId }: CreateAuditInput): Audit {
  const audit: Audit = {
    auditId: generateId(),
    status: 'queued' satisfies AuditStatus,
    config,
    createdAt: new Date().toISOString(),
    findings: [],
    lastEventId: 0,
    firstAvailableEventId: null,
  };

  audits.set(audit.auditId, audit);
  return audit;
}

/** Looks up an audit by id; `undefined` when unknown. */
export function findAuditById(auditId: string): Audit | undefined {
  return audits.get(auditId);
}

/**
 * Moves an audit along `queued → running → completed | failed`.
 *
 * Returns the updated audit, or `undefined` when the id is unknown. A
 * transition that violates the lifecycle graph is a caller bug (the runner
 * is the only producer), so it throws instead of returning a silent no-op.
 */
export function transitionAuditStatus(auditId: string, nextStatus: AuditStatus): Audit | undefined {
  const audit = audits.get(auditId);
  if (audit === undefined) {
    return undefined;
  }
  if (!VALID_TRANSITIONS[audit.status].includes(nextStatus)) {
    throw new Error(
      `Invalid audit lifecycle transition ${audit.status} -> ${nextStatus} for audit ${auditId}.`,
    );
  }

  audit.status = nextStatus;
  return audit;
}

/**
 * Accumulates findings from stream events onto the audit.
 *
 * Returns the updated audit, or `undefined` when the id is unknown.
 * Once a terminal status is reached the findings set is complete; callers
 * must not append afterwards (guard throws — terminal audits are frozen).
 */
export function appendFindings(
  auditId: string,
  newFindings: readonly AuditFinding[],
): Audit | undefined {
  const audit = audits.get(auditId);
  if (audit === undefined) {
    return undefined;
  }
  if (audit.status === 'completed' || audit.status === 'failed') {
    throw new Error(`Cannot append findings to terminal audit ${auditId} (${audit.status}).`);
  }

  audit.findings = [...(audit.findings ?? []), ...newFindings];
  return audit;
}

/**
 * Applies one validated hub event and its replay-window watermark to the audit
 * snapshot in one synchronous store operation.
 */
export function recordAuditEvent(
  auditId: string,
  event: SentinelAISSEEventContract,
  firstAvailableEventId: number,
): Audit | undefined {
  const audit = audits.get(auditId);
  if (audit === undefined) {
    return undefined;
  }
  if (event.id !== audit.lastEventId + 1) {
    throw new Error(
      `Invalid audit event sequence ${event.id} after ${audit.lastEventId} for audit ${auditId}.`,
    );
  }
  if (
    !Number.isInteger(firstAvailableEventId)
    || firstAvailableEventId < 1
    || firstAvailableEventId > event.id
    || (audit.firstAvailableEventId !== null && firstAvailableEventId < audit.firstAvailableEventId)
  ) {
    throw new Error(`Invalid replay window watermark for audit ${auditId}.`);
  }

  if (audit.status === 'queued') {
    transitionAuditStatus(auditId, 'running');
  }
  if (event.type === 'VULNERABILITY_FOUND') {
    appendFindings(auditId, [{ ...event.payload, eventId: event.id }]);
  }
  if (event.type === 'AUDIT_COMPLETED') {
    transitionAuditStatus(auditId, event.payload.status === 'failed' ? 'failed' : 'completed');
    audit.summary = {
      ...(event.payload.summary ?? {}),
      ...(event.payload.healthScore !== undefined ? { healthScore: event.payload.healthScore } : {}),
      ...(event.payload.error !== undefined ? { error: event.payload.error } : {}),
    };
  }

  audit.lastEventId = event.id;
  audit.firstAvailableEventId = firstAvailableEventId;
  return audit;
}

/**
 * Sets the final summary on a terminal audit (`completed` | `failed`,
 * openapi: "present once status is completed or failed").
 *
 * Returns the updated audit, or `undefined` when the id is unknown.
 * Setting a summary on a non-terminal audit is a caller bug and throws.
 */
export function setAuditSummary(
  auditId: string,
  summary: Record<string, unknown>,
): Audit | undefined {
  const audit = audits.get(auditId);
  if (audit === undefined) {
    return undefined;
  }
  if (audit.status !== 'completed' && audit.status !== 'failed') {
    throw new Error(
      `Summary can only be set on terminal audits; audit ${auditId} is ${audit.status}.`,
    );
  }

  audit.summary = summary;
  return audit;
}

/** Clears the store — test isolation helper (in-memory by design, ASD §8.1). */
export function resetAuditStore(): void {
  audits.clear();
}
