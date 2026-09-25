import type { Response } from 'express';

import type { Problem } from '@sentinel/contracts';

/**
 * RFC 9457 Problem Details builder (D-2, D-API-5) — single error model for
 * all REST failures, rendered as `application/problem+json`.
 *
 * Distinct `type` URIs per failure class, per openapi `Problem` schema
 * (example type: `https://sentinel.dev/problems/validation-error`).
 */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';

/** Base URI for all problem `type` references. */
const PROBLEM_TYPE_BASE_URI = 'https://sentinel.dev/problems';

/** Known problem classes — distinct type URI per failure category. */
export const ProblemType = {
  VALIDATION_ERROR: 'validation-error',
  PAYLOAD_TOO_LARGE: 'payload-too-large',
  NOT_FOUND: 'not-found',
  INTERNAL_ERROR: 'internal-error',
} as const;

export type ProblemTypeName = (typeof ProblemType)[keyof typeof ProblemType];

/** Field-level validation detail (openapi `Problem.errors[]` items). */
export interface ValidationErrorDetail {
  readonly field: string;
  readonly message: string;
}

/** Sentinel error carrying a pre-built Problem through middleware chain. */
export class ProblemError extends Error {
  readonly problem: Problem;

  constructor(problem: Problem) {
    super(problem.title);
    this.name = 'ProblemError';
    this.problem = problem;
  }
}

export function problemTypeUri(typeName: ProblemTypeName): string {
  return `${PROBLEM_TYPE_BASE_URI}/${typeName}`;
}

interface ProblemOptions {
  readonly detail?: string;
  readonly instance?: string;
  readonly errors?: readonly ValidationErrorDetail[];
}

/** Builds an RFC 9457 Problem payload for the given status and problem class. */
export function buildProblem(
  status: number,
  typeName: ProblemTypeName,
  options: ProblemOptions = {},
): Problem {
  const problem: Problem = {
    type: problemTypeUri(typeName),
    title: titleForStatus(status, typeName),
    status,
  };

  if (options.detail !== undefined) {
    problem.detail = options.detail;
  }
  if (options.instance !== undefined) {
    problem.instance = options.instance;
  }
  if (options.errors !== undefined && options.errors.length > 0) {
    problem.errors = options.errors.map((error) => ({ ...error }));
  }

  return problem;
}

function titleForStatus(status: number, typeName: ProblemTypeName): string {
  switch (typeName) {
    case ProblemType.VALIDATION_ERROR:
      return 'Request validation failed';
    case ProblemType.PAYLOAD_TOO_LARGE:
      return 'Request payload too large';
    case ProblemType.NOT_FOUND:
      return 'Resource not found';
    case ProblemType.INTERNAL_ERROR:
      return 'Internal server error';
    default:
      return `HTTP ${status}`;
  }
}

/** Renders a Problem as an `application/problem+json` response. */
export function sendProblem(res: Response, problem: Problem, instance?: string): void {
  const withInstance = instance !== undefined ? { ...problem, instance } : problem;
  res.status(problem.status).set('Content-Type', PROBLEM_CONTENT_TYPE).json(withInstance);
}
