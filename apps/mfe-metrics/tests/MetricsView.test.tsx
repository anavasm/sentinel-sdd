/**
 * MetricsView surface tests (US-3): route-param consumption, connection status
 * badge, and live timeline indicator, driven through the MockEventSource
 * installed in tests/setup.ts.
 */
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { SentinelAISSEEventContract } from '@sentinel/contracts';
import { MetricsView } from '../src/MetricsView';
import { MockEventSource } from './mocks/eventSource';

const AUDIT_ID = 'aud_view001';

/** Mounts MetricsView under a router at /audits/:auditId (host routing, ADR-005). */
function renderMetricsView(auditPath: string): void {
  render(
    <MemoryRouter initialEntries={[auditPath]}>
      <Routes>
        <Route path="/audits/:auditId" element={<MetricsView />} />
        <Route path="/" element={<MetricsView />} />
      </Routes>
    </MemoryRouter>,
  );
}

function emitEvent(event: SentinelAISSEEventContract): void {
  MockEventSource.lastInstance?.simulateOpen();
  MockEventSource.lastInstance?.emit(event.type, JSON.stringify(event));
}

function thoughtEvent(id: number): SentinelAISSEEventContract {
  return {
    id,
    type: 'AGENT_THOUGHT',
    timestamp: `2026-09-23T10:00:0${id}.000Z`,
    auditId: AUDIT_ID,
    payload: { content: `Reasoning step ${id}` },
  };
}

function completedEvent(id: number): SentinelAISSEEventContract {
  return {
    id,
    type: 'AUDIT_COMPLETED',
    timestamp: '2026-09-23T10:02:00.000Z',
    auditId: AUDIT_ID,
    payload: { status: 'completed', healthScore: 72 },
  };
}

function expectBadge(label: string): void {
  expect(screen.getByTestId('stream-status-badge')).toHaveTextContent(label);
}

describe('mfe-metrics MetricsView', () => {
  it('mounts and renders its heading', () => {
    renderMetricsView('/');

    expect(screen.getByRole('heading', { name: 'Audit Execution Metrics' })).toBeInTheDocument();
  });

  it('shows Connecting while the stream is opening', () => {
    renderMetricsView(`/audits/${AUDIT_ID}`);

    expectBadge('Connecting');
    expect(MockEventSource.lastInstance?.url).toContain(`/audits/${AUDIT_ID}/stream`);
  });

  it('shows the live badge once the stream opens', () => {
    renderMetricsView(`/audits/${AUDIT_ID}`);

    act(() => {
      MockEventSource.lastInstance?.simulateOpen();
    });

    expectBadge('Live stream active');
  });

  it('renders the live timeline as events arrive', () => {
    renderMetricsView(`/audits/${AUDIT_ID}`);

    act(() => {
      emitEvent(thoughtEvent(1));
      emitEvent(thoughtEvent(2));
    });

    expect(screen.getByTestId('live-event-timeline').children).toHaveLength(2);
    expect(screen.getByText('Live timeline (2 events)')).toBeInTheDocument();
    expectBadge('Live stream active');
  });

  it('shows Completed and stops the stream on AUDIT_COMPLETED', () => {
    renderMetricsView(`/audits/${AUDIT_ID}`);
    const eventSource = MockEventSource.lastInstance;

    act(() => {
      emitEvent(thoughtEvent(1));
      emitEvent(completedEvent(2));
    });

    expectBadge('Completed');
    expect(eventSource?.close).toHaveBeenCalledTimes(1);
  });

  it('shows Connection error on transport failure', () => {
    renderMetricsView(`/audits/${AUDIT_ID}`);

    act(() => {
      MockEventSource.lastInstance?.simulateError();
    });

    expectBadge('Connection error');
  });
});
