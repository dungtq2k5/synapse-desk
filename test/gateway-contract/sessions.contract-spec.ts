/**
 * @file `SessionsApi` — the caller's OWN device sessions. Every route needs
 * no permission at all (ownership IS the authorization); `revoke`'s cookie
 * clearing, conditioned on `wasCurrent`, is the sharpest row here.
 */

import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/contracts';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('sessions', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = 'ffffffff-1111-4111-8111-ffffffffffff';
  const USER = 'ffffffff-2222-4222-8222-ffffffffffff';

  const accessCookie = () =>
    sign(
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

  const headers = (refreshToken?: string) => ({
    cookie: [
      `${GATEWAY_ENV.JWT_ACCESS_NAME}=${accessCookie()}`,
      ...(refreshToken
        ? [`${GATEWAY_ENV.JWT_REFRESH_NAME}=${refreshToken}`]
        : []),
    ].join('; '),
  });

  const wireSession = (
    id: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    id,
    ipAddress: '127.0.0.1',
    userAgent: 'test',
    current: false,
    isTrusted: false,
    expiresAt: { seconds: 1_757_289_600, nanos: 0 },
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
    ...overrides,
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

  rowFor('Sessions')(
    '**`list` forwards the presented refresh token to mark `current`**',
    async () => {
      peers.auth.on('SessionService/ListSessions').reply({
        items: [wireSession('s1', { current: true })],
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/auth/sessions`,
        headers('refresh-abc'),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: [{ id: 's1', current: true }],
      });
      const [call] = peers.auth.calls('SessionService/ListSessions');
      expect(call.request).toMatchObject({ refreshToken: 'refresh-abc' });
    },
  );

  rowFor('Sessions')(
    '**`list` still answers when no refresh cookie is presented**',
    async () => {
      peers.auth
        .on('SessionService/ListSessions')
        .reply({ items: [wireSession('s2')] });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/auth/sessions`,
        headers(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: [{ id: 's2', current: false }],
      });
    },
  );

  rowFor('Sessions')(
    '**`revokeAllTrust` answers with the fixed message and the untrusted count**',
    async () => {
      peers.auth
        .on('SessionService/RevokeAllTrust')
        .reply({ untrustedCount: 3 });

      const response = await new Session(gateway.baseUrl).request(
        'DELETE',
        `${API}/auth/sessions/trusted`,
        {
          headers: headers(),
        },
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        message: 'Trusted devices cleared',
        data: { untrustedCount: 3 },
      });
    },
  );

  rowFor('Sessions')(
    "**`revoke` clears every session cookie plus the device-token cookie when the family was the caller's own**",
    async () => {
      const id = '11111111-9999-4999-8999-111111111111';
      peers.auth
        .on('SessionService/RevokeSession')
        .reply({ wasCurrent: true, revokedCount: 2 });

      const response = await new Session(gateway.baseUrl).request(
        'DELETE',
        `${API}/auth/sessions/${id}`,
        {
          headers: headers('refresh-xyz'),
        },
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        message: 'Session revoked',
        data: { revokedCount: 2 },
      });
      const names = response.setCookie.map((line) => line.split('=')[0]);
      expect(names).toEqual(
        expect.arrayContaining([
          GATEWAY_ENV.JWT_ACCESS_NAME,
          GATEWAY_ENV.JWT_REFRESH_NAME,
          GATEWAY_ENV.JWT_2FA_NAME,
          GATEWAY_ENV.TENANT_SELECTION_NAME,
          GATEWAY_ENV.DEVICE_TOKEN_NAME,
        ]),
      );
      const [call] = peers.auth.calls('SessionService/RevokeSession');
      expect(call.request).toMatchObject({
        sessionId: id,
        refreshToken: 'refresh-xyz',
      });
    },
  );

  rowFor('Sessions')(
    "**`revoke` clears no cookies when the revoked family was NOT the caller's own**",
    async () => {
      const id = '22222222-9999-4999-8999-222222222222';
      peers.auth
        .on('SessionService/RevokeSession')
        .reply({ wasCurrent: false, revokedCount: 1 });

      const response = await new Session(gateway.baseUrl).request(
        'DELETE',
        `${API}/auth/sessions/${id}`,
        {
          headers: headers(),
        },
      );

      expect(response.status).toBe(200);
      expect(response.setCookie).toHaveLength(0);
    },
  );

  rowFor('Sessions')(
    '**`revokeTrust` drops device trust and answers with the fixed message**',
    async () => {
      const id = '33333333-9999-4999-8999-333333333333';
      peers.auth
        .on('SessionService/RevokeSessionTrust')
        .reply({ untrustedCount: 1 });

      const response = await new Session(gateway.baseUrl).request(
        'DELETE',
        `${API}/auth/sessions/${id}/trust`,
        {
          headers: headers(),
        },
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        message: 'Device trust removed',
        data: { untrustedCount: 1 },
      });
      const [call] = peers.auth.calls('SessionService/RevokeSessionTrust');
      expect(call.request).toMatchObject({ sessionId: id });
    },
  );
});
