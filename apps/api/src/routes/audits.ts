import { access } from 'node:fs/promises';

import type { RequestHandler } from 'express';

import type { AuditConfig } from '@sentinel/contracts';

import { buildProblem, ProblemError, ProblemType } from '../lib/problems.js';
import { validateAuditConfig } from '../lib/validators.js';
import { AUDIT_ID_PATTERN, createAudit, findAuditById } from '../store/audits.js';

/**
 * `POST /api/v1/audits` controller (plan US-2, Task 2.3).
 *
 * Fail-fast validation order: body size (413, enforced by the JSON parser),
 * Ajv `AuditConfig` validation (400), `localPath` existence via fs/promises
 * (400 — never deferred to the agent runtime). Success persists an audit in
 * `queued` state and responds `201 AuditCreated`.
 */

/** Ajv instancePath → openapi `errors[].field` (root-level errors map to 'body'). */
function ajvErrorToDetail(instancePath: string, message: string): { field: string; message: string } {
  return {
    field: instancePath === '' ? 'body' : instancePath.replace(/^\//, ''),
    message,
  };
}

export const createAuditHandler: RequestHandler = async (req, res, next) => {
  try {
    const config: unknown = req.body;
    if (!validateAuditConfig(config)) {
      const ajvErrors = validateAuditConfig.errors ?? [];
      throw new ProblemError(
        buildProblem(400, ProblemType.VALIDATION_ERROR, {
          detail: 'Request body does not conform to the AuditConfig schema.',
          errors: ajvErrors.map((ajvError) =>
            ajvErrorToDetail(ajvError.instancePath ?? '', ajvError.message ?? 'is invalid'),
          ),
        }),
      );
    }

    // Narrowed by the Ajv type guard: `config` is AuditConfig here.
    const validatedConfig: AuditConfig = config;
    if (validatedConfig.localPath !== undefined) {
      const pathExists = await pathIsAccessible(validatedConfig.localPath);
      if (!pathExists) {
        throw new ProblemError(
          buildProblem(400, ProblemType.VALIDATION_ERROR, {
            detail: 'The local repository path does not exist or is not accessible.',
            errors: [
              {
                field: 'localPath',
                message: 'path does not exist or is not accessible',
              },
            ],
          }),
        );
      }
    }

    const audit = createAudit({ config: validatedConfig });

    res.status(201).json({ auditId: audit.auditId, status: audit.status });
  } catch (error) {
    next(error);
  }
};

async function pathIsAccessible(localPath: string): Promise<boolean> {
  try {
    await access(localPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * `GET /api/v1/audits/:auditId` controller (plan US-3, Task 3.2).
 *
 * Path param is validated against the openapi `auditId` pattern first
 * (ids violating `^aud_[0-9a-zA-Z]+$` can never exist in the store), then
 * looked up. Responds `200 Audit` (config echo, RFC 3339 createdAt,
 * findings accumulated so far, summary once terminal) or `404` Problem
 * Details with type `not-found` — never an empty 200.
 */
export const getAuditHandler: RequestHandler = (req, res, next) => {
  try {
    // Under `noUncheckedIndexedAccess` the params record may be typed loose;
    // the route is always matched with `:auditId`, so default to ''.
    const auditId = req.params.auditId ?? '';
    if (!AUDIT_ID_PATTERN.test(auditId)) {
      throw notFoundProblem(
        `Audit id '${auditId}' does not match the required pattern ^aud_[0-9a-zA-Z]+$.`,
      );
    }

    const audit = findAuditById(auditId);
    if (audit === undefined) {
      throw notFoundProblem(`No audit session found with id '${auditId}'.`);
    }

    res.status(200).json(audit);
  } catch (error) {
    next(error);
  }
};

function notFoundProblem(detail: string): ProblemError {
  return new ProblemError(buildProblem(404, ProblemType.NOT_FOUND, { detail }));
}
