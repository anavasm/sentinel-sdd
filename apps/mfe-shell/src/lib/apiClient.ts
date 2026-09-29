/**
 * Shell-facing API client (US-1 Task 1.4). The transport + RFC 9457 Problem
 * normalization live in `@sentinel/contracts` (ADR-007 — single shared copy
 * via the federation share scope); this module only binds the shell's
 * configured base URL. Remotes build their own instance the same way.
 */
import { createApiFetch } from '@sentinel/contracts';

const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';

export const apiFetch = createApiFetch(API_BASE_URL);

export { ApiProblemError, UnparseableProblemError } from '@sentinel/contracts';
