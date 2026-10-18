/**
 * @file A revoked session stops at once, REST and socket.
 *
 * An access token names its session family in `sid`. Revoking a session, in
 * auth-service, writes `revoked-session:{familyId}` to the Redis the gateway
 * reads; the gateway then refuses that family's tokens on their next call and
 * disconnects their sockets, rather than letting them run to expiry. auth-service
 * is a fake here, so the row writes the key as auth-service does.
 */

import Redis from 'ioredis';
import { io, type Socket } from 'socket.io-client';
import { sign } from 'jsonwebtoken';
import {
  CONNECTION_REFUSED_CODES,
  OrgStatus,
  REALTIME_EVENTS,
  REALTIME_SOCKET,
  REVOKED_SESSION_KEY_PREFIX,
} from '@synapsedesk/contracts';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('revoked sessions', () => {
  const ORGANIZATION = 'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';
  const USER = 'aaaaaaaa-6666-4666-8666-aaaaaaaaaaaa';

  let peers: Peers;
  let gateway: Gateway;
  let redis: Redis;
  const sockets: Socket[] = [];

  /** A family of its own per call, so a rerun never finds an old mark. */
  const family = () => crypto.randomUUID();

  const cookieFor = (sid: string) => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
      {
        sub: USER,
        organizationId: ORGANIZATION,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes: [],
        isEmailVerified: true,
        sid,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    )}`,
  });

  const listSessions = (sid: string) =>
    new Session(gateway.baseUrl).get(`${API}/auth/sessions`, cookieFor(sid));

  /** Connected and ready, as a browser connects: websocket, cookie, `/ws`. */
  const connectAs = async (sid: string) => {
    const socket = io(`${gateway.wsUrl}${REALTIME_SOCKET.namespace}`, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      extraHeaders: cookieFor(sid),
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('not ready')), 10_000);
      socket.once(REALTIME_EVENTS.connectionReady, () => {
        clearTimeout(timer);
        resolve();
      });
    });
    return socket;
  };

  /** The refusal's code, then the disconnect's reason, in the order they came. */
  const refusal = (socket: Socket) =>
    new Promise<[string | undefined, string]>((resolve) => {
      let code: string | undefined;
      socket.once(
        REALTIME_EVENTS.connectionRefused,
        (frame: { data: { code: string } }) => {
          code = frame.data.code;
        },
      );
      socket.once('disconnect', (reason) => resolve([code, reason]));
    });

  beforeAll(async () => {
    const { redisUrl, natsUrl } = readRunState();
    redis = new Redis(redisUrl);
    peers = await startPeers();
    gateway = await startGateway({
      ...peers.env,
      REDIS_URL: redisUrl,
      NATS_URL: natsUrl,
    });
  }, 90_000);

  afterAll(async () => {
    for (const socket of sockets) socket.close();
    redis.disconnect();
    await gateway.stop();
    await peers.stop();
  });

  beforeEach(() => {
    peers.reset();
    peers.auth.on('OrganizationService/GetOrganizationStatus').always({
      status: toProtoOrgStatus(OrgStatus.ACTIVE),
      deleted: false,
    });
    peers.auth.on('SessionService/ListSessions').always({ items: [] });
  });

  rowFor('Sessions')(
    '**signing session A out from session B: A is refused on its next call, and its socket is disconnected**',
    async () => {
      const a = family();
      const b = family();
      expect((await listSessions(a)).status).toBe(200);
      const socket = await connectAs(a);
      const disconnected = refusal(socket);

      peers.auth
        .on('SessionService/RevokeSession')
        .reply({ wasCurrent: false, revokedCount: 1 });
      const revoked = await new Session(gateway.baseUrl).request(
        'DELETE',
        `${API}/auth/sessions/${a}`,
        { headers: cookieFor(b) },
      );
      expect(revoked.status).toBe(200);
      // As auth-service marks the family it deleted.
      await redis.set(`${REVOKED_SESSION_KEY_PREFIX}${a}`, '1', 'EX', 60);

      expect((await listSessions(a)).status).toBe(401);
      expect((await listSessions(b)).status).toBe(200);
      // The sweep runs every 5 seconds.
      await expect(disconnected).resolves.toEqual([
        CONNECTION_REFUSED_CODES.unauthenticated,
        'io server disconnect',
      ]);
    },
    20_000,
  );

  rowFor('Sessions')(
    "**a revoked session's socket is refused at the handshake**",
    async () => {
      const a = family();
      await redis.set(`${REVOKED_SESSION_KEY_PREFIX}${a}`, '1', 'EX', 60);

      const socket = io(`${gateway.wsUrl}${REALTIME_SOCKET.namespace}`, {
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
        extraHeaders: cookieFor(a),
      });
      sockets.push(socket);

      await expect(refusal(socket)).resolves.toEqual([
        CONNECTION_REFUSED_CODES.unauthenticated,
        'io server disconnect',
      ]);
    },
  );

  rowFor('Sessions')(
    '**a socket with no session cookie is refused as unauthenticated**',
    async () => {
      const socket = io(`${gateway.wsUrl}${REALTIME_SOCKET.namespace}`, {
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
        extraHeaders: { cookie: 'other=1' },
      });
      sockets.push(socket);

      await expect(refusal(socket)).resolves.toEqual([
        CONNECTION_REFUSED_CODES.unauthenticated,
        'io server disconnect',
      ]);
    },
  );

  rowFor('Sessions')(
    '**a token from before `sid` existed is accepted until it expires**',
    async () => {
      const old = sign(
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
      );

      const response = await new Session(gateway.baseUrl).get(
        `${API}/auth/sessions`,
        { cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${old}` },
      );

      expect(response.status).toBe(200);
    },
  );
});
