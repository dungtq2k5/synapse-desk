/**
 * @file A lock date is a full date-time with an offset, or it is refused with 400.
 *
 * `lockedUntil` becomes an instant on its way to auth-service, and a date with no time
 * or a time with no offset does not say which instant was meant. So only the form that
 * does is accepted, and every other form is refused before any peer is asked, naming the
 * field — never passed through and failed later, which is how these forms used to answer
 * 500.
 */

import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

const ORGANIZATION = 'dddddddd-1111-4111-8111-dddddddddddd';
const TARGET_USER = 'dddddddd-3333-4333-8333-dddddddddddd';

const cookie = {
  cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
    {
      sub: 'dddddddd-2222-4222-8222-dddddddddddd',
      organizationId: ORGANIZATION,
      isSuperAdmin: false,
      departmentIds: [],
      permissionCodes: ['user.lock'],
      isEmailVerified: true,
    },
    TEST_KEYS.access(),
    { algorithm: 'RS256', expiresIn: '15m' },
  )}`,
};

describe('the lock date', () => {
  let gateway: Gateway;
  let peers: Peers;

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
    peers.auth.on('UserService/LockUser').always({ revokedSessionCount: 0 });
  });

  const lock = (lockedUntil: string) =>
    new Session(gateway.baseUrl).request<{ error?: unknown }>(
      'POST',
      `${API}/users/${TARGET_USER}/lock`,
      { body: { reason: 'Policy breach', lockedUntil }, headers: cookie },
    );

  rowFor('User Admin')(
    '**a date-time with an offset locks until that instant**',
    async () => {
      const response = await lock('2999-01-01T00:00:00+07:00');

      expect(response.status).toBe(200);
      const [call] = peers.auth.calls('UserService/LockUser');
      // 00:00 at +07:00 is 17:00 the day before in UTC.
      expect(call.request).toMatchObject({
        lockedUntil: {
          seconds: Date.parse('2998-12-31T17:00:00Z') / 1000,
        },
      });
    },
  );

  rowFor('User Admin').each([
    ['a date alone', '2999-01-01'],
    ['the basic form', '29990101'],
    ['an ordinal date', '2999-001'],
    ['a week date', '2999-W01'],
    ['a date-time with no offset', '2999-01-01T00:00:00'],
  ])(
    '**%s is refused with 400, naming the field, before any peer**',
    async (_kind, lockedUntil) => {
      const response = await lock(lockedUntil);

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body?.error)).toContain('lockedUntil');
      expect(peers.auth.calls('UserService/LockUser')).toHaveLength(0);
    },
  );
});
