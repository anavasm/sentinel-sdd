/**
 * Contract-derived client-side validation for the audit launch form
 * (US-2 Task 2.1 / D-WEB-4 / ADR-007). The rules mirror what the backend
 * enforces on AuditConfig (specs/openapi.yaml) so invalid requests fail fast
 * client-side — no network call is made for a config the server must reject:
 *   - repoUrl XOR localPath (exactly one repository source)
 *   - repoUrl must be a valid URI (format: uri)
 *   - ruleSets: at least one true (additionalProperties: false server-side)
 */
import type { AuditConfig, Severity } from '@sentinel/contracts';

export const SEVERITY_OPTIONS: readonly Severity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export const DEFAULT_SEVERITY_THRESHOLD: Severity = 'MEDIUM';

/** Which repository source the form is currently collecting. */
export type RepoSourceMode = 'git' | 'local';

export interface RuleSetFlags {
  readonly owaspTop10: boolean;
  readonly testQuality: boolean;
  readonly codeSmellsPerformance: boolean;
}

export interface AuditFormValues {
  readonly repoSourceMode: RepoSourceMode;
  readonly repoUrl: string;
  readonly localPath: string;
  readonly ruleSets: RuleSetFlags;
  readonly severityThreshold: Severity;
}

/** Client-side validation errors keyed by form field (US2-AC2, fail fast). */
export type AuditFormErrors = Partial<Record<'repoUrl' | 'localPath' | 'ruleSets' | 'severityThreshold', string>>;

/**
 * Fail-fast client-side validation against the same contract rules the
 * backend enforces. Returns one message per invalid field; an empty record
 * means the payload may be built and sent.
 */
export function validateAuditFormValues(values: AuditFormValues): AuditFormErrors {
  const errors: AuditFormErrors = {};

  if (values.repoSourceMode === 'git') {
    const trimmedRepoUrl = values.repoUrl.trim();
    if (trimmedRepoUrl === '') {
      errors.repoUrl = 'Repository URL is required.';
    } else if (!isValidUri(trimmedRepoUrl)) {
      errors.repoUrl = 'Repository URL must be a valid URI (e.g. https://github.com/example/repo.git).';
    }
  } else {
    const trimmedLocalPath = values.localPath.trim();
    if (trimmedLocalPath === '') {
      errors.localPath = 'Local repository path is required.';
    }
  }

  const hasEnabledRuleSet = Object.values(values.ruleSets).some(Boolean);
  if (!hasEnabledRuleSet) {
    errors.ruleSets = 'Select at least one rule set.';
  }

  return errors;
}

/** Builds the POST /audits payload; only the active repo source is included. */
export function buildAuditConfigPayload(values: AuditFormValues): AuditConfig {
  return {
    ...(values.repoSourceMode === 'git' ? { repoUrl: values.repoUrl.trim() } : { localPath: values.localPath.trim() }),
    ruleSets: { ...values.ruleSets },
    severityThreshold: values.severityThreshold,
  };
}

/** Maps `Problem.errors[]` field names onto form fields (US2-AC3). */
export function toFieldErrorsFromProblem(
  problemErrors: readonly { field: string; message: string }[] | undefined,
): AuditFormErrors {
  const errors: AuditFormErrors = {};
  for (const problemError of problemErrors ?? []) {
    if (isFormFieldKey(problemError.field) && errors[problemError.field] === undefined) {
      errors[problemError.field] = problemError.message;
    }
  }
  return errors;
}

function isFormFieldKey(field: string): field is keyof AuditFormErrors {
  return field === 'repoUrl' || field === 'localPath' || field === 'ruleSets' || field === 'severityThreshold';
}

function isValidUri(candidate: string): boolean {
  try {
    new URL(candidate);
    return true;
  } catch {
    return false;
  }
}
