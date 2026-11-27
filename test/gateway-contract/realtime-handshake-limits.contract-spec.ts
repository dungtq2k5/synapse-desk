/**
 * @file The socket handshake's limits, in layers (gap 54).
 *
 * - **Flood ceiling**, per client address, before the token is checked.
 * - **Failed handshakes**, per client address, charged only by a handshake
 *   with no verified identity: no cookie, a bad signature, a malformed token.
 * - **Per user**, by the verified `sub`, an expired token's included.
 *
 * Past any limit a handshake is refused `RATE_LIMITED`; a bad cookie is
 * refused `UNAUTHENTICATED`. Each refusal is counted once in
 * `websocket_handshakes_refused_total` under its reason.
 *
 * This file's gateway runs low limits of its own (flood 50, failed 3, per
 * user 3), so nothing else in the run is throttled by them. Every row
 * connects from its own client address (`X-Forwarded-For`, the rightmost
 * entry) and with its own users, so rows don't share a budget.
 */

import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { sign } from 'jsonwebtoken';
import {
  CONNECTION_REFUSED_CODES,
  OrgStatus,
  REALTIME_EVENTS,
  REALTIME_SOCKET,
} from '@synapsedesk/contracts';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

const FLOOD = 50;
const FAILED = 3;
const PER_USER = 3;

