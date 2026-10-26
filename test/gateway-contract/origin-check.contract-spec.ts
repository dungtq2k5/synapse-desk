/**
 * @file **A state-changing request with a foreign `Origin` is refused, 403, before any
 * peer.** Defense in depth beside `SameSite=Lax` cookies: Lax counts a sibling subdomain
 * as same-site, and a bodiless cross-site `POST` passes the JSON-only rule. An allowed
 * origin, the gateway's own, and no `Origin` at all pass; a read is never refused for
 * its `Origin`. A `text/plain` body from an allowed origin is still a 415.
 */

import { API } from './client';
import { type Gateway, startGateway } from './gateway';
import { type Peers, startPeers } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('the Origin check', () => {
  let gateway: Gateway;
  let peers: Peers;

  /** The first origin the contract env allows. */
  const ALLOWED = 'http://localhost:5173';
  const FOREIGN = 'https://evil.example.com';

  const send = (
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: string,
  ) => fetch(`${gateway.baseUrl}${API}${path}`, { method, headers, body });

  const login = (headers: Record<string, string>) =>
    send(
      'POST',
      '/auth/login',
      { 'content-type': 'application/json', ...headers },
      JSON.stringify({ email: 'nobody@example.test', password: 'x' }),
    );

  beforeAll(async () => {
    const { redisUrl, natsUrl } = readRunState();
    peers = await startPeers();
    gateway = await startGateway({
      ...peers.env,
      REDIS_URL: redisUrl,
      NATS_URL: natsUrl,
    });
  }, 90_000);

  afterAll(async () => {
    await gateway.stop();
    await peers.stop();
  });

  rowFor('Auth')(
    '**a foreign Origin on a POST is refused with 403, and no peer is asked**',
    async () => {
      const response = await login({ origin: FOREIGN });

      expect(response.status).toBe(403);
      expect(peers.auth.calls('AuthService/Login')).toEqual([]);
    },
  );

  rowFor('Auth')('**a bodiless cross-site POST is refused too**', async () => {
    const response = await send('POST', '/auth/logout', { origin: FOREIGN });

    expect(response.status).toBe(403);
  });

  rowFor('Auth')(
    '**an allowed origin, the gateway’s own, and no Origin all pass the check**',
    async () => {
      const own = new URL(gateway.baseUrl).origin;
      const statuses = [
        (await login({ origin: ALLOWED })).status,
        (await login({ origin: own })).status,
        (await login({})).status,
      ];

      expect(statuses.filter((status) => status === 403)).toEqual([]);
    },
  );

  rowFor('Auth')('**a GET is never refused for its Origin**', async () => {
    const response = await send('GET', '/auth/otp/status', {
      origin: FOREIGN,
    });

    expect(response.status).not.toBe(403);
  });

  rowFor('Auth')(
    '**a text/plain body from an allowed origin is still a 415**',
    async () => {
      const response = await send(
        'POST',
        '/auth/login',
        { origin: ALLOWED, 'content-type': 'text/plain' },
        '{"email":"nobody@example.test","password":"x"}',
      );

      expect(response.status).toBe(415);
    },
  );
});
