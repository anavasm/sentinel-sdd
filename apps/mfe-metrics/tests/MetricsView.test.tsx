/**
 * MetricsView integration tests (US-4): the dashboard assembles header, tabs,
 * timeline and findings while the SSE stream transitions
 * CONNECTING → thoughts → findings → AUDIT_COMPLETED.
 */
import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { MetricsView } from '../src/MetricsView';
import { MockEventSource } from './mocks/eventSource';
import {
  AUDIT_ID,
  completedEvent,
  emitStreamEvent,
  findingEvent,
  thoughtEvent,
  toolExecutionEvent,
} from './mocks/fixtures';

function renderMetricsView(auditPath: string): void {
  render(
    <MemoryRouter initialEntries={[auditPath]}>
      {/* MetricsView reads `auditId` from useParams; the route must be declared
          for the hook to receive it and open the (mock) EventSource. */}
      <Routes>
        <Route path="/audits/:auditId" element={<MetricsView />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('mfe-metrics MetricsView', () => {
  it('mounts with the summary header and Timeline tab active by default', () => {
    renderMetricsView(`/audits/${AUDIT_ID}`);

    expect(screen.getByRole('heading', { name: 'Audit Execution Metrics' })).toBeInTheDocument();
    expect(screen.getByTestId('tab-Timeline')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('stream-status-badge')).toHaveTextContent('Connecting');
    expect(screen.getByText(/timeline will appear here/i)).toBeInTheDocument();
  });

  it('streams thoughts into the timeline as they arrive', () => {
    renderMetricsView(`/audits/${AUDIT_ID}`);

    act(() => {
      emitStreamEvent(thoughtEvent(1, 'Planning the audit', 'clone'));
      emitStreamEvent(toolExecutionEvent(2, 'succeeded'));
    });

    expect(screen.getByTestId('stream-status-badge')).toHaveTextContent('Live stream active');
    expect(screen.getByTestId('event-timeline').children).toHaveLength(2);
    expect(screen.getByText('Planning the audit')).toBeInTheDocument();
  });

  it('shows findings under the Findings tab with severity badges', () => {
    renderMetricsView(`/audits/${AUDIT_ID}`);

    act(() => {
      emitStreamEvent(findingEvent(1, 'HIGH'));
    });
    act(() => {
      screen.getByTestId('tab-Findings').click();
    });

    const findingsPanel = screen.getByLabelText('Findings panel');
    expect(within(findingsPanel).getAllByTestId('finding-card')).toHaveLength(1);
    expect(
      within(findingsPanel).getByTestId('finding-severity'),
    ).toHaveTextContent('HIGH');
    expect(screen.getByTestId('findings-counter-HIGH')).toHaveTextContent('1 HIGH');
  });

  it('renders every event type in the All Events tab', () => {
    renderMetricsView(`/audits/${AUDIT_ID}`);

    act(() => {
      emitStreamEvent(thoughtEvent(1));
      emitStreamEvent(toolExecutionEvent(2, 'started'));
      emitStreamEvent(findingEvent(3, 'LOW'));
    });
    act(() => {
      screen.getByTestId('tab-All Events').click();
    });

    const allEventsPanel = screen.getByLabelText('All events panel');
    expect(within(allEventsPanel).getAllByRole('listitem')).toHaveLength(3);
    expect(within(allEventsPanel).getByText('VULNERABILITY_FOUND')).toBeInTheDocument();
  });

  it('completes the stream: badge → Completed, health score visible', () => {
    renderMetricsView(`/audits/${AUDIT_ID}`);

    act(() => {
      emitStreamEvent(findingEvent(1, 'MEDIUM'));
      emitStreamEvent(completedEvent(2));
    });

    expect(screen.getByTestId('stream-status-badge')).toHaveTextContent('Completed');
    expect(screen.getByTestId('health-score')).toHaveTextContent('Health score: 72/100');
    expect(screen.getByText(/see the\s*Findings tab/i)).toBeInTheDocument();
  });

  it('shows the connection error badge on transport failure', () => {
    renderMetricsView(`/audits/${AUDIT_ID}`);

    act(() => {
      MockEventSource.lastInstance?.simulateError();
    });

    expect(screen.getByTestId('stream-status-badge')).toHaveTextContent('Connection error');
  });

  it('shows the failed-audit alert when the audit completes with failure', () => {
    renderMetricsView(`/audits/${AUDIT_ID}`);

    act(() => {
      emitStreamEvent(completedEvent(1, 'failed'));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Audit failed: Agent engine crashed mid-audit');
    expect(screen.getByTestId('stream-status-badge')).toHaveTextContent('Completed');
  });
});
