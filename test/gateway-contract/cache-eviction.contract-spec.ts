/**
 * @file A write through the gateway evicts the gateway's own cached read of what it
 * changed, in the writer's tenant only.
 *
 * Each row seeds the scope's keys in Redis DIRECTLY — for its own tenant, so no other
 * row's entries decide the answer, and for a second tenant as the control — then makes
 * the write and reads the keys back. Seeded rather than warmed through a read: what is
 * under test is the eviction, and a read route's own caching is held where that route
 * is. Redis is reached as `cache-invalidation.contract-spec.ts` reaches it: shared
 * infrastructure, not the gateway's process.
 *
 * A write in a controller beside a cached read is held from the code by
 * `EvictsCacheCoverageTest`; these rows add the writes in OTHER controllers that change
 * the same answer (a user's roles, an accepted invitation), which no scan can find.
 */

import Redis from 'ioredis';
import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

const USER = 'cccccccc-2222-4222-8222-cccccccccccc';
const OTHER_TENANT = 'cccccccc-9999-4999-8999-cccccccccccc';
const AT = { seconds: 1_756_684_800, nanos: 0 };

const cookie = (tenant: string, permissionCodes: string[]) => ({
  cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
    {
      sub: USER,
      organizationId: tenant,
      isSuperAdmin: false,
      departmentIds: [],
      permissionCodes,
      isEmailVerified: true,
    },
    TEST_KEYS.access(),
    { algorithm: 'RS256', expiresIn: '15m' },
  )}`,
});

const wireUser = (tenant: string) => ({
  id: USER,
  organizationId: tenant,
  fullName: 'Ada Lovelace',
  email: 'ada@example.com',
  isEmailVerified: true,
  isPhoneVerified: false,
  isLocked: false,
  isTwoFactorEnabled: false,
  createdAt: AT,
  updatedAt: AT,
});

describe('a write evicts the cached read it changes', () => {
  let gateway: Gateway;
  let peers: Peers;
  let redis: Redis;

  beforeAll(async () => {
    const { redisUrl, natsUrl } = readRunState();
    peers = await startPeers();
    gateway = await startGateway({
      ...peers.env,
      REDIS_URL: redisUrl,
      NATS_URL: natsUrl,
    });
    redis = new Redis(redisUrl);
  }, 90_000);

  afterAll(async () => {
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
  });

  /** Two entries per scope: one keyed by parameters, one bare, as the gateway writes them. */
  const seed = async (tenant: string, scope: string) => {
    await redis.set(`cache:${tenant}|${scope}|page=1`, '{}');
    await redis.set(`cache:${tenant}|${scope}|`, '{}');
    await redis.set(`cache:${OTHER_TENANT}|${scope}|`, '{}');
  };

  /** The writer's entries gone, the other tenant's untouched. */
  const expectEvicted = async (tenant: string, scope: string) => {
    expect(await redis.keys(`cache:${tenant}|${scope}|*`)).toEqual([]);
    expect(await redis.exists(`cache:${OTHER_TENANT}|${scope}|`)).toBe(1);
  };

  rowFor('Departments')(
    '**renaming a department evicts the cached department list**',
    async () => {
      const tenant = 'cccccccc-1111-4111-8111-000000000001';
      const id = 'cccccccc-3333-4333-8333-cccccccccccc';
      await seed(tenant, 'departments');
      peers.auth.on('DepartmentService/UpdateDepartment').reply({
        id,
        name: 'Customer Support',
        description: 'Front line',
        memberCount: 3,
        createdAt: AT,
        updatedAt: AT,
      });

      const response = await new Session(gateway.baseUrl).request(
        'PATCH',
        `${API}/departments/${id}`,
        {
          body: { name: 'Customer Support' },
          headers: cookie(tenant, ['department.update']),
        },
      );

      expect(response.status).toBe(200);
      await expectEvicted(tenant, 'departments');
    },
  );

  rowFor('Roles')(
    '**renaming a role evicts the cached role list**',
    async () => {
      const tenant = 'cccccccc-1111-4111-8111-000000000002';
      const id = 'cccccccc-4444-4444-8444-cccccccccccc';
      await seed(tenant, 'roles');
      peers.auth.on('RoleService/UpdateRole').reply({
        id,
        name: 'Senior Agent',
        description: 'Front line',
        isSystemRole: false,
        userAssigned: 3,
        permissionCodes: ['ticket.read.all'],
        createdAt: AT,
        updatedAt: AT,
      });

      const response = await new Session(gateway.baseUrl).request(
        'PATCH',
        `${API}/roles/${id}`,
        {
          body: { name: 'Senior Agent' },
          headers: cookie(tenant, ['role.update']),
        },
      );

      expect(response.status).toBe(200);
      await expectEvicted(tenant, 'roles');
    },
  );

  rowFor('Organizations')(
    '**updating the organization evicts its cached read**',
    async () => {
      const tenant = 'cccccccc-1111-4111-8111-000000000003';
      await seed(tenant, 'organizations');
      peers.auth.on('OrganizationService/UpdateOrganization').reply({
        id: tenant,
        name: 'Acme Corp',
        slug: 'acme',
        status: toProtoOrgStatus(OrgStatus.ACTIVE),
        enforceTwoFactor: false,
        allowedEmailDomains: [],
        maxAgentSeats: 10,
        maxStorageBytes: '1000000000',
        monthlyAiTokenBudget: '5000000',
        aiModelTier: 'AI_MODEL_TIER_FAST',
        billingCycleStart: AT,
        maxDocumentBytes: '104857600',
        maxAttachmentBytes: '10485760',
        maxDocumentUploads: 100,
        maxAnalyticsRangeDays: 90,
        createdAt: AT,
        updatedAt: AT,
      });

      const response = await new Session(gateway.baseUrl).request(
        'PATCH',
        `${API}/organizations/current`,
        {
          body: { name: 'Acme Corp' },
          headers: cookie(tenant, ['organization.update']),
        },
      );

      expect(response.status).toBe(200);
      await expectEvicted(tenant, 'organizations');
    },
  );

  rowFor('User Admin')(
    "**setting a user's roles evicts the cached role list, which counts them**",
    async () => {
      const tenant = 'cccccccc-1111-4111-8111-000000000004';
      await seed(tenant, 'roles');
      peers.auth.on('UserService/SetUserRoles').reply({
        user: wireUser(tenant),
        roleIds: ['44444444-4444-4444-8444-444444444444'],
        roleNames: ['Agent'],
        departmentIds: [],
      });

      const response = await new Session(gateway.baseUrl).request(
        'PUT',
        `${API}/users/${USER}/roles`,
        {
          body: { roleIds: ['44444444-4444-4444-8444-444444444444'] },
          headers: cookie(tenant, ['user.role.assign']),
        },
      );

      expect(response.status).toBe(200);
      await expectEvicted(tenant, 'roles');
    },
  );

  rowFor('Invitations')(
    "**accepting an invitation evicts the invitee's tenant's role and department lists**",
    async () => {
      // No session: the tenant is the one the peer accepted the invitee into.
      const tenant = 'cccccccc-1111-4111-8111-000000000005';
      await seed(tenant, 'roles');
      await seed(tenant, 'departments');
      peers.auth.on('InvitationService/AcceptInvitation').reply({
        accessToken: 'access-tok',
        refreshToken: 'refresh-tok',
        user: wireUser(tenant),
        skipped: [],
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/users/invitations/accept`,
        {
          token: 'tok_abc123',
          fullName: 'Ada Lovelace',
          password: 'super-secret-1',
        },
      );

      expect(response.status).toBe(200);
      await expectEvicted(tenant, 'roles');
      await expectEvicted(tenant, 'departments');
    },
  );
});