describe('the socket handshake limits', () => {
  let peers: Peers;
  let gateway: Gateway;
  const sockets: Socket[] = [];

  const ORGANIZATION = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';
  const forger = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;

  const claims = (sub: string) => ({
    sub,
    organizationId: ORGANIZATION,
    isSuperAdmin: false,
    departmentIds: [],
    permissionCodes: [],
    isEmailVerified: true,
  });
  const valid = (sub: string) =>
    sign(claims(sub), TEST_KEYS.access(), {
      algorithm: 'RS256',
      expiresIn: '15m',
    });
  /** Signed by the gateway's key, but past its expiry: a verified identity. */
  const expired = (sub: string) =>
    sign(
      { ...claims(sub), exp: Math.floor(Date.now() / 1000) - 60 },
      TEST_KEYS.access(),
      { algorithm: 'RS256' },
    );
  /** Signed by a key the gateway doesn't trust: no verified identity. */
  const forged = (sub: string) =>
    sign(claims(sub), forger, { algorithm: 'RS256', expiresIn: '15m' });

  /** A client address and users no other row uses. */
  const address = () =>
    `198.18.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;
  const user = () => randomUUID();

  /** One handshake from `ip`: `ready`, or the code it was refused with. */
  const open = (ip: string, token?: string) =>
    new Promise<string>((resolve, reject) => {
      const socket = io(`${gateway.wsUrl}${REALTIME_SOCKET.namespace}`, {
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
        extraHeaders: {
          'x-forwarded-for': `203.0.113.250, ${ip}`,
          ...(token
            ? { cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${token}` }
            : {}),
        },
      });
      sockets.push(socket);
      const timer = setTimeout(
        () => reject(new Error('no answer to the handshake')),
        10_000,
      );
      socket.once(REALTIME_EVENTS.connectionReady, () => {
        clearTimeout(timer);
        socket.close();
        resolve('ready');
      });
      socket.once(
        REALTIME_EVENTS.connectionRefused,
        (frame: { data: { code: string } }) => {
          clearTimeout(timer);
          resolve(frame.data.code);
        },
      );
      socket.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

  const inOrder = async (
    n: number,
    handshake: (i: number) => Promise<string>,
  ) => {
    const answers: string[] = [];
    for (let i = 0; i < n; i++) answers.push(await handshake(i));
    return answers;
  };

  /** `reason` -> count of `websocket_handshakes_refused_total`, on one scrape. */
  const refused = async (): Promise<Record<string, number>> => {
    const body = await (await fetch(`${gateway.metricsUrl}/metrics`)).text();
    const counts: Record<string, number> = {};
    for (const line of body.split('\n')) {
      const match =
        /^websocket_handshakes_refused_total\{reason="([^"]+)"\}\s+(\S+)$/u.exec(
          line,
        );
      if (match) counts[match[1]] = Number(match[2]);
    }
    return counts;
  };
  /** What `action` added to each reason. */
  const counted = async (action: () => Promise<unknown>) => {
    const before = await refused();
    await action();
    const after = await refused();
    return Object.fromEntries(
      Object.entries(after)
        .map(([reason, n]) => [reason, n - (before[reason] ?? 0)] as const)
        .filter(([, n]) => n > 0),
    );
  };

  const { rateLimited, unauthenticated } = CONNECTION_REFUSED_CODES;

  beforeAll(async () => {
    const { redisUrl, natsUrl } = readRunState();
    peers = await startPeers();
    peers.auth.on('OrganizationService/GetOrganizationStatus').always({
      status: toProtoOrgStatus(OrgStatus.ACTIVE),
      deleted: false,
    });
    gateway = await startGateway({
      ...peers.env,
      REDIS_URL: redisUrl,
      NATS_URL: natsUrl,
      WS_HANDSHAKE_LIMIT: String(FLOOD),
      WS_HANDSHAKE_FAILED_LIMIT: String(FAILED),
      WS_HANDSHAKE_USER_LIMIT: String(PER_USER),
    });
  }, 90_000);

  afterAll(async () => {
    for (const socket of sockets) socket.close();
    await gateway.stop();
    await peers.stop();
  });

  rowFor('Sessions')(
    '**an office: many verified users from one address all connect** — past the failed and per-user limits in total, because neither keys on the address for them',
    async () => {
      const office = address();

      const answers = await inOrder(40, () => open(office, valid(user())));

      expect(answers).toEqual(Array.from({ length: 40 }, () => 'ready'));
    },
  );

  rowFor('Sessions')(
    '**one account in a loop is refused past the per-user limit**, while another user from the same address still connects',
    async () => {
      const office = address();
      const looping = user();

      const result = await counted(async () => {
        expect(
          await inOrder(PER_USER + 1, () => open(office, valid(looping))),
        ).toEqual([
          ...Array.from({ length: PER_USER }, () => 'ready'),
          rateLimited,
        ]);
        expect(await open(office, valid(user()))).toBe('ready');
      });

      expect(result).toEqual({ 'per-user': 1 });
    },
  );

  rowFor('Sessions')(
    '**forged tokens are refused past the failed-handshake limit**, while a valid user from the same address still connects',
    async () => {
      const office = address();

      const result = await counted(async () => {
        expect(
          await inOrder(FAILED + 1, () => open(office, forged(user()))),
        ).toEqual([
          ...Array.from({ length: FAILED }, () => unauthenticated),
          rateLimited,
        ]);
        expect(await open(office, valid(user()))).toBe('ready');
      });

      expect(result).toEqual({
        unauthenticated: FAILED,
        'failed-handshakes': 1,
      });
    },
  );

  rowFor('Sessions')(
    '**no cookie spends the failed-handshake limit too**',
    async () => {
      const office = address();

      expect(await inOrder(FAILED + 1, () => open(office))).toEqual([
        ...Array.from({ length: FAILED }, () => unauthenticated),
        rateLimited,
      ]);
    },
  );

  rowFor('Sessions')(
    '**an expired token is a verified identity: it spends the per-user limit, never the address’s failed-handshake limit**',
    async () => {
      const office = address();
      const returning = user();

      const result = await counted(async () => {
        // Past the failed limit in total, each one still told to sign in.
        expect(
          await inOrder(FAILED + 2, () => open(office, expired(user()))),
        ).toEqual(Array.from({ length: FAILED + 2 }, () => unauthenticated));
        // One user's expired tokens, past the per-user limit.
        expect(
          await inOrder(PER_USER + 1, () => open(office, expired(returning))),
        ).toEqual([
          ...Array.from({ length: PER_USER }, () => unauthenticated),
          rateLimited,
        ]);
      });

      expect(result).toEqual({
        unauthenticated: FAILED + 2 + PER_USER,
        'per-user': 1,
      });
    },
  );

  rowFor('Sessions')(
    '**a flood: past the ceiling, any handshake from the address is refused**',
    async () => {
      const flooding = address();

      const result = await counted(async () => {
        const answers = await inOrder(FLOOD, () =>
          open(flooding, valid(user())),
        );
        expect(answers.every((answer) => answer === 'ready')).toBe(true);
        expect(await open(flooding, valid(user()))).toBe(rateLimited);
        expect(await open(flooding)).toBe(rateLimited);
      });

      expect(result).toEqual({ flood: 2 });
    },
  );
});
