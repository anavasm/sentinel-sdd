import { Ajv, type Plugin, type ValidateFunction } from 'ajv';
import * as ajvFormatsModule from 'ajv-formats';

import type { AuditConfig } from '@sentinel/contracts';

/**
 * AuditConfig JSON Schema — D-API-1 local adapter.
 *
 * Mirrors `#/components/schemas/AuditConfig` in specs/openapi.yaml: `oneOf`
 * repoUrl XOR localPath, `format: uri`, RuleSets `additionalProperties: false`
 * with at least one enabled set, and the Severity enum. Compiled once at
 * module load with Ajv + ajv-formats, reusing the contracts-gate compile
 * options (`allErrors: true, strict: false`).
 *
 * ADR candidate D-API-1 promotes this into `@sentinel/contracts` so the
 * schema is never restated; until then this adapter is the single compile
 * point inside apps/api and MUST be kept in sync with the spec.
 */

const SEVERITY_VALUES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

const auditConfigProperties = {
  repoUrl: {
    type: 'string',
    format: 'uri',
    description: 'Git URL of the repository to audit.',
  },
  localPath: {
    type: 'string',
    minLength: 1,
    description: 'Absolute filesystem path of a local repository to audit.',
  },
  ruleSets: {
    type: 'object',
    description: 'Rule categories to activate for the audit. At least one must be true.',
    additionalProperties: false,
    properties: {
      owaspTop10: { type: 'boolean', description: 'Security vulnerabilities (OWASP Top 10).' },
      testQuality: { type: 'boolean', description: 'Unit test quality and coverage rules.' },
      codeSmellsPerformance: {
        type: 'boolean',
        description: 'Code smells and performance rules.',
      },
    },
    anyOf: [
      { required: ['owaspTop10'], properties: { owaspTop10: { const: true } } },
      { required: ['testQuality'], properties: { testQuality: { const: true } } },
      {
        required: ['codeSmellsPerformance'],
        properties: { codeSmellsPerformance: { const: true } },
      },
    ],
  },
  severityThreshold: {
    type: 'string',
    enum: [...SEVERITY_VALUES],
    description: 'Severity levels used for thresholds and findings.',
  },
} as const;

const auditConfigSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  description:
    'Audit launch configuration. Exactly one repository source is required: `repoUrl` (Git URL) or `localPath` (local repository).',
  oneOf: [
    {
      type: 'object',
      required: ['repoUrl', 'ruleSets', 'severityThreshold'],
      properties: auditConfigProperties,
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['localPath', 'ruleSets', 'severityThreshold'],
      properties: auditConfigProperties,
      additionalProperties: false,
    },
  ],
  properties: auditConfigProperties,
} as const;

/** Ajv validator for the POST /api/v1/audits request body. */
export const validateAuditConfig: ValidateFunction<AuditConfig> = (() => {
  // ajv-formats is CJS with an ESM-style declaration; under NodeNext the
  // default export needs this explicit plugin-typed binding (see D-API-1 ADR).
  const addFormats = ajvFormatsModule.default as unknown as Plugin<Record<string, unknown>>;
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile<AuditConfig>(auditConfigSchema);
})();
