import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { createApp } from '../src/app.js';
import { listenOnLoopback } from '../src/lib/listener.js';

/**
 * Smoke integration test (plan Task 1.3 / US1-AC1): the server actually boots
 * on a real socket (port 0 = ephemeral, CI-safe) and serves the /api/v1 base
 * path over real HTTP.
 */
describe('US-1 scaffolding — server bootstrap', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = listenOnLoopback(createApp(), 0);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.once('listening', resolve);
    });
    const rawAddress = server.address();
    if (rawAddress === null || typeof rawAddress === 'string') {
      throw new Error('Expected the API listener to bind to a TCP address.');
    }
    const address: AddressInfo = rawAddress;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
    expect(address.address).toBe('127.0.0.1');
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  });

  it('boots on a real port and serves /api/v1 over HTTP', async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});
