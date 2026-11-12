import type { JSX } from 'react';
import type { Audit } from '@sentinel/contracts';
import { createMarkdownReport, markdownReportFilename } from '../lib/markdownReport';

export interface AuditReportExportProps {
  readonly audit: Audit | undefined;
}

export function AuditReportExport({ audit }: AuditReportExportProps): JSX.Element | null {
  if (audit === undefined || (audit.status !== 'completed' && audit.status !== 'failed')) {
    return null;
  }
  const terminalAudit = audit;

  function downloadReport(): void {
    const report = createMarkdownReport(terminalAudit);
    const objectUrl = URL.createObjectURL(
      new Blob([report], { type: 'text/markdown;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = markdownReportFilename(terminalAudit.auditId);
    document.body.append(link);
    try {
      link.click();
    } finally {
      link.remove();
      // Allow the browser to start reading the Blob URL before revoking it.
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }
  }

  return (
    <div className="mt-4 flex justify-end">
      <button
        type="button"
        onClick={downloadReport}
        className="rounded border border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-slate-700"
        data-testid="download-markdown-report"
      >
        Download Markdown report
      </button>
    </div>
  );
}
