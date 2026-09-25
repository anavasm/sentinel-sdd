/**
 * Audit Runner seam (ASD §6.1, plan US-4 Task 4.5).
 *
 * Decouples the agent engine from HTTP: the POST controller hands the audit
 * id to a runner; the runner emits contract events through the SSE hub. The
 * real LLM-backed implementation arrives in US-5.
 */
export interface AuditRunner {
  /**
   * Kicks off audit execution for the given audit id. Implementations must
   * never block the HTTP response — scheduling is theirs to decide
   * (the stub uses `setImmediate`).
   */
  run(auditId: string): void;
}
