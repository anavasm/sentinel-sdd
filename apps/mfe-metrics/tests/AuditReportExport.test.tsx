import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Audit } from '@sentinel/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditReportExport } from '../src/components/AuditReportExport';
import { AUDIT_ID, findingEvent } from './mocks/fixtures';

function makeAudit(status: Audit['status']): Audit {
  return {
    auditId: AUDIT_ID,
    status,
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
    findings: [{ ...findingEvent(1, 'HIGH').payload, eventId: 1 }],
    lastEventId: 1,
    firstAvailableEventId: 1,
    summary: { healthScore: 72 },
  };
}

describe('AuditReportExport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not offer an export until the snapshot is terminal', () => {
    const { rerender } = render(<AuditReportExport audit={undefined} />);
    expect(
      screen.queryByRole('button', { name: /download markdown report/i }),
    ).not.toBeInTheDocument();

    rerender(<AuditReportExport audit={makeAudit('running')} />);
    expect(
      screen.queryByRole('button', { name: /download markdown report/i }),
    ).not.toBeInTheDocument();
  });

  it('downloads the generated report from a terminal snapshot', async () => {
    const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:sentinel-report');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    try {
      render(<AuditReportExport audit={makeAudit('completed')} />);
      fireEvent.click(screen.getByRole('button', { name: 'Download Markdown report' }));

      expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      expect(click).toHaveBeenCalledOnce();
      await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:sentinel-report'));
      expect(document.querySelector('a[download="sentinel-audit-aud_dash001.md"]')).toBeNull();
      expect(createObjectURL.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    } finally {
      if (originalCreateObjectURL === undefined) {
        Reflect.deleteProperty(URL, 'createObjectURL');
      } else {
        Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL);
      }
      if (originalRevokeObjectURL === undefined) {
        Reflect.deleteProperty(URL, 'revokeObjectURL');
      } else {
        Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL);
      }
    }
  });

  it('allows downloading failed audits with their status included', () => {
    render(<AuditReportExport audit={makeAudit('failed')} />);
    expect(screen.getByRole('button', { name: 'Download Markdown report' })).toBeInTheDocument();
  });
});
