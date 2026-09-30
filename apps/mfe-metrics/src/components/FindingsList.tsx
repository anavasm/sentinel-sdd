/**
 * Live findings feed (US-4 Task 4.3): every `VULNERABILITY_FOUND` event as a
 * `FindingCard`, appended in arrival order and persisted until terminal.
 */
import type { JSX } from 'react';
import type { Finding } from '@sentinel/contracts';
import { FindingCard } from './FindingCard';

export interface FindingsListProps {
  readonly findings: readonly Finding[];
  /** Active audit owning the findings; forwarded to enable remediation (US-5). */
  readonly auditId?: string | undefined;
}

export function FindingsList({ findings, auditId }: FindingsListProps): JSX.Element {
  if (findings.length === 0) {
    return (
      <p className="rounded-lg border border-slate-700/60 bg-slate-800/40 p-4 text-sm text-slate-400">
        Findings will appear here as the agent reports them.
      </p>
    );
  }

  return (
    <div className="space-y-3" data-testid="findings-list" aria-label="Vulnerability findings">
      {findings.map((finding) => (
        <FindingCard
          key={`${finding.ruleId}-${finding.filePath}-${finding.lineNumber ?? 'nolines'}`}
          finding={finding}
          auditId={auditId}
        />
      ))}
    </div>
  );
}
