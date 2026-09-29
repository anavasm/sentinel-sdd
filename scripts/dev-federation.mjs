/**
 * Dev orchestration for the Vite Module Federation topology (ADR-005).
 *
 * Why this exists: @originjs/vite-plugin-federation only emits
 * `remoteEntry.js` during `vite build` - the Vite dev server cannot serve a
 * remote entry. The plugin's documented dev workflow is therefore:
 *
 *   remotes: `vite build --watch` (writes dist/) + `vite preview` (serves dist/)
 *   host:    `vite dev` (normal HMR)
 *
 * This script sequences that workflow so the host never 404s on
 * /assets/remoteEntry.js: it builds both remotes up front, starts the
 * watch/preview pairs, polls until both remote entries respond, and only then
 * boots the shell. Ctrl+C tears down every child process.
 */
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';

const CONFIG_REMOTE_ENTRY_URL = 'http://localhost:5174/assets/remoteEntry.js';
const METRICS_REMOTE_ENTRY_URL = 'http://localhost:5175/assets/remoteEntry.js';
const REMOTE_ENTRY_POLL_INTERVAL_MS = 500;
const REMOTE_ENTRY_POLL_TIMEOUT_MS = 30_000;

const childProcesses = [];

function runFilteredBuild(workspaceName) {
  const result = spawnSync('pnpm', ['--filter', workspaceName, 'build'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`Initial build failed for ${workspaceName} (exit ${result.status}).`);
  }
}

function startLongRunningProcess(command, args, label) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
    env: { ...process.env, FORCE_COLOR: '1' },
  });
  childProcesses.push(child);
  console.log(`[dev-federation] started ${label} (pid ${child.pid})`);
  return child;
}

async function waitForRemoteEntry(remoteEntryUrl, label) {
  const deadline = Date.now() + REMOTE_ENTRY_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(remoteEntryUrl, { method: 'GET' });
      if (response.ok) {
        console.log(`[dev-federation] ${label} remote entry is up: ${remoteEntryUrl}`);
        return;
      }
      console.log(`[dev-federation] ${label} responded ${response.status}; retrying...`);
    } catch (error) {
      console.log(
        `[dev-federation] ${label} not reachable yet (${error.cause?.code ?? error.message}); retrying...`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, REMOTE_ENTRY_POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for ${label} remote entry at ${remoteEntryUrl}.`);
}

function teardown() {
  for (const child of childProcesses) {
    if (child.exitCode === null && !child.killed) {
      child.kill('SIGTERM');
    }
  }
}

async function main() {
  console.log('[dev-federation] building remotes once so remoteEntry.js exists...');
  runFilteredBuild('@sentinel/mfe-config');
  runFilteredBuild('@sentinel/mfe-metrics');

  console.log('[dev-federation] starting remote watch builds + preview servers...');
  startLongRunningProcess(
    'pnpm',
    ['--filter', '@sentinel/mfe-config', 'build:watch'],
    'mfe-config build --watch',
  );
  startLongRunningProcess(
    'pnpm',
    ['--filter', '@sentinel/mfe-config', 'preview'],
    'mfe-config preview :5174',
  );
  startLongRunningProcess(
    'pnpm',
    ['--filter', '@sentinel/mfe-metrics', 'build:watch'],
    'mfe-metrics build --watch',
  );
  startLongRunningProcess(
    'pnpm',
    ['--filter', '@sentinel/mfe-metrics', 'preview'],
    'mfe-metrics preview :5175',
  );

  await waitForRemoteEntry(CONFIG_REMOTE_ENTRY_URL, 'mfe-config');
  await waitForRemoteEntry(METRICS_REMOTE_ENTRY_URL, 'mfe-metrics');

  console.log('[dev-federation] both remotes are serving remoteEntry.js; booting mfe-shell...');
  const shell = startLongRunningProcess(
    'pnpm',
    ['--filter', '@sentinel/mfe-shell', 'dev'],
    'mfe-shell dev :5173',
  );

  shell.on('exit', (exitCode) => {
    console.log(`[dev-federation] mfe-shell exited (${exitCode}); tearing down.`);
    teardown();
    process.exit(exitCode ?? 0);
  });
}

process.on('SIGINT', () => {
  console.log('\n[dev-federation] SIGINT received; stopping all dev processes.');
  teardown();
  process.exit(0);
});
process.on('SIGTERM', () => {
  teardown();
  process.exit(0);
});

main().catch((error) => {
  console.error(`[dev-federation] fatal: ${error.message}`);
  teardown();
  process.exit(1);
});
