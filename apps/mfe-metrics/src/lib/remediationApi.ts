/**
 * Remediation API client (US-5, D-API-1): typed helper that asks the Agent
 * Engine to apply the After snippet of one finding under an active audit
 * (POST /audits/{auditId}/findings/remediate, specs/openapi.yaml
 * operationId: remediateFinding).
 *
 * Transport is the shared `createApiFetch` from @sentinel/contracts, so every
 * non-2xx response is already normalized into an `ApiProblemError` carrying
 * the RFC 9457 Problem (D-2) — the card renders `problem.detail`/`errors[]`
 * instead of raw HTTP failures.
 *
 * Kept as a factory (like createApiFetch) so each workspace resolves
 * `import.meta.env.VITE_API_BASE_URL` in its own bundle; the component wires
 * the env value in via props-free module constant, tests inject their own.
 */
import { createApiFetch, type ApiFetch } from '@sentinel/contracts';
import type { Finding, RemediationResult } from '@sentinel/contracts';

const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';

export interface RemediationApi {
  /**
   * Applies the fix for `finding` under audit `auditId`.
   * Resolves with the server outcome; rejects with `ApiProblemError` or
   * `UnparseableProblemError` for any non-2xx response. Pass `signal` to
   * abort an in-flight request (e.g. on component unmount).
   */
  applyFix(
    auditId: string,
    finding: Finding,
    options?: { signal?: AbortSignal },
  ): Promise<RemediationResult>;
}

/** Builds a remediation client bound to one API base URL (DI for tests). */
export function createRemediationApi(apiFetch: ApiFetch): RemediationApi {
  return {
    async applyFix(
      auditId: string,
      finding: Finding,
      options?: { signal?: AbortSignal },
    ): Promise<RemediationResult> {
      return apiFetch<RemediationResult>(
        `/audits/${encodeURIComponent(auditId)}/findings/remediate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(toFindingLocator(finding)),
          ...(options?.signal !== undefined && { signal: options.signal }),
        },
      );
    },
  };
}

/** Default client bound to this workspace's API base URL. */
export const remediationApi: RemediationApi = createRemediationApi(
  createApiFetch(API_BASE_URL),
);

/** Extracts the wire locator from a finding (Finding has no stable id). */
function toFindingLocator(finding: Finding): {
  ruleId: string;
  filePath: string;
  lineNumber?: number;
} {
  return {
    ruleId: finding.ruleId,
    filePath: finding.filePath,
    ...(finding.lineNumber !== undefined && { lineNumber: finding.lineNumber }),
  };
}
