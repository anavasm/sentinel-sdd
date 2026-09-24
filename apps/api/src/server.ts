import { createApp } from './app.js';
import { resolvePort } from './lib/config.js';

const app = createApp();
const port = resolvePort();

const server = app.listen(port, () => {
  // Bootstrap log only — structured logging (pino) lands with US-2+ modules.
  console.log(`[api] listening on http://localhost:${port}/api/v1`);
});

/** Graceful shutdown: stop accepting connections, close idle keep-alives. */
function shutdown(signal: string): void {
  console.log(`[api] received ${signal}, shutting down`);
  server.close((error) => {
    if (error !== undefined) {
      console.error('[api] error while closing server', error);
      process.exit(1);
    }
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
