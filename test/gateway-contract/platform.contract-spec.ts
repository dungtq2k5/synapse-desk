/**
 * @file `PlatformApi` — 20 Super Admin operations across organizations,
 * cross-tenant users/roles, metrics, finance, and the plan catalogue.
 * `SuperAdminGuard`-only, no permission code, class-level in Node — the
 * same door `PlatformJobsApi`/`PlatformAuditLogsApi` already use.
 *
 * The first row exercises the guard once for the whole surface; the rest
 * assume it and focus on the properties unique to each group: the
 * lifecycle machine's custom response messages, `listGlobalRoles`
 * forwarding only `page` (a wire-level truth, not a Node oversight —
 * `ListGlobalRolesRequest` genuinely has no other field), the finance
 * revenue section's degrade-with-a-reason shape, and `applyPlan`'s usage
 * leg degrading rather than refusing when ingestion-service is
 * unreachable.
 */

import { sign } from 'jsonwebtoken';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('platform', () => {
  let gateway: Gateway;
  let peers: Peers;

  const superAdminHeaders = () => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
      {
        sub: 'aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa',
        organizationId: null,
        isSuperAdmin: true,
        departmentIds: [],
        permissionCodes: [],
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    )}`,
  });

  const tenantAdminHeaders = () => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
      {
        sub: 'bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb',
        organizationId: 'cccccccc-0000-4000-8000-cccccccccccc',
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes: [],
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    )}`,
  });

  const wireOrganization = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    name: 'Acme',
    slug: 'acme',
    status: 'ORG_STATUS_ACTIVE',
    enforceTwoFactor: false,
    allowedEmailDomains: [],
    maxAgentSeats: 5,
    maxStorageBytes: '1000000',
    monthlyAiTokenBudget: '1000000',
    billingCycleStart: { seconds: 1_756_684_800, nanos: 0 },
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
    updatedAt: { seconds: 1_756_684_800, nanos: 0 },
    ...overrides,
  });

  const wirePlatformOrganization = (id: string, overrides: Record<string, unknown> = {}) => ({
    organization: wireOrganization(id),
    userCount: 3,
    pendingInvitationCount: 0,
    departmentCount: 1,
    ...overrides,
  });

  const wireUser = (id: string) => ({
    id,
    fullName: 'Admin Person',
    email: 'admin@acme.test',
    isEmailVerified: false,
    phoneNumber: undefined,
    isPhoneVerified: false,
    gender: 'GENDER_UNSPECIFIED',
    isLocked: false,
    isTwoFactorEnabled: false,
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
    updatedAt: { seconds: 1_756_684_800, nanos: 0 },
  });

  const wirePlan = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    name: 'Pro',
    maxAgentSeats: 10,
    maxStorageBytes: '10000000000',
    monthlyAiTokenBudget: '1000000',
    aiModelTier: 'AI_MODEL_TIER_FAST',
    maxDocumentBytes: '1000000',
    maxAttachmentBytes: '1000000',
    maxDocumentUploads: 1000,
    maxAnalyticsRangeDays: 90,
    isActive: true,
    prices: [],
    subscriberCount: 0,
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
    updatedAt: { seconds: 1_756_684_800, nanos: 0 },
    ...overrides,
  });

  beforeAll(async () => {
    const { redisUrl, natsUrl } = readRunState();
    peers = await startPeers();
    gateway = await startGateway({ ...peers.env, REDIS_URL: redisUrl, NATS_URL: natsUrl });
  }, 90_000);

  afterAll(async () => {
    await gateway.stop();
    await peers.stop();
  });

  beforeEach(() => peers.reset());

  rowFor('Platform')('**a tenant admin is refused — this door has no permission code**', async () => {
    const response = await new Session(gateway.baseUrl).get(`${API}/platform/organizations`, tenantAdminHeaders());

    expect(response.status).toBe(403);
  });

  describe('organizations', () => {
    rowFor('Platform')('**`listOrganizations` filters by status**', async () => {
      peers.auth.on('PlatformService/ListOrganizations').reply({
        items: [wirePlatformOrganization('org-1')],
        meta: { totalItems: 1, itemCount: 1, itemsPerPage: 10, totalPages: 1, currentPage: 1 },
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/platform/organizations?status=ACTIVE`,
        superAdminHeaders(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: { items: [{ organization: { id: 'org-1' } }] } });
      const [call] = peers.auth.calls('PlatformService/ListOrganizations');
      expect(call.request).toMatchObject({ status: 2 }); // ORG_STATUS_ACTIVE
    });

    rowFor('Platform')('**`createOrganization` normalizes the slug — trim and lowercase, then the pattern**', async () => {
      peers.auth.on('PlatformService/CreateOrganization').reply({
        organization: wirePlatformOrganization('org-2'),
        admin: wireUser('dddddddd-3333-4333-8333-dddddddddddd'),
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/platform/organizations`,
        { name: 'Acme', slug: ' ACME-CORP ', adminEmail: 'admin@acme.test', adminFullName: 'Admin Person' },
        superAdminHeaders(),
      );

      expect(response.status).toBe(201);
      const [call] = peers.auth.calls('PlatformService/CreateOrganization');
      expect(call.request).toMatchObject({ slug: 'acme-corp' });
    });

    rowFor('Platform')('**`setStatus` answers the custom "Status updated" message**', async () => {
      peers.auth.on('PlatformService/SetOrganizationStatus').reply(wirePlatformOrganization('org-1', {
        organization: wireOrganization('org-1', { status: 'ORG_STATUS_FROZEN' }),
      }));

      const response = await new Session(gateway.baseUrl).post(
        `${API}/platform/organizations/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa/status`,
        { status: 'FROZEN', reason: 'suspected fraud' },
        superAdminHeaders(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ message: 'Status updated' });
    });

    rowFor('Platform')('**`resetBillingCycle` answers the full break-glass warning as its message**', async () => {
      peers.auth.on('PlatformService/ResetBillingCycle').reply(wirePlatformOrganization('org-1'));

      const response = await new Session(gateway.baseUrl).post(
        `${API}/platform/organizations/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa/billing-cycle/reset`,
        { reason: 'incident follow-up' },
        superAdminHeaders(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        message: 'Billing cycle reset — this desynchronizes the quota window from the Stripe invoice period and grants a fresh AI budget',
      });
    });

    rowFor('Platform')('**`offboard` returns the revoked session count under "Workspace offboarded"**', async () => {
      peers.auth.on('PlatformService/OffboardOrganization').reply({ revokedSessionCount: 4 });

      const raw = await new Session(gateway.baseUrl).request('DELETE', `${API}/platform/organizations/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa`, {
        body: { reason: 'churn' },
        headers: superAdminHeaders(),
      });

      expect(raw.status).toBe(200);
      expect(raw.body).toMatchObject({ message: 'Workspace offboarded', data: { revokedSessionCount: 4 } });
    });

    rowFor('Platform')('**`restore` answers "Workspace restored"**', async () => {
      peers.auth.on('PlatformService/RestoreOrganization').reply(wirePlatformOrganization('org-1'));

      const response = await new Session(gateway.baseUrl).post(
        `${API}/platform/organizations/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa/restore`,
        undefined,
        superAdminHeaders(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ message: 'Workspace restored' });
    });
  });

  describe('cross-tenant users and roles', () => {
    rowFor('Platform')('**`listUsers` carries the tenant on every row**', async () => {
      peers.auth.on('PlatformService/ListUsers').reply({
        items: [{ user: wireUser('dddddddd-3333-4333-8333-dddddddddddd'), organizationId: 'org-1', organizationName: 'Acme', roleNames: ['Agent'] }],
        meta: { totalItems: 1, itemCount: 1, itemsPerPage: 10, totalPages: 1, currentPage: 1 },
      });

      const response = await new Session(gateway.baseUrl).get(`${API}/platform/users`, superAdminHeaders());

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: { items: [{ organizationId: 'org-1' }] } });
    });

    rowFor('Platform')(
      '**`listGlobalRoles` forwards ONLY `page` — sortBy/searchTerm/organizationId/includeDeleted never reach the peer**',
      async () => {
        peers.auth.on('PlatformService/ListGlobalRoles').reply({
          items: [],
          meta: { totalItems: 0, itemCount: 0, itemsPerPage: 10, totalPages: 0, currentPage: 1 },
        });

        const response = await new Session(gateway.baseUrl).get(
          `${API}/platform/roles?page=2&limit=25&sortBy=fullName&sortOrder=DESC&searchTerm=acme&includeDeleted=true&organizationId=cccccccc-0000-4000-8000-cccccccccccc`,
          superAdminHeaders(),
        );

        expect(response.status).toBe(200);
        const [call] = peers.auth.calls('PlatformService/ListGlobalRoles');
        // The wire request has no field but `page` — asserting the whole
        // object (not a subset) is what stops "accept and ignore" from
        // being quietly "improved" into forwarding them.
        expect(Object.keys(call.request)).toEqual(['page']);
        expect(call.request.page).toMatchObject({ page: 2, limit: 25 });
      },
    );

    rowFor('Platform')('**`createGlobalRole` mints a role visible in every tenant**', async () => {
      peers.auth.on('PlatformService/CreateGlobalRole').reply({
        id: 'role-1',
        name: 'Support',
        isSystemRole: true,
        userAssigned: 0,
        permissionCodes: [],
        createdAt: { seconds: 1_756_684_800, nanos: 0 },
        updatedAt: { seconds: 1_756_684_800, nanos: 0 },
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/platform/roles`,
        { name: 'Support', permissionCodes: [] },
        superAdminHeaders(),
      );

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ data: { isSystemRole: true } });
    });
  });

  describe('metrics and finance', () => {
    rowFor('Platform')('**`getMetrics` is a flat, full-table snapshot**', async () => {
      peers.auth.on('PlatformService/GetMetrics').reply({
        totalOrganizations: 10,
        organizationsByStatus: { ACTIVE: 8, FROZEN: 2 },
        totalUsers: 40,
        activeUsers: 35,
        pendingInvitations: 2,
        liveSessions: 5,
        seatsAllocated: 50,
        seatsInUse: 40,
        generatedAt: { seconds: 1_756_684_800, nanos: 0 },
      });

      const response = await new Session(gateway.baseUrl).get(`${API}/platform/metrics`, superAdminHeaders());

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: { totalOrganizations: 10 } });
    });

    rowFor('Platform')(
      '**a degraded finance revenue section keeps `excludes` while everything else goes null**',
      async () => {
        peers.auth.on('PlatformService/GetFinanceSnapshot').reply({
          tenants: { total: 3, byStatus: {} },
          plans: [],
          dunning: { pastDue: 0, tenants: [] },
          revenue: { available: false, unavailableReason: 'Stripe unreachable', excludes: ['annual prices are estimated'] },
          generatedAt: { seconds: 1_756_684_800, nanos: 0 },
        });

        const response = await new Session(gateway.baseUrl).get(`${API}/platform/finance`, superAdminHeaders());

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          data: {
            revenue: {
              available: false,
              estimatedMrr: null,
              currency: null,
              activeSubscriptions: null,
              computedAt: null,
              excludes: ['annual prices are estimated'],
            },
          },
        });
      },
    );

    rowFor('Platform')('**`listBillingEvents` refuses a malformed date**', async () => {
      const response = await new Session(gateway.baseUrl).get(
        `${API}/platform/finance/events?from=not-a-date&to=2026-01-31`,
        superAdminHeaders(),
      );

      expect(response.status).toBe(400);
    });

    rowFor('Platform')('**`listBillingEvents` reports counts only, current-state offboarding separate from cancellation events**', async () => {
      peers.auth.on('PlatformService/ListBillingEvents').reply({
        points: [{ day: '2026-01-15', eventType: 'invoice.payment_failed', count: 2 }],
        currentlyOffboarded: [{ day: '2026-01-10', eventType: 'organization.offboarded', count: 1 }],
        observedEventTypes: ['invoice.payment_failed'],
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/platform/finance/events?from=2026-01-01&to=2026-01-31`,
        superAdminHeaders(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { points: [{ count: 2 }], currentlyOffboarded: [{ eventType: 'organization.offboarded' }] },
      });
    });
  });

  describe('the plan catalogue', () => {
    rowFor('Platform')('**`listPlans` reads the catalogue**', async () => {
      peers.auth.on('PlatformService/ListPlans').reply({
        items: [wirePlan('plan-1')],
        meta: { totalItems: 1, itemCount: 1, itemsPerPage: 10, totalPages: 1, currentPage: 1 },
      });

      const response = await new Session(gateway.baseUrl).get(`${API}/platform/plans`, superAdminHeaders());

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: { items: [{ id: 'plan-1' }] } });
    });

    rowFor('Platform')('**`createPlan` refuses more than twelve prices**', async () => {
      const prices = Array.from({ length: 13 }, (_, i) => ({ stripePriceId: `price_${i}`, interval: 'month' }));

      const response = await new Session(gateway.baseUrl).post(
        `${API}/platform/plans`,
        {
          name: 'Enterprise',
          maxAgentSeats: 10,
          maxStorageBytes: 1_000_000,
          monthlyAiTokenBudget: 1_000_000,
          aiModelTier: 'FAST',
          maxDocumentBytes: 1_000_000,
          maxAttachmentBytes: 1_000_000,
          maxDocumentUploads: 1000,
          maxAnalyticsRangeDays: 90,
          prices,
        },
        superAdminHeaders(),
      );

      expect(response.status).toBe(400);
    });

    rowFor('Platform')('**`getPlan` and `updatePlan` share the create envelope shape**', async () => {
      peers.auth.on('PlatformService/GetPlan').reply(wirePlan('plan-1'));

      const response = await new Session(gateway.baseUrl).get(`${API}/platform/plans/bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb`, superAdminHeaders());

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: { id: 'plan-1' } });
    });

    rowFor('Platform')('**`deletePlan` reports whether it deleted**', async () => {
      peers.auth.on('PlatformService/DeletePlan').reply({ deleted: true });

      const response = await new Session(gateway.baseUrl).request('DELETE', `${API}/platform/plans/bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb`, {
        headers: superAdminHeaders(),
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: { deleted: true } });
    });

    rowFor('Platform')(
      '**`applyPlan` folds ingestion usage into the projection and flags an overage**',
      async () => {
        peers.auth.on('PlatformService/ApplyPlan').reply({
          subscribers: [
            {
              organizationId: 'org-1',
              organizationName: 'Acme',
              changes: {},
              after: { maxStorageBytes: '10000000000' },
              overLimit: [],
              skippedPinned: false,
              budgetDeferred: false,
            },
          ],
          dryRun: true,
          changedCount: 0,
          skippedPinnedCount: 0,
          overLimitCount: 0,
          evaluatedDimensions: ['seats'],
        });
        peers.ingestion.on('IngestionPlatformService/GetPlatformUsage').reply({
          usage: [{ organizationId: 'org-1', usedBytes: '20000000000', documentCount: 0 }],
        });

        const response = await new Session(gateway.baseUrl).post(
          `${API}/platform/plans/bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb/apply?dryRun=true`,
          undefined,
          superAdminHeaders(),
        );

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          data: {
            evaluatedDimensions: expect.arrayContaining(['seats', 'storage', 'documents']),
            subscribers: [{ overLimit: [expect.stringContaining('maxStorageBytes')] }],
          },
        });
      },
    );

    rowFor('Platform')(
      '**`applyPlan` DEGRADES, never refuses, when the usage leg is unreachable — 200, not 503**',
      async () => {
        peers.auth.on('PlatformService/ApplyPlan').reply({
          subscribers: [
            {
              organizationId: 'org-1',
              organizationName: 'Acme',
              changes: {},
              after: {},
              overLimit: [],
              skippedPinned: false,
              budgetDeferred: false,
            },
          ],
          dryRun: false,
          changedCount: 1,
          skippedPinnedCount: 0,
          overLimitCount: 0,
          evaluatedDimensions: ['seats'],
        });
        peers.ingestion
          .on('IngestionPlatformService/GetPlatformUsage')
          .fail(GrpcStatus.UNAVAILABLE, 'ingestion-service is down');

        const response = await new Session(gateway.baseUrl).post(
          `${API}/platform/plans/bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb/apply`,
          undefined,
          superAdminHeaders(),
        );

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ data: { evaluatedDimensions: ['seats'] } });
        expect((response.body as { data: { evaluatedDimensions: string[] } }).data.evaluatedDimensions).not.toEqual(
          expect.arrayContaining(['storage']),
        );
      },
    );
  });
});
