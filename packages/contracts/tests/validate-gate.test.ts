import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

describe('root contract validation gate', () => {
  let workspace: string;

  beforeAll(() => {
    workspace = mkdtempSync(path.join(tmpdir(), 'sentinel-contract-gate-'));
    for (const file of ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'turbo.json']) {
      cpSync(path.join(repoRoot, file), path.join(workspace, file));
    }
    cpSync(path.join(repoRoot, 'specs'), path.join(workspace, 'specs'), { recursive: true });
    cpSync(
      path.join(repoRoot, 'packages/contracts/src'),
      path.join(workspace, 'packages/contracts/src'),
      { recursive: true },
    );
    cpSync(
      path.join(repoRoot, 'packages/contracts/package.json'),
      path.join(workspace, 'packages/contracts/package.json'),
    );
    symlinkSync(
      path.join(repoRoot, 'node_modules'),
      path.join(workspace, 'node_modules'),
      'junction',
    );
    symlinkSync(
      path.join(repoRoot, 'packages/contracts/node_modules'),
      path.join(workspace, 'packages/contracts/node_modules'),
      'junction',
    );
  });

  afterAll(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  function runGate(): { status: number | null; output: string } {
    const result = spawnSync(pnpm, ['validate'], {
      cwd: workspace,
      encoding: 'utf8',
      env: { ...process.env, TURBO_TELEMETRY_DISABLED: '1' },
      timeout: 30_000,
    });
    if (result.error) throw result.error;
    return { status: result.status, output: result.stdout + result.stderr };
  }

  it('passes valid inputs and rejects invalid specs, fixtures, and generated-type drift', () => {
    const openapiPath = path.join(workspace, 'specs/openapi.yaml');
    const fixturesPath = path.join(workspace, 'packages/contracts/src/fixtures/events.ts');
    const openapi = readFileSync(openapiPath, 'utf8');
    const fixtures = readFileSync(fixturesPath, 'utf8');

    const valid = runGate();
    expect(valid.status, valid.output).toBe(0);
    expect(valid.output).toContain('cache bypass');

    writeFileSync(openapiPath, 'invalid: [\n');
    const invalidSpec = runGate();
    expect(invalidSpec.status, invalidSpec.output).not.toBe(0);
    expect(invalidSpec.output).toContain('[FAIL] syntax:openapi.yaml');
    writeFileSync(openapiPath, openapi);

    const invalidFixtures = fixtures.replace("type: 'AGENT_THOUGHT',", "type: 'INVALID_EVENT',");
    expect(invalidFixtures).not.toBe(fixtures);
    writeFileSync(fixturesPath, invalidFixtures);
    const invalidFixture = runGate();
    expect(invalidFixture.status, invalidFixture.output).not.toBe(0);
    expect(invalidFixture.output).toContain('[FAIL] ajv:events-schema');
    writeFileSync(fixturesPath, fixtures);

    const changedSpec = openapi.replace(
      'summary: Internal API process smoke check',
      'summary: Changed internal API process smoke check',
    );
    expect(changedSpec).not.toBe(openapi);
    writeFileSync(openapiPath, changedSpec);
    const staleTypes = runGate();
    expect(staleTypes.status, staleTypes.output).not.toBe(0);
    expect(staleTypes.output).toContain('Generated types are not up-to-date');
  }, 120_000);
});
