import { createApiFetch, type ApiFetch } from '@sentinel/contracts';
import type { AuditConfig, AuditCreated } from '@sentinel/contracts';

const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';

const apiFetch: ApiFetch = createApiFetch(API_BASE_URL);

/** Launches an audit: POST /api/v1/audits -> 201 AuditCreated. */
export function launchAudit(config: AuditConfig): Promise<AuditCreated> {
  return apiFetch<AuditCreated>('/audits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
}
