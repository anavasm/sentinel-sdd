/**
 * `useAuditStream` behavior tests (US-3 Task 3.6 subset).
 *
 * The global EventSource is replaced by MockEventSource in tests/setup.ts;
 * tests simulate the SSE stream deterministically and assert the hook's
 * status machine, event accumulation, and resource cleanup.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
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

function runningSnapshot(lastEventId = 0): Response {
  return new Response(JSON.stringify({
    auditId: AUDIT_ID,
    status: 'running',
    config: { localPath: '/tmp/repo' },
    createdAt: '2026-09-23T10:00:00.000Z',
    findings: [],
    lastEventId,
    firstAvailableEventId: lastEventId === 0 ? null : 1,
  }), { status: 200 });
}

function emitJson(event: SentinelAISSEEventContract): void {
  MockEventSource.lastInstance?.simulateOpen();
  MockEventSource.lastInstance?.emit(event.type, JSON.stringify(event));
}

async function waitForConnection(): Promise<void> {
  await waitFor(() => {
    expect(MockEventSource.lastInstance).toBeDefined();
  });
}

describe('useAuditStream', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear();
  });

  it('opens an EventSource against the audit stream endpoint', async () => {
    renderHook(() => useAuditStream(AUDIT_ID));
    await waitForConnection();

    expect(MockEventSource.lastInstance?.url).toBe(
      `http://localhost:3000/api/v1/audits/${AUDIT_ID}/stream`,
    );
  });

  it('transitions from CONNECTING to CONNECTED when the stream opens', async () => {
    const { result } = renderHook(() => useAuditStream(AUDIT_ID));
    await waitForConnection();

    expect(result.current.status).toBe('CONNECTING');

    act(() => {
      MockEventSource.lastInstance?.simulateOpen();
    });

    expect(result.current.status).toBe('CONNECTED');
  });

  it('accumulates incoming events in delivery order', async () => {
    const { result } = renderHook(() => useAuditStream(AUDIT_ID));
    await waitForConnection();

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

  it('discards malformed frames without breaking the stream', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useAuditStream(AUDIT_ID));
    await waitForConnection();

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

  it('sets DISCONNECTED and closes the EventSource on AUDIT_COMPLETED', async () => {
    const { result } = renderHook(() => useAuditStream(AUDIT_ID));
    await waitForConnection();
    const eventSource = MockEventSource.lastInstance;

    act(() => {
      emitJson(fixtureThought(1));
      emitJson(completedEvent(2));
    });

    expect(result.current.status).toBe('DISCONNECTED');
    expect(eventSource?.close).toHaveBeenCalledTimes(1);
    expect(eventSource?.readyState).toBe(2 /* CLOSED */);
  });

  it('reconciles the terminal audit snapshot after the completion event', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(runningSnapshot())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        auditId: AUDIT_ID,
        status: 'completed',
        config: { localPath: '/tmp/repo' },
        createdAt: '2026-09-23T10:00:00.000Z',
        findings: [{ ...fixtureFinding(1).payload, eventId: 1 }],
        lastEventId: 2,
        firstAvailableEventId: 1,
        summary: { healthScore: 72 },
      }), { status: 200 }));
    const { result } = renderHook(() => useAuditStream(AUDIT_ID));
    await waitForConnection();

    act(() => {
      emitJson(fixtureFinding(1));
      emitJson(completedEvent(2));
    });

    await waitFor(() => {
      expect(result.current.snapshot?.status).toBe('completed');
    });
    expect(result.current.snapshot?.summary?.healthScore).toBe(72);
    expect(result.current.snapshot?.findings).toHaveLength(1);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('closes the EventSource on unmount', async () => {
    const { unmount } = renderHook(() => useAuditStream(AUDIT_ID));
    await waitForConnection();
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

  it('reconnects from scratch when auditId changes', async () => {
    const { result, rerender } = renderHook(
      ({ auditId: currentAuditId }: { auditId: string | undefined }) =>
        useAuditStream(currentAuditId),
      { initialProps: { auditId: AUDIT_ID } },
    );
    await waitForConnection();

    act(() => {
      emitJson(fixtureThought(1));
    });
    rerender({ auditId: 'aud_next002' });

    const previousSource = MockEventSource.instances[0];
    expect(previousSource?.close).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(2));
    expect(MockEventSource.instances).toHaveLength(2);
    expect(result.current.events).toHaveLength(0);
    expect(result.current.status).toBe('CONNECTING');
  });

  it('aborts an in-flight snapshot and does not open a stale stream on unmount', async () => {
    let resolveSnapshot: ((response: Response) => void) | undefined;
    let requestSignal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementationOnce((_input, init) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>((resolve) => {
        resolveSnapshot = resolve;
      });
    });

    const { unmount } = renderHook(() => useAuditStream(AUDIT_ID));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1));

    unmount();
    expect(requestSignal?.aborted).toBe(true);

    await act(async () => {
      resolveSnapshot?.(runningSnapshot());
      await Promise.resolve();
    });
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('ignores a stale initial snapshot when the audit route changes', async () => {
    let resolveSnapshot: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => {
      resolveSnapshot = resolve;
    }));

    const { rerender } = renderHook(
      ({ auditId: currentAuditId }: { auditId: string }) => useAuditStream(currentAuditId),
      { initialProps: { auditId: AUDIT_ID } },
    );
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1));

    rerender({ auditId: 'aud_next002' });
    await act(async () => {
      resolveSnapshot?.(runningSnapshot());
      await Promise.resolve();
    });

    await waitForConnection();
    expect(MockEventSource.lastInstance?.url).toContain('/aud_next002/stream');
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it('preserves an event received while reconciling after a transport error', async () => {
    let resolveSnapshot: ((response: Response) => void) | undefined;
    vi.mocked(fetch)
      .mockResolvedValueOnce(runningSnapshot(1))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => {
        resolveSnapshot = resolve;
      }));

    const { result } = renderHook(() => useAuditStream(AUDIT_ID));
    await waitForConnection();

    act(() => {
      MockEventSource.lastInstance?.simulateError();
      emitJson(fixtureThought(2));
    });
    expect(result.current.events.map((event) => event.id)).toEqual([2]);

    await act(async () => {
      resolveSnapshot?.(runningSnapshot(1));
      await Promise.resolve();
    });

    expect(result.current.events.map((event) => event.id)).toEqual([2]);
    expect(result.current.snapshot?.lastEventId).toBe(1);
  });

  it('deduplicates replayed IDs, sorts out-of-order events, and reports a gap', async () => {
    const { result } = renderHook(() => useAuditStream(AUDIT_ID));
    await waitForConnection();

    act(() => {
      emitJson(fixtureThought(2));
      emitJson(fixtureThought(1));
      emitJson(fixtureThought(2));
    });

    expect(result.current.events.map((event) => event.id)).toEqual([1, 2]);
    expect(result.current.gapDetected).toBe(true);
  });

  it('rejects event identity mismatches and keeps the accepted stream unchanged', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useAuditStream(AUDIT_ID));
    await waitForConnection();

    act(() => {
      MockEventSource.lastInstance?.simulateOpen();
      MockEventSource.lastInstance?.emit(
        'AGENT_THOUGHT',
        JSON.stringify({ ...fixtureThought(1), auditId: 'aud_other' }),
      );
    });

    expect(result.current.events).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith('Discarding invalid or inconsistent SSE frame');
    errorSpy.mockRestore();
  });

  it('rejects a native lastEventId that differs from the envelope ID', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useAuditStream(AUDIT_ID));
    await waitForConnection();

    act(() => {
      MockEventSource.lastInstance?.simulateOpen();
      MockEventSource.lastInstance?.emit(
        'AGENT_THOUGHT',
        JSON.stringify(fixtureThought(1)),
        '2',
      );
    });

    expect(result.current.events).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith('Discarding invalid or inconsistent SSE frame');
    errorSpy.mockRestore();
  });

  it('treats a pre-stream 404 as terminal and does not open EventSource', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 404 }));
    const { result } = renderHook(() => useAuditStream(AUDIT_ID));

    await waitFor(() => expect(result.current.status).toBe('NOT_FOUND'));
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('reconciles findings from a terminal snapshot when no events can be replayed', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      auditId: AUDIT_ID,
      status: 'completed',
      config: { localPath: '/tmp/repo' },
      createdAt: '2026-09-23T10:00:00.000Z',
      findings: [{ ...fixtureFinding(7).payload, eventId: 7 }],
      lastEventId: 7,
      firstAvailableEventId: 7,
      summary: { healthScore: 80 },
    }), { status: 200 }));
    const { result } = renderHook(() => useAuditStream(AUDIT_ID));

    await waitFor(() => expect(result.current.status).toBe('DISCONNECTED'));
    expect(result.current.snapshot?.findings).toHaveLength(1);
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('does not let a late lower-watermark snapshot overwrite newer state', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        auditId: AUDIT_ID,
        status: 'running',
        config: { localPath: '/tmp/repo' },
        createdAt: '2026-09-23T10:00:00.000Z',
        findings: [],
        lastEventId: 5,
        firstAvailableEventId: 1,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        auditId: AUDIT_ID,
        status: 'running',
        config: { localPath: '/tmp/repo' },
        createdAt: '2026-09-23T10:00:00.000Z',
        findings: [],
        lastEventId: 3,
        firstAvailableEventId: 1,
      }), { status: 200 }));
    const { result } = renderHook(() => useAuditStream(AUDIT_ID));
    await waitForConnection();

    act(() => {
      MockEventSource.lastInstance?.simulateError();
    });
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));

    expect(result.current.snapshot?.lastEventId).toBe(5);
  });

  it('closes an open stream when reconnection reconciliation discovers a terminal audit', async () => {
    const runningSnapshot = JSON.stringify({
      auditId: AUDIT_ID,
      status: 'running',
      config: { localPath: '/tmp/repo' },
      createdAt: '2026-09-23T10:00:00.000Z',
      findings: [],
      lastEventId: 1,
      firstAvailableEventId: 1,
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(runningSnapshot, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
      auditId: AUDIT_ID,
      status: 'completed',
      config: { localPath: '/tmp/repo' },
      createdAt: '2026-09-23T10:00:00.000Z',
      findings: [],
      lastEventId: 2,
      firstAvailableEventId: 1,
      summary: { healthScore: 90 },
      }), { status: 200 }));
    const { result } = renderHook(() => useAuditStream(AUDIT_ID));
    await waitForConnection();

    act(() => {
      MockEventSource.lastInstance?.simulateError();
    });

    await waitFor(() => expect(result.current.status).toBe('DISCONNECTED'));
    expect(MockEventSource.lastInstance?.close).toHaveBeenCalled();
  });

  it('closes an active stream and reports NOT_FOUND after a restart removes the audit', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        auditId: AUDIT_ID,
        status: 'running',
        config: { localPath: '/tmp/repo' },
        createdAt: '2026-09-23T10:00:00.000Z',
        findings: [],
        lastEventId: 1,
        firstAvailableEventId: 1,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 404 }));
    const { result } = renderHook(() => useAuditStream(AUDIT_ID));
    await waitForConnection();

    act(() => {
      MockEventSource.lastInstance?.simulateError();
    });

    await waitFor(() => expect(result.current.status).toBe('NOT_FOUND'));
    expect(MockEventSource.lastInstance?.close).toHaveBeenCalled();
  });

  it('keeps a recoverable stream path after an initial server error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 503 }));
    const { result } = renderHook(() => useAuditStream(AUDIT_ID));

    await waitForConnection();
    expect(result.current.status).toBe('ERROR');

    act(() => {
      MockEventSource.lastInstance?.simulateOpen();
    });
    expect(result.current.status).toBe('CONNECTED');
  });

  it('keeps a recoverable stream path when the snapshot body is invalid', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      auditId: AUDIT_ID,
      status: 'running',
      lastEventId: 'not-an-integer',
    }), { status: 200 }));
    const { result } = renderHook(() => useAuditStream(AUDIT_ID));

    await waitForConnection();
    expect(result.current.status).toBe('ERROR');

    act(() => {
      MockEventSource.lastInstance?.simulateOpen();
    });
    expect(result.current.status).toBe('CONNECTED');
  });
});
