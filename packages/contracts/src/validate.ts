/**
 * Contract validation gate (AC-3, ASD §9.3) — runnable as a local pipeline gate
 * via `pnpm --filter @sentinel/contracts validate` (before any app build).
 *
 * Gates:
 *  1. Syntax  — openapi.yaml parses as YAML; events-schema.json parses as JSON
 *  2. Schema  — every seed fixture event validates against the draft-07 events
 *               schema (Ajv + ajv-formats), and malformed events are rejected
 *
 * Exit code 0 = contracts gate green; 1 = at least one gate failed.
 * Spectral lint is intentionally omitted (optional per plan; toolchain not installed).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { parse as parseYaml } from 'yaml';

import eventsSchema from '../../../specs/events-schema.json' with { type: 'json' };
import { allEventFixtures } from './fixtures/events.ts';

const CONTRACTS_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SPECS_DIR = path.resolve(CONTRACTS_ROOT, '../../specs');

interface GateResult {
  readonly gate: string;
  readonly passed: boolean;
  readonly detail: string;
}

function checkYamlSyntax(): GateResult {
  const gate = 'syntax:openapi.yaml';
  const openapiPath = path.join(SPECS_DIR, 'openapi.yaml');
  try {
    const parsed = parseYaml(readFileSync(openapiPath, 'utf8'));
    if (parsed === null || typeof parsed !== 'object') {
      return { gate, passed: false, detail: 'parsed YAML is not a mapping document' };
    }
    return { gate, passed: true, detail: 'parses as a valid YAML mapping' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { gate, passed: false, detail: `YAML parse error: ${reason}` };
  }
}

function checkJsonSyntax(): GateResult {
  const gate = 'syntax:events-schema.json';
  try {
    // Import-time JSON parse error is the signal; a successful read means valid JSON.
    readFileSync(fileURLToPath(new URL('../../../specs/events-schema.json', import.meta.url)), 'utf8');
    return { gate, passed: true, detail: 'parses as valid JSON' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { gate, passed: false, detail: `JSON parse error: ${reason}` };
  }
}

/** Validates the Ajv contract: all well-formed fixtures pass; malformed events are rejected. */
function checkFixtureSchemaValidation(): GateResult {
  const gate = 'ajv:events-schema';
  try {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validateEvent: ValidateFunction = ajv.compile(eventsSchema);

    const failures: string[] = [];

    for (const event of allEventFixtures) {
      // Capture before the Ajv call: ValidateFunction is a type predicate
      // (`data is T`), so inside the failure branch `event` narrows to never.
      const eventLabel = String(event.type);
      if (!validateEvent(event)) {
        const errors = validateEvent.errors?.map((error) => `${error.instancePath} ${error.message ?? ''}`).join('; ');
        failures.push(`${eventLabel}: ${errors ?? 'unknown Ajv failure'}`);
      }
    }

    // Negative controls: the schema must REJECT these malformed events.
    const malformedEvents: unknown[] = [
      // Unknown event type (discriminator failure)
      { id: 99, type: 'UNKNOWN_EVENT', timestamp: '2026-09-23T10:00:00.000Z', auditId: 'aud_x', payload: {} },
      // Missing required envelope fields
      { type: 'AGENT_THOUGHT', payload: { content: 'orphan event' } },
      // id must be an integer
      { id: 'not-a-number', type: 'AGENT_THOUGHT', timestamp: '2026-09-23T10:00:00.000Z', auditId: 'aud_x', payload: {} },
    ];

    for (const [index, malformed] of malformedEvents.entries()) {
      if (validateEvent(malformed)) {
        failures.push(`malformed event #${index + 1} was unexpectedly ACCEPTED by the schema`);
      }
    }

    if (failures.length > 0) {
      return { gate, passed: false, detail: failures.join(' | ') };
    }
    return {
      gate,
      passed: true,
      detail: `${allEventFixtures.length} fixtures pass; 3 malformed samples correctly rejected`,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { gate, passed: false, detail: `Ajv setup error: ${reason}` };
  }
}

function main(): number {
  const results: GateResult[] = [checkYamlSyntax(), checkJsonSyntax(), checkFixtureSchemaValidation()];

  let exitCode = 0;
  for (const result of results) {
    const status = result.passed ? 'PASS' : 'FAIL';
    console.log(`[${status}] ${result.gate} — ${result.detail}`);
    if (!result.passed) {
      exitCode = 1;
    }
  }

  console.log(exitCode === 0 ? 'Contract validation gate: GREEN' : 'Contract validation gate: RED');
  return exitCode;
}

process.exit(main());
