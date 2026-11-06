import type { Server } from "node:http";
import type { Express } from "express";

/** The unauthenticated PoC API must not listen on non-loopback interfaces. */
export const API_LOOPBACK_HOST = "127.0.0.1";

/** Starts the API on IPv4 loopback only. */
export function listenOnLoopback(
  app: Express,
  port: number,
  onListening?: () => void,
): Server {
  return app.listen(port, API_LOOPBACK_HOST, onListening);
}
