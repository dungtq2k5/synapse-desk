/**
 * @file `UserSessionsApi` — the admin view of another user's sessions. Two
 * operations, two DISTINCT permission codes (`user.session.read` /
 * `user.session.revoke`), the first real exercise of `apiNameFor`'s
 * multi-word path (`'User Sessions'` -> `UserSessionsApi`) in production use
 * rather than a direct unit check.
 */

import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('user sessions', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = '11111111-1111-4111-8111-111111111111';
  const ADMIN = '22222222-2222-4222-8222-222222222222';
  const TARGET_USER = '33333333-3333-4333-8333-333333333333';

  const accessToken = (permissionCodes: string[] = []) =>
    sign(
      {
        sub: ADMIN,
        organizationId: ORGANIZATION,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes,
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    );

  const cookie = (permissionCodes: string[] = []) => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${accessToken(permissionCodes)}`,
  });

  const wireSession = () => ({
    id: '44444444-4444-4444-8444-444444444444',
    ipAddress: '203.0.113.7',
    userAgent: 'Mozilla/5.0',
    current: false,
    isTrusted: true,
    trustedUntil: { seconds: 1_756_684_800, nanos: 0 },
    expiresAt: { seconds: 1_756_771_200, nanos: 0 },
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
  });

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

  beforeEach(() => {
    peers.reset();
    peers.auth.on('OrganizationService/GetOrganizationStatus').always({
      status: toProtoOrgStatus(OrgStatus.ACTIVE),
      deleted: false,
    });
  });

  rowFor('User Sessions')(
    '**listing refuses a caller without `user.session.read`**',
    async () => {
      const response = await new Session(gateway.baseUrl).get(
        `${API}/users/${TARGET_USER}/sessions`,
        cookie([]),
      );

      expect(response.status).toBe(403);
      expect(peers.auth.calls('SessionService/ListUserSessions')).toHaveLength(
        0,
      );
    },
  );

  rowFor('User Sessions')(
    'a caller WITH `user.session.read` sees the target user’s sessions, keyed by the path `userId`',
    async () => {
      peers.auth
        .on('SessionService/ListUserSessions')
        .reply({ items: [wireSession()] });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/users/${TARGET_USER}/sessions`,
        cookie(['user.session.read']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: [
          {
            id: '44444444-4444-4444-8444-444444444444',
            current: false,
            isTrusted: true,
          },
        ],
      });

      const [call] = peers.auth.calls('SessionService/ListUserSessions');
      expect(call.request).toMatchObject({ userId: TARGET_USER });
    },
  );

  rowFor('User Sessions')(
    '**revoking refuses a caller who only has `user.session.read`** — the two codes are distinct, not one gate for the module',
    async () => {
      const response = await new Session(gateway.baseUrl).request(
        'DELETE',
        `${API}/users/${TARGET_USER}/sessions`,
        { headers: cookie(['user.session.read']) },
      );

      expect(response.status).toBe(403);
      expect(
        peers.auth.calls('SessionService/RevokeUserSessions'),
      ).toHaveLength(0);
    },
  );

  rowFor('User Sessions')(
    'a caller WITH `user.session.revoke` force-logs-out the target user, keyed by the path `userId`',
    async () => {
      peers.auth
        .on('SessionService/RevokeUserSessions')
        .reply({ revokedCount: 3 });

      const response = await new Session(gateway.baseUrl).request(
        'DELETE',
        `${API}/users/${TARGET_USER}/sessions`,
        { headers: cookie(['user.session.revoke']) },
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: { revokedCount: 3 } });

      const [call] = peers.auth.calls('SessionService/RevokeUserSessions');
      expect(call.request).toMatchObject({ userId: TARGET_USER });
    },
  );
});
