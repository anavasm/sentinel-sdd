/**
 * Deterministic SSE event builders shared by the US-4 dashboard tests.
 *
 * Mirrors `@sentinel/contracts` fixture shapes so mocked streams and real
 * streams are indistinguishable to the components under test.
 */
import type {
  AgentThoughtEvent,
  AuditCompletedEvent,
  SentinelAISSEEventContract,
  Severity,
  ToolExecutionEvent,
  VulnerabilityFoundEvent,
} from '@sentinel/contracts';
import { MockEventSource } from './eventSource';

export const AUDIT_ID = 'aud_dash001';

export function thoughtEvent(
  id: number,
  content = 'Analyzing src/auth/queries.ts for injection sinks',
  step?: string,
): AgentThoughtEvent {
  return {
    id,
    type: 'AGENT_THOUGHT',
    timestamp: `2026-09-23T10:00:${String(id).padStart(2, '0')}.000Z`,
    auditId: AUDIT_ID,
    payload: { content, ...(step !== undefined && { step }) },
  };
}

export function toolExecutionEvent(
  id: number,
  status: ToolExecutionEvent['payload']['status'],
  overrides: Partial<ToolExecutionEvent['payload']> = {},
): ToolExecutionEvent {
  return {
    id,
    type: 'TOOL_EXECUTION',
    timestamp: `2026-09-23T10:01:${String(id).padStart(2, '0')}.000Z`,
    auditId: AUDIT_ID,
    payload: { tool: 'git-clone', status, ...overrides },
  };
}

export function findingEvent(
  id: number,
  severity: Severity,
  overrides: Partial<VulnerabilityFoundEvent['payload']> = {},
): VulnerabilityFoundEvent {
  return {
    id,
    type: 'VULNERABILITY_FOUND',
    timestamp: `2026-09-23T10:02:${String(id).padStart(2, '0')}.000Z`,
    auditId: AUDIT_ID,
    payload: {
      ruleId: 'owasp-a03-injection',
      title: 'SQL Injection in user lookup',
      severity,
      filePath: 'src/auth/queries.ts',
      lineNumber: 42,
      description: 'User-supplied input is concatenated into a SQL query without parameterization.',
      beforeSnippet: "db.query(`SELECT * FROM users WHERE id = '${userId}'`);",
      afterSnippet: 'db.query("SELECT * FROM users WHERE id = ?", [userId]);',
      ...overrides,
    },
  };
}

export function completedEvent(
  id: number,
  status: 'completed' | 'failed' = 'completed',
): AuditCompletedEvent {
  return {
    id,
    type: 'AUDIT_COMPLETED',
    timestamp: '2026-09-23T10:03:00.000Z',
    auditId: AUDIT_ID,
    payload:
      status === 'completed'
        ? { status, healthScore: 72 }
        : { status, error: 'Agent engine crashed mid-audit' },
  };
}

/** Delivers an event through the MockEventSource as a named SSE frame. */
export function emitStreamEvent(event: SentinelAISSEEventContract): void {
  MockEventSource.lastInstance?.simulateOpen();
  MockEventSource.lastInstance?.emit(event.type, JSON.stringify(event));
}
