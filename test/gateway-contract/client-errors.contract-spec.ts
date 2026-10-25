/**
 * @file `POST /client-errors`: a browser error becomes one WARN line with
 * `"event":"client_error"`, signed in or out, and nothing is stored.
 *
 * The line is read from the gateway's own output, and the counter from its
 * metrics port. Each row reports from its own address (`X-Forwarded-For`),
 * because the limit is per address.
 */

import { sign } from 'jsonwebtoken';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('client-errors', () => {
  let gateway: Gateway;
  let peers: Peers;
  let address = 0;

  const USER = 'ffffffff-6666-4666-8666-ffffffffffff';
  const ORGANIZATION = 'ffffffff-7777-4777-8777-ffffffffffff';

  /** A fresh caller address, so no row spends another's budget. */
  const from = () => ({ 'x-forwarded-for': `198.51.100.${++address}` });

  const signedIn = () => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
      {
        sub: USER,
        organizationId: ORGANIZATION,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes: [],
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    )}`,
  });

  const report = (
    message: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    kind: 'error',
    message,
    stack: 'Error: boom\n    at render (page.js:1:1)',
    path: '/tickets/42?q=secret#reply',
    buildId: 'abc1234',
    ...overrides,
  });

  /** The client_error lines carrying `message`, parsed. */
  const linesFor = (message: string): Record<string, unknown>[] =>
    gateway
      .output()
      .split('\n')
      .filter((line) => line.includes('client_error') && line.includes(message))
      .map((line) => {
        const json = line.slice(line.indexOf('{'), line.lastIndexOf('}') + 1);
        return JSON.parse(json) as Record<string, unknown>;
      });

  const post = (body: unknown, headers: Record<string, string>) =>
    new Session(gateway.baseUrl).post(`${API}/client-errors`, body, headers);

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

  rowFor('Client errors')(
    '**signed out: 204, and one line with the path but not its query or fragment**',
    async () => {
      const message = `signed-out-${Date.now()}`;

      const response = await post(report(message), from());

      expect(response.status).toBe(204);
      expect(linesFor(message)).toEqual([
        expect.objectContaining({
          event: 'client_error',
          kind: 'error',
          path: '/tickets/42',
          buildId: 'abc1234',
        }),
      ]);
      expect(JSON.stringify(linesFor(message))).not.toContain('secret');
    },
  );

  rowFor('Client errors')(
    '**signed in: the user and organization ids are on the line**',
    async () => {
      const message = `signed-in-${Date.now()}`;

      const response = await post(report(message, { kind: 'boundary' }), {
        ...from(),
        ...signedIn(),
      });

      expect(response.status).toBe(204);
      expect(linesFor(message)).toEqual([
        expect.objectContaining({
          kind: 'boundary',
          userId: USER,
          organizationId: ORGANIZATION,
        }),
      ]);
    },
  );

  rowFor('Client errors')(
    '**over 8 KB is refused with 413, and nothing is logged**',
    async () => {
      const message = `too-big-${Date.now()}`;

      const response = await post(
        report(message, { stack: 'x'.repeat(9 * 1024) }),
        from(),
      );

      expect(response.status).toBe(413);
      expect(linesFor(message)).toEqual([]);
    },
  );

  rowFor('Client errors')(
    '**rate-limited per address: the eleventh report in a minute is a 429**',
    async () => {
      const address = from();
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 11; attempt++) {
        statuses.push((await post(report(`limit-${attempt}`), address)).status);
      }

      expect(statuses).toEqual([...Array<number>(10).fill(204), 429]);
    },
  );

  rowFor('Client errors')(
    '**each report is counted by kind on the metrics port**',
    async () => {
      await post(
        report(`counted-${Date.now()}`, { kind: 'rejection' }),
        from(),
      );

      const metrics = await (
        await fetch(`${gateway.metricsUrl}/metrics`)
      ).text();

      expect(metrics).toMatch(
        /client_errors_total\{[^}]*kind="rejection"[^}]*\} [1-9]/,
      );
    },
  );
});
