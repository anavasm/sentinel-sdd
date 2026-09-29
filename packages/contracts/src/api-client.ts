/**
 * Shared API client seam (ADR-007 / D-API-1): a typed fetch wrapper against
 * the backend contract (specs/openapi.yaml). Lives in @sentinel/contracts so
 * the shell and every remote share a single runtime copy via the federation
 * share scope (remotes cannot import host modules).
 *
 * Every non-2xx response is normalized into an ApiProblemError carrying the
 * RFC 9457 Problem payload so callers render `errors[]` field messages
 * instead of raw HTTP failures.
 *
 * Note: `Problem` from the generated schema marks `title`/`status` optional
 * at the type level — hence the defensive access.
 */
import type { components } from './generated/api-schema.d.ts';

/** RFC 9457 Problem Details, as generated from specs/openapi.yaml. */
export type Problem = components['schemas']['Problem'];

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

export type ApiFetch = <TResponse>(path: string, init?: RequestInit) => Promise<TResponse>;

/**
 * Builds a reusable `apiFetch` bound to one API base URL. Kept as a factory so
 * each workspace resolves `import.meta.env.VITE_API_BASE_URL` in its own
 * bundle while sharing the transport + Problem normalization logic.
 */
export function createApiFetch(baseUrl: string): ApiFetch {
  return async function apiFetch<TResponse>(path: string, init?: RequestInit): Promise<TResponse> {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { Accept: 'application/json', ...init?.headers },
      ...init,
    });

    if (response.ok) {
      return (await response.json()) as TResponse;
    }

    throw await toApiProblemError(response);
  };
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
