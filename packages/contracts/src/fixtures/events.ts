/**
 * Seed fixtures for the Sentinel AI contracts (ASD §10.2).
 *
 * Single source of truth for BOTH:
 *  - Ajv validation (src/validate.ts, tests/contracts.test.ts)
 *  - MSW mock handlers (src/mocks/handlers.ts)
 *
 * All events conform to specs/events-schema.json (draft-07): common envelope
 * + payload discriminated by `type`. Ids are monotonic per audit starting at 1
 * (decision D-6) and double as the SSE `id:` field.
 */
import type {
  AgentThoughtEvent,
  AuditCompletedEvent,
  AuditCreated,
  Audit,
  Finding,
  Problem,
  ToolExecutionEvent,
  VulnerabilityFoundEvent,
} from '../index.ts';

/** Fixed auditId used across seed fixtures for deterministic tests (must match ^aud_[0-9a-zA-Z]+$). */
export const SAMPLE_AUDIT_ID = 'aud_sample001';

/* ── SSE event fixtures (one per type + unhappy paths) ─────────────────────── */

export const agentThoughtEvent: AgentThoughtEvent = {
  id: 1,
  type: 'AGENT_THOUGHT',
  timestamp: '2026-09-23T10:00:00.000Z',
  auditId: SAMPLE_AUDIT_ID,
  payload: {
    content: 'Analyzing src/auth/queries.ts for injection sinks',
    step: 'analyze',
  },
};

export const toolExecutionStartedEvent: ToolExecutionEvent = {
  id: 2,
  type: 'TOOL_EXECUTION',
  timestamp: '2026-09-23T10:00:01.000Z',
  auditId: SAMPLE_AUDIT_ID,
  payload: {
    tool: 'git-clone',
    input: { repoUrl: 'https://github.com/example/vulnerable-app.git' },
    status: 'started',
  },
};

export const toolExecutionSucceededEvent: ToolExecutionEvent = {
  id: 3,
  type: 'TOOL_EXECUTION',
  timestamp: '2026-09-23T10:00:02.000Z',
  auditId: SAMPLE_AUDIT_ID,
  payload: {
    tool: 'git-clone',
    status: 'succeeded',
    output: 'Cloned 42 files (1.2 MB)',
  },
};

/** LLM provider throttled → degraded outcome, NOT an HTTP error (NFR-A3). */
export const toolExecutionDegradedEvent: ToolExecutionEvent = {
  id: 4,
  type: 'TOOL_EXECUTION',
  timestamp: '2026-09-23T10:00:03.000Z',
  auditId: SAMPLE_AUDIT_ID,
  payload: {
    tool: 'llm-analyze',
    status: 'degraded',
    output: 'Provider throttled; falling back to Ollama',
  },
};

export const vulnerabilityFoundEvent: VulnerabilityFoundEvent = {
  id: 5,
  type: 'VULNERABILITY_FOUND',
  timestamp: '2026-09-23T10:00:04.000Z',
  auditId: SAMPLE_AUDIT_ID,
  payload: {
    ruleId: 'owasp-a03-injection',
    title: 'SQL Injection in user lookup',
    severity: 'HIGH',
    filePath: 'src/auth/queries.ts',
    lineNumber: 42,
    cweId: 'CWE-89',
    description:
      'User-supplied input is concatenated into a SQL query without parameterization.',
    beforeSnippet: "db.query(`SELECT * FROM users WHERE id = '${userId}'`);",
    afterSnippet: 'db.query("SELECT * FROM users WHERE id = ?", [userId]);',
  },
};

export const auditCompletedEvent: AuditCompletedEvent = {
  id: 6,
  type: 'AUDIT_COMPLETED',
  timestamp: '2026-09-23T10:00:05.000Z',
  auditId: SAMPLE_AUDIT_ID,
  payload: {
    status: 'completed',
    healthScore: 72,
    summary: {
      findings: { LOW: 1, MEDIUM: 0, HIGH: 1, CRITICAL: 0 },
      rulesEvaluated: 128,
      durationSeconds: 94,
    },
  },
};

/** Agent crash mid-audit → terminal failed event, no orphan streams (plan §3.3). */
export const auditFailedEvent: AuditCompletedEvent = {
  id: 6,
  type: 'AUDIT_COMPLETED',
  timestamp: '2026-09-23T10:00:06.000Z',
  auditId: SAMPLE_AUDIT_ID,
  payload: {
    status: 'failed',
    error: 'Agent engine crashed while remediating src/auth/queries.ts',
  },
};

/** Every fixture event, in canonical stream order — Ajv validation target. */
export const allEventFixtures = [
  agentThoughtEvent,
  toolExecutionStartedEvent,
  toolExecutionSucceededEvent,
  toolExecutionDegradedEvent,
  vulnerabilityFoundEvent,
  auditCompletedEvent,
  auditFailedEvent,
] as const;

/**
 * Deterministic full-audit happy-path sequence for the future Playwright suite
 * (ASD §10.5): clone → analyze → finding → completed.
 */
export const happyPathAuditSequence: readonly (
  | AgentThoughtEvent
  | ToolExecutionEvent
  | VulnerabilityFoundEvent
  | AuditCompletedEvent
)[] = [
  agentThoughtEvent,
  toolExecutionStartedEvent,
  toolExecutionSucceededEvent,
  toolExecutionDegradedEvent,
  vulnerabilityFoundEvent,
  auditCompletedEvent,
];

/* ── REST fixtures ─────────────────────────────────────────────────────────── */

export const auditCreatedResponse: AuditCreated = {
  auditId: SAMPLE_AUDIT_ID,
  status: 'queued',
};

export const sampleFinding: Finding = vulnerabilityFoundEvent.payload;

export const auditRunningResponse: Audit = {
  auditId: SAMPLE_AUDIT_ID,
  status: 'running',
  config: {
    repoUrl: 'https://github.com/example/vulnerable-app.git',
    ruleSets: { owaspTop10: true, testQuality: false, codeSmellsPerformance: true },
    severityThreshold: 'MEDIUM',
  },
  createdAt: '2026-09-23T10:00:00.000Z',
  findings: [],
};

export const auditCompletedResponse: Audit = {
  auditId: SAMPLE_AUDIT_ID,
  status: 'completed',
  config: {
    repoUrl: 'https://github.com/example/vulnerable-app.git',
    ruleSets: { owaspTop10: true, testQuality: false, codeSmellsPerformance: true },
    severityThreshold: 'MEDIUM',
  },
  createdAt: '2026-09-23T10:00:00.000Z',
  findings: [vulnerabilityFoundEvent.payload],
};

/* ── RFC 9457 Problem Details error fixtures ───────────────────────────────── */

export const validationErrorProblem: Problem = {
  type: 'https://sentinel.dev/problems/validation-error',
  title: 'Validation failed',
  status: 400,
  detail: 'Audit configuration is invalid',
  errors: [
    {
      field: 'severityThreshold',
      message: 'must be one of LOW, MEDIUM, HIGH, CRITICAL',
    },
  ],
};

export const notFoundProblem: Problem = {
  type: 'https://sentinel.dev/problems/audit-not-found',
  title: 'Audit not found',
  status: 404,
  detail: 'No audit exists with id aud_unknown_999',
};
