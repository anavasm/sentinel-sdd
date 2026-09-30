/**
 * AuditSummaryHeader tests (US-4): status badge, audit identity, severity
 * counters, health score, and the failed-audit alert.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SentinelAISSEEventContract } from '@sentinel/contracts';
import type { AuditStreamStatus } from '../src/hooks/useAuditStream';
import { AuditSummaryHeader } from '../src/components/AuditSummaryHeader';
import {
  AUDIT_ID,
  completedEvent,
  findingEvent,
  thoughtEvent,
  toolExecutionEvent,
} from './mocks/fixtures';

function renderHeader(events: SentinelAISSEEventContract[], status: AuditStreamStatus = 'CONNECTED'): void {
  render(<AuditSummaryHeader auditId={AUDIT_ID} status={status} events={events} />);
}

describe('AuditSummaryHeader', () => {
  it('shows the audit id and live badge', () => {
    renderHeader([]);

    expect(screen.getByText(AUDIT_ID)).toBeInTheDocument();
    expect(screen.getByTestId('stream-status-badge')).toHaveTextContent('Live stream active');
  });

  it('shows the Connecting badge before the stream opens', () => {
    renderHeader([], 'CONNECTING');

    expect(screen.getByTestId('stream-status-badge')).toHaveTextContent('Connecting');
  });

  it('shows the placeholder text when no findings have arrived', () => {
    renderHeader([thoughtEvent(1)]);

    expect(screen.getByText('No findings yet')).toBeInTheDocument();
  });

  it('counts findings per severity', () => {
    renderHeader([
      thoughtEvent(1),
      toolExecutionEvent(2, 'succeeded'),
      findingEvent(3, 'HIGH'),
      findingEvent(4, 'HIGH', { ruleId: 'owasp-a01', filePath: 'src/api.ts', lineNumber: 7 }),
      findingEvent(5, 'LOW', { ruleId: 'cs-101', filePath: 'src/util.ts', lineNumber: 9 }),
    ]);

    expect(screen.getByTestId('findings-counter-HIGH')).toHaveTextContent('2 HIGH');
    expect(screen.getByTestId('findings-counter-LOW')).toHaveTextContent('1 LOW');
    expect(screen.queryByTestId('findings-counter-MEDIUM')).not.toBeInTheDocument();
  });

  it('shows the health score once AUDIT_COMPLETED arrives', () => {
    renderHeader([findingEvent(1, 'HIGH'), completedEvent(2)]);

    expect(screen.getByTestId('health-score')).toHaveTextContent('Health score: 72/100');
    expect(screen.getByTestId('stream-status-badge')).toHaveTextContent('Live stream active');
  });

  it('renders the failure reason as an alert for failed audits', () => {
    renderHeader([completedEvent(1, 'failed')]);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Audit failed: Agent engine crashed mid-audit',
    );
    expect(screen.queryByTestId('health-score')).not.toBeInTheDocument();
  });

  it('respects the terminal DISCONNECTED badge', () => {
    // The hook sets DISCONNECTED on AUDIT_COMPLETED; header renders the badge.
    render(<AuditSummaryHeader auditId={AUDIT_ID} status="DISCONNECTED" events={[completedEvent(1)]} />);

    expect(screen.getByTestId('stream-status-badge')).toHaveTextContent('Completed');
  });
});
