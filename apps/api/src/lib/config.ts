const DEFAULT_PORT = 3000;

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
