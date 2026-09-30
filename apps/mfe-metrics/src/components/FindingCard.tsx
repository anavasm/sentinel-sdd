/**
 * One actionable finding as a card (US-4 Task 4.3 preview / US-5 substrate):
 * severity badge, rule metadata, file/line location, and side-by-side
 * Before/After code snippets — monospace, red/green accented (§5.5: findings
 * without fixes are incomplete output).
 */
import type { JSX } from 'react';
import type { Finding } from '@sentinel/contracts';
import { SEVERITY_BADGE } from '../lib/badgeStyles';

export interface FindingCardProps {
  readonly finding: Finding;
}

export function FindingCard({ finding }: FindingCardProps): JSX.Element {
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
    </article>
  );
}
