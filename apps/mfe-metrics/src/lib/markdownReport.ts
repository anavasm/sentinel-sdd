import type { Audit, Severity } from '@sentinel/contracts';

const SEVERITIES: readonly Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeMarkdownText(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/[\\`*_{}[\]<>#+.!|]/g, '\\$&');
}

function codeFence(content: string): string {
  const longestBacktickRun = Math.max(...(content.match(/`+/g) ?? []).map((run) => run.length), 0);
  return '`'.repeat(Math.max(3, longestBacktickRun + 1));
}

export function createMarkdownReport(audit: Audit): string {
  const findings = audit.findings ?? [];
  const counts: Record<Severity, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
  };
  findings.forEach(({ severity }) => {
    counts[severity] += 1;
  });
  const summary = isRecord(audit.summary) ? audit.summary : {};
  const lines = [
    '# Audit report',
    '',
    `- **Audit ID:** ${escapeMarkdownText(audit.auditId)}`,
    `- **Status:** ${audit.status}`,
    `- **Created:** ${escapeMarkdownText(audit.createdAt)}`,
    '',
    '## Summary',
    '',
    `- **Findings:** ${findings.length}`,
    ...SEVERITIES.map((severity) => `- **${severity}:** ${counts[severity]}`),
  ];

  if (typeof summary.healthScore === 'number' && Number.isFinite(summary.healthScore)) {
    lines.push(`- **Health score:** ${summary.healthScore}/100`);
  }
  if (typeof summary.rulesEvaluated === 'number' && Number.isFinite(summary.rulesEvaluated)) {
    lines.push(`- **Rules evaluated:** ${summary.rulesEvaluated}`);
  }
  if (typeof summary.durationSeconds === 'number' && Number.isFinite(summary.durationSeconds)) {
    lines.push(`- **Duration:** ${summary.durationSeconds} seconds`);
  }
  if (audit.status === 'failed' && typeof summary.error === 'string') {
    lines.push(`- **Failure reason:** ${escapeMarkdownText(summary.error)}`);
  }

  lines.push('', '## Findings', '');
  if (findings.length === 0) {
    lines.push('No findings were reported.');
  } else {
    findings.forEach((finding, index) => {
      const fence = codeFence(`${finding.beforeSnippet}\n${finding.afterSnippet}`);
      lines.push(
        `### ${index + 1}. [${finding.severity}] ${escapeMarkdownText(finding.title)}`,
        '',
        `- **Rule:** ${escapeMarkdownText(finding.ruleId)}`,
        `- **Location:** ${escapeMarkdownText(finding.filePath)}${finding.lineNumber === undefined ? '' : `:${finding.lineNumber}`}`,
      );
      if (finding.cweId !== undefined) {
        lines.push(`- **CWE:** ${escapeMarkdownText(finding.cweId)}`);
      }
      lines.push(
        '',
        escapeMarkdownText(finding.description),
        '',
        '**Before**',
        '',
        `${fence}text`,
        finding.beforeSnippet,
        fence,
        '',
        '**Suggested After (for manual review)**',
        '',
        `${fence}text`,
        finding.afterSnippet,
        fence,
        '',
      );
    });
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export function markdownReportFilename(auditId: string): string {
  const safeAuditId = auditId.replace(/[^a-zA-Z0-9_-]/g, '') || 'audit';
  return `sentinel-audit-${safeAuditId}.md`;
}
