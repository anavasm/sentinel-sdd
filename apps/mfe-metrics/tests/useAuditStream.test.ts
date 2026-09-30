/**
 * `useAuditStream` behavior tests (US-3 Task 3.6 subset).
 *
 * The global EventSource is replaced by MockEventSource in tests/setup.ts;
 * tests simulate the SSE stream deterministically and assert the hook's
 * status machine, event accumulation, and resource cleanup.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  AgentThoughtEvent,
  SentinelAISSEEventContract,
  VulnerabilityFoundEvent,
} from '@sentinel/contracts';
import { useAuditStream } from '../src/hooks/useAuditStream';
import { MockEventSource } from './mocks/eventSource';

const AUDIT_ID = 'aud_test001';

function fixtureThought(id: number): AgentThoughtEvent {
  return {
    id,
    type: 'AGENT_THOUGHT',
    timestamp: `2026-09-23T10:00:0${id}.000Z`,
    auditId: AUDIT_ID,
    payload: { content: `Reasoning step ${id}`, step: 'analyze' },
  };
}

function fixtureFinding(id: number): VulnerabilityFoundEvent {
  return {
    id,
    type: 'VULNERABILITY_FOUND',
    timestamp: `2026-09-23T10:01:0${id}.000Z`,
    auditId: AUDIT_ID,
    payload: {
      ruleId: 'owasp-a03-injection',
      title: 'SQL Injection in user lookup',
      severity: 'HIGH',
      filePath: 'src/auth/queries.ts',
      lineNumber: 42,
      description: 'Unparameterized SQL query.',
      beforeSnippet: "db.query(`SELECT * FROM users WHERE id = '${userId}'`);",
      afterSnippet: 'db.query("SELECT * FROM users WHERE id = ?", [userId]);',
    },
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

function emitJson(event: SentinelAISSEEventContract): void {
  MockEventSource.lastInstance?.simulateOpen();
  MockEventSource.lastInstance?.emit(event.type, JSON.stringify(event));
}

describe('useAuditStream', () => {
  it('opens an EventSource against the audit stream endpoint', () => {
    renderHook(() => useAuditStream(AUDIT_ID));

    expect(MockEventSource.lastInstance?.url).toBe(
      `http://localhost:3000/api/v1/audits/${AUDIT_ID}/stream`,
    );
  });

  it('transitions from CONNECTING to CONNECTED when the stream opens', () => {
    const { result } = renderHook(() => useAuditStream(AUDIT_ID));

    expect(result.current.status).toBe('CONNECTING');

    act(() => {
      MockEventSource.lastInstance?.simulateOpen();
    });

    expect(result.current.status).toBe('CONNECTED');
  });

  it('accumulates incoming events in delivery order', () => {
    const { result } = renderHook(() => useAuditStream(AUDIT_ID));

    act(() => {
      emitJson(fixtureThought(1));
    });
    act(() => {
      emitJson(fixtureFinding(2));
    });

    expect(result.current.events).toHaveLength(2);
    expect(result.current.events[0]?.type).toBe('AGENT_THOUGHT');
    expect(result.current.events[1]?.type).toBe('VULNERABILITY_FOUND');
    expect(result.current.status).toBe('CONNECTED');
  });

  it('discards malformed frames without breaking the stream', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useAuditStream(AUDIT_ID));

    act(() => {
      MockEventSource.lastInstance?.simulateOpen();
      MockEventSource.lastInstance?.emit('AGENT_THOUGHT', 'not-json{');
    });
    act(() => {
      emitJson(fixtureThought(2));
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.status).toBe('CONNECTED');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('sets DISCONNECTED and closes the EventSource on AUDIT_COMPLETED', () => {
    const { result } = renderHook(() => useAuditStream(AUDIT_ID));
    const eventSource = MockEventSource.lastInstance;

    act(() => {
      emitJson(fixtureThought(1));
      emitJson(completedEvent(2));
    });

    expect(result.current.status).toBe('DISCONNECTED');
    expect(eventSource?.close).toHaveBeenCalledTimes(1);
    expect(eventSource?.readyState).toBe(2 /* CLOSED */);
  });

  it('closes the EventSource on unmount', () => {
    const { unmount } = renderHook(() => useAuditStream(AUDIT_ID));
    const eventSource = MockEventSource.lastInstance;

    act(() => {
      MockEventSource.lastInstance?.simulateOpen();
    });
    unmount();

    expect(eventSource?.close).toHaveBeenCalledTimes(1);
  });

  it('does not open a connection when auditId is undefined', () => {
    renderHook(() => useAuditStream(undefined));

    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('reconnects from scratch when auditId changes', () => {
    const { result, rerender } = renderHook(
      ({ auditId: currentAuditId }: { auditId: string | undefined }) =>
        useAuditStream(currentAuditId),
      { initialProps: { auditId: AUDIT_ID } },
    );

    act(() => {
      emitJson(fixtureThought(1));
    });
    rerender({ auditId: 'aud_next002' });

    const previousSource = MockEventSource.instances[0];
    expect(previousSource?.close).toHaveBeenCalledTimes(1);
    expect(MockEventSource.instances).toHaveLength(2);
    expect(result.current.events).toHaveLength(0);
    expect(result.current.status).toBe('CONNECTING');
  });
});
