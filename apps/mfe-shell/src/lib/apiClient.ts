import type { Problem } from '@sentinel/contracts';

/** Error thrown for any non-2xx response, carrying the parsed RFC 9457 Problem. */
export class ApiProblemError extends Error {
  readonly problem: Problem;

  constructor(problem: Problem) {
    super(problem.title ?? 'API request failed');
    this.name = 'ApiProblemError';
    this.problem = problem;
  }
}

/** Error thrown when the response body is not a parseable RFC 9457 Problem. */
export class UnparseableProblemError extends Error {
  readonly status: number;

  constructor(status: number, cause: unknown) {
    super(`API responded ${status} with a non-Problem body`);
    this.name = 'UnparseableProblemError';
    this.status = status;
    this.cause = cause;
  }
}

const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';

/**
 * Shared API client seam (US-1 Task 1.4): typed fetch wrapper against the
 * backend contract (specs/openapi.yaml). Every non-2xx response is normalized
 * into an ApiProblemError carrying the RFC 9457 Problem payload so remotes
 * render `errors[]` field messages instead of raw HTTP failures.
 *
 * Note: `Problem` from @sentinel/contracts is derived from the openapi schema,
 * where `title`/`status` etc. may be optional — hence the defensive access.
 */
export async function apiFetch<TResponse>(path: string, init?: RequestInit): Promise<TResponse> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Accept: 'application/json', ...init?.headers },
    ...init,
  });

  if (response.ok) {
    return (await response.json()) as TResponse;
  }

  throw await toApiProblemError(response);
}

async function toApiProblemError(response: Response): Promise<ApiProblemError | UnparseableProblemError> {
  let parsedBody: unknown;
  try {
    parsedBody = await response.json();
  } catch (parseError: unknown) {
    return new UnparseableProblemError(response.status, parseError);
  }

  if (!isProblemShape(parsedBody)) {
    return new UnparseableProblemError(response.status, parsedBody);
  }
  return new ApiProblemError(parsedBody);
}

function isProblemShape(candidate: unknown): candidate is Problem {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }
  const record = candidate as Record<string, unknown>;
  return typeof record['type'] === 'string' && typeof record['status'] === 'number';
}
