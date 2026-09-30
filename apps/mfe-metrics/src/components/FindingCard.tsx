/**
 * One actionable finding as a card (US-4 Task 4.3 / US-5 remediation):
 * severity badge, rule metadata, file/line location, side-by-side
 * Before/After code snippets, and an "Apply Fix" action that asks the Agent
 * Engine to apply the After snippet (POST /audits/{id}/findings/remediate).
 *
 * Remediation status machine per finding: idle → applying → applied | failed.
 * Failures surface the RFC 9457 Problem detail (D-2) carried by
 * ApiProblemError; in-flight requests are aborted on unmount so state is
 * never set on a removed card.
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import type { Finding } from '@sentinel/contracts';
import { ApiProblemError, UnparseableProblemError } from '@sentinel/contracts';
import { SEVERITY_BADGE } from '../lib/badgeStyles';
import { remediationApi } from '../lib/remediationApi';

/** Lifecycle of one finding's patch application (US-5). */
type RemediationStatus = 'idle' | 'applying' | 'applied' | 'failed';

export interface FindingCardProps {
  readonly finding: Finding;
  /** Active audit owning the finding; remediation is only offered when present. */
  readonly auditId?: string | undefined;
}

/** Contextual failure text from any remediation error shape (RFC 9457 first). */
export function describeRemediationError(error: unknown): string {
  if (error instanceof ApiProblemError) {
    const fieldErrorMessages = error.problem.errors
      ?.map((fieldError) => fieldError.message)
      .join('; ');
    return error.problem.detail ?? fieldErrorMessages ?? error.problem.title ?? 'Patch rejected by the API';
  }
  if (error instanceof UnparseableProblemError) {
    return `Patch failed — API responded ${error.status} with an unexpected body`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Patch failed for an unknown reason';
}

export function FindingCard({ finding, auditId }: FindingCardProps): JSX.Element {
  const [remediationStatus, setRemediationStatus] = useState<RemediationStatus>('idle');
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const inFlightControllerRef = useRef<AbortController | null>(null);

  // Abort any in-flight remediation request when the card unmounts, so a
  // late response never calls setState on a removed card.
  useEffect(() => {
    return () => {
      inFlightControllerRef.current?.abort();
    };
  }, []);

  const isActionable = auditId !== undefined && finding.afterSnippet.trim().length > 0;

  async function handleApplyFix(): Promise<void> {
    if (auditId === undefined) {
      return;
    }
    const requestController = new AbortController();
    inFlightControllerRef.current = requestController;
    setRemediationStatus('applying');
    setFailureMessage(null);

    try {
      const result = await remediationApi.applyFix(auditId, finding, {
        signal: requestController.signal,
      });
      if (requestController.signal.aborted) {
        return;
      }
      if (result.status === 'applied') {
        setRemediationStatus('applied');
        return;
      }
      // 200 with status 'failed': the patch engine refused the hunk.
      setRemediationStatus('failed');
      setFailureMessage(result.message);
    } catch (error: unknown) {
      if (requestController.signal.aborted) {
        return;
      }
      setRemediationStatus('failed');
      setFailureMessage(describeRemediationError(error));
    }
  }

  return (
    <article
      data-testid="finding-card"
      className="rounded-lg border border-slate-700 bg-sentinel-panel p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          data-testid="finding-severity"
          className={`rounded border px-2 py-0.5 text-xs font-semibold ${SEVERITY_BADGE[finding.severity]}`}
        >
          {finding.severity}
        </span>
        <h3 className="text-sm font-semibold text-slate-100">{finding.title}</h3>
        <span className="font-mono text-xs text-slate-400">{finding.ruleId}</span>
      </div>

      <p className="mt-1 font-mono text-xs text-slate-400">
        {finding.filePath}
        {finding.lineNumber !== undefined && `:${finding.lineNumber}`}
        {finding.cweId !== undefined && (
          <span className="ml-2 rounded bg-slate-700/60 px-1.5 py-0.5">{finding.cweId}</span>
        )}
      </p>

      <p className="mt-2 text-sm text-slate-300">{finding.description}</p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div data-testid="finding-before">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-300">Before</p>
          <pre className="overflow-x-auto rounded border border-red-500/40 bg-red-500/10 p-2 font-mono text-xs text-red-200">
            <code>{finding.beforeSnippet}</code>
          </pre>
        </div>
        <div data-testid="finding-after">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-300">
            After
          </p>
          <pre className="overflow-x-auto rounded border border-emerald-500/40 bg-emerald-500/10 p-2 font-mono text-xs text-emerald-200">
            <code>{finding.afterSnippet}</code>
          </pre>
        </div>
      </div>

      {isActionable && (
        <div className="mt-3 flex items-center gap-3">
          {remediationStatus === 'applied' ? (
            <span
              data-testid="remediation-applied"
              className="rounded border border-emerald-500/50 bg-emerald-500/15 px-2 py-1 text-xs font-semibold text-emerald-300"
            >
              ✓ Fix Applied
            </span>
          ) : (
            <button
              type="button"
              data-testid="apply-fix-button"
              onClick={handleApplyFix}
              disabled={remediationStatus === 'applying'}
              className="rounded border border-sentinel-accent/50 bg-sentinel-accent/15 px-3 py-1.5 text-xs font-semibold text-sentinel-accent transition-colors hover:bg-sentinel-accent/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {remediationStatus === 'applying' ? 'Applying…' : 'Apply Fix'}
            </button>
          )}

          {failureMessage !== null && (
            <p role="alert" data-testid="remediation-error" className="text-xs text-red-300">
              {failureMessage}
            </p>
          )}
        </div>
      )}
    </article>
  );
}
