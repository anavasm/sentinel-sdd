import type { Audit } from '@sentinel/contracts';
import { describe, expect, it } from 'vitest';
import { createMarkdownReport, markdownReportFilename } from '../src/lib/markdownReport';
import { AUDIT_ID, findingEvent } from './mocks/fixtures';

function makeAudit(overrides: Partial<Audit> = {}): Audit {
  return {
    auditId: AUDIT_ID,
    status: 'completed',
    config: {
      localPath: '/tmp/repository',
      ruleSets: {
        owaspTop10: true,
        testQuality: true,
        codeSmellsPerformance: true,
      },
      severityThreshold: 'LOW',
    },
    createdAt: '2026-11-12T10:00:00.000Z',
    findings: [],
    lastEventId: 0,
    firstAvailableEventId: null,
    ...overrides,
  };
}

describe('createMarkdownReport', () => {
  it('exports the terminal summary and every finding with code-fence-safe snippets', () => {
    const report = createMarkdownReport(
      makeAudit({
        findings: [
          {
            ...findingEvent(1, 'HIGH', {
              title: 'Unsafe [query]',
              beforeSnippet: 'const query = `SELECT ``` FROM users`;',
              afterSnippet: 'const query = parameterizedQuery;',
            }).payload,
            eventId: 12,
          },
          {
            ...findingEvent(2, 'LOW', { ruleId: 'style-1' }).payload,
            eventId: 13,
          },
        ],
        summary: { healthScore: 84, rulesEvaluated: 9, durationSeconds: 2 },
        lastEventId: 13,
      }),
    );

    expect(report).toContain(`- **Audit ID:** ${AUDIT_ID.replace('_', '\\_')}`);
    expect(report).toContain('- **Status:** completed');
    expect(report).toContain('- **Health score:** 84/100');
    expect(report).toContain('- **Rules evaluated:** 9');
    expect(report).toContain('- **Duration:** 2 seconds');
    expect(report).toContain('- **HIGH:** 1');
    expect(report).toContain('- **LOW:** 1');
    expect(report).toContain('### 1. [HIGH] Unsafe \\[query\\]');
    expect(report).toContain('````text\nconst query = `SELECT ``` FROM users`;\n````');
    expect(report).toContain('### 2. [LOW] SQL Injection in user lookup');
  });

  it('reports an empty result without fabricating optional summary values', () => {
    const report = createMarkdownReport(makeAudit());

    expect(report).toContain('No findings were reported.');
    expect(report).toContain('- **Findings:** 0');
    expect(report).toContain('- **CRITICAL:** 0');
    expect(report).not.toContain('Health score:');
  });

  it('includes a failed audit reason when the snapshot provides one', () => {
    const report = createMarkdownReport(
      makeAudit({ status: 'failed', summary: { error: 'Runner `failed`' } }),
    );

    expect(report).toContain('- **Failure reason:** Runner \\`failed\\`');
  });
});

describe('markdownReportFilename', () => {
  it('sanitizes the audit identifier before creating the download name', () => {
    expect(markdownReportFilename('aud_test-01')).toBe('sentinel-audit-aud_test-01.md');
    expect(markdownReportFilename('../../')).toBe('sentinel-audit-audit.md');
  });
});
