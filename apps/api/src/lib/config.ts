const DEFAULT_PORT = 3000;

/**
 * Origins allowed to call the API from a browser (CORS allowlist, security
 * baseline: never `*`). Mirrors the Vite dev-server ports of the MFEs:
 * shell (5173), metrics (5174), config (5175).
 */
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
] as const;

/**
 * Reads the HTTP listen port from the environment (fail fast on garbage input).
 *
 * Extracted from `src/server.ts` so the validation logic is unit-testable
 * without booting the server.
 */
export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  const rawPort = env.PORT;
  if (rawPort === undefined || rawPort === '') {
    return DEFAULT_PORT;
  }
  const port = Number(rawPort);
  if (Number.isInteger(port) === false || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT value: "${rawPort}" - expected an integer between 1 and 65535`);
  }
  return port;
}

/**
 * Reads the CORS origin allowlist from the environment. `ALLOWED_ORIGINS`
 * accepts a comma-separated list (e.g. for non-localhost deployments);
 * unset/empty falls back to the local MFE dev-server ports. Entries are
 * trimmed and empties dropped so a stray comma cannot widen the allowlist.
 */
export function resolveAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const rawList = env.ALLOWED_ORIGINS;
  if (rawList === undefined || rawList.trim() === '') {
    return [...DEFAULT_ALLOWED_ORIGINS];
  }
  const origins = rawList
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
  if (origins.length === 0) {
    throw new Error('Invalid ALLOWED_ORIGINS value: no valid origins found');
  }
  return origins;
}
