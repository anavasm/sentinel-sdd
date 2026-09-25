import { randomBytes } from 'node:crypto';

import type { Audit, AuditConfig, AuditStatus } from '@sentinel/contracts';

/**
 * In-memory audit lifecycle store (ASD §8.1).
 *
 * Maps auditId → Audit inside the Express process. No database, no
 * migrations; server restart loses all session state (documented PoC
 * limitation). Lifecycle transitions and findings accumulation land in US-3.
 */

/** Length of the random alphanumeric audit id suffix. */
const AUDIT_ID_SUFFIX_LENGTH = 12;

/** Characters allowed by the openapi pattern `^aud_[0-9a-zA-Z]+$`. */
const AUDIT_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

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
  };

  audits.set(audit.auditId, audit);
  return audit;
}

/** Looks up an audit by id; `undefined` when unknown. */
export function findAuditById(auditId: string): Audit | undefined {
  return audits.get(auditId);
}

/** Clears the store — test isolation helper (in-memory by design, ASD §8.1). */
export function resetAuditStore(): void {
  audits.clear();
}
