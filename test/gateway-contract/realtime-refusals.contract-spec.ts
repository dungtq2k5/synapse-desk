/**
 * @file A socket past the handshake budget is told why before it's dropped.
 *
 * Its own gateway with a budget of zero: the budget is keyed on the address
 * in the Redis every gateway of the run shares, so any positive limit would
 * depend on how many handshakes other specs made from the same address.
 */

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

describe('realtime refusals', () => {
  let peers: Peers;
  let gateway: Gateway;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    const { redisUrl, natsUrl } = readRunState();
    peers = await startPeers();
    gateway = await startGateway({
      ...peers.env,
      REDIS_URL: redisUrl,
      NATS_URL: natsUrl,
      WS_HANDSHAKE_LIMIT: '0',
    });
  }, 90_000);

  afterAll(async () => {
    for (const socket of sockets) socket.close();
    await gateway.stop();
    await peers.stop();
  });

  beforeEach(() => {
    peers.reset();
    peers.auth.on('OrganizationService/GetOrganizationStatus').always({
      status: toProtoOrgStatus(OrgStatus.ACTIVE),
      deleted: false,
    });
  });

  rowFor('Sessions')(
    '**past the handshake budget, a valid session is told `RATE_LIMITED`, then disconnected**',
    async () => {
      const socket = io(`${gateway.wsUrl}${REALTIME_SOCKET.namespace}`, {
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
        extraHeaders: {
          cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
            {
              sub: 'bbbbbbbb-6666-4666-8666-bbbbbbbbbbbb',
              organizationId: 'bbbbbbbb-5555-4555-8555-bbbbbbbbbbbb',
              isSuperAdmin: false,
              departmentIds: [],
              permissionCodes: [],
              isEmailVerified: true,
            },
            TEST_KEYS.access(),
            { algorithm: 'RS256', expiresIn: '15m' },
          )}`,
        },
      });
      sockets.push(socket);

      const refused = new Promise<[string | undefined, string]>((resolve) => {
        let code: string | undefined;
        socket.once(
          REALTIME_EVENTS.connectionRefused,
          (frame: { success: boolean; data: { code: string } }) => {
            expect(frame.success).toBe(false);
            code = frame.data.code;
          },
        );
        socket.once('disconnect', (reason) => resolve([code, reason]));
      });

      await expect(refused).resolves.toEqual([
        CONNECTION_REFUSED_CODES.rateLimited,
        'io server disconnect',
      ]);
    },
  );
});
