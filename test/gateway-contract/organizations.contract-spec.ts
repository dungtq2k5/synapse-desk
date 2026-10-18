/**
 * @file `OrganizationsApi` — the caller's OWN tenant. `get` is the sharpest
 * row here: it carries NO permission requirement (the End User role holds
 * zero permission rows, so gating it 403s the app shell for every ordinary
 * member), and it is cached — a caller with zero permission codes must still
 * get served.
 */

import { sign } from 'jsonwebtoken';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { OrgStatus } from '@synapsedesk/contracts';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('organizations', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = 'cccccccc-1111-4111-8111-cccccccccccc';
  const USER = 'cccccccc-2222-4222-8222-cccccccccccc';

  const headers = (permissionCodes: string[] = []) => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
      {
        sub: USER,
        organizationId: ORGANIZATION,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes,
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    )}`,
  });

  const wireOrganization = (overrides: Record<string, unknown> = {}) => ({
    id: ORGANIZATION,
    name: 'Acme',
    slug: 'acme',
    status: toProtoOrgStatus(OrgStatus.ACTIVE),
    enforceTwoFactor: false,
    allowedEmailDomains: [],
    maxAgentSeats: 10,
    maxStorageBytes: '1000000000',
    monthlyAiTokenBudget: '5000000',
    aiModelTier: 'AI_MODEL_TIER_FAST',
    billingCycleStart: { seconds: 1_756_684_800, nanos: 0 },
    maxDocumentBytes: '104857600',
    maxAttachmentBytes: '10485760',
    maxDocumentUploads: 100,
    maxAnalyticsRangeDays: 90,
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
    updatedAt: { seconds: 1_756_684_800, nanos: 0 },
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

  rowFor('Organizations')(
    '**`get` needs no permission at all — a caller with zero codes is still served**',
    async () => {
      peers.auth
        .on('OrganizationService/GetCurrentOrganization')
        .reply(wireOrganization());

      const response = await new Session(gateway.baseUrl).get(
        `${API}/organizations/current`,
        headers([]),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { id: ORGANIZATION, name: 'Acme' },
      });
    },
  );

  rowFor('Organizations')(
    '**a second `get` call never reaches the peer within the TTL**',
    async () => {
      // A tenant of its own: `get` has no query params to vary the cache key
      // by, so any other row using `ORGANIZATION` would warm this exact entry
      // first and this row would read a hit it never caused.
      const TENANT = 'cccccccc-3333-4333-8333-cccccccccccc';
      const withCookie = sign(
        {
          sub: USER,
          organizationId: TENANT,
          isSuperAdmin: false,
          departmentIds: [],
          permissionCodes: [],
          isEmailVerified: true,
        },
        TEST_KEYS.access(),
        { algorithm: 'RS256', expiresIn: '15m' },
      );

      peers.auth
        .on('OrganizationService/GetCurrentOrganization')
        .reply(wireOrganization({ id: TENANT }));

      const session = new Session(gateway.baseUrl);
      const cookie = { cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${withCookie}` };
      const first = await session.get(`${API}/organizations/current`, cookie);
      const second = await session.get(`${API}/organizations/current`, cookie);

      expect(first.status).toBe(200);
      expect(second.body).toEqual(first.body);
      expect(
        peers.auth.calls('OrganizationService/GetCurrentOrganization'),
      ).toHaveLength(1);
    },
  );

  rowFor('Organizations')(
    '**`issueInboundToken` builds the address from the domain and token**',
    async () => {
      peers.auth
        .on('OrganizationService/IssueInboundToken')
        .reply({ inboundToken: 'tok_abc123' });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/organizations/current/inbound-token`,
        undefined,
        headers(['organization.update']),
      );

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        data: { inboundAddress: 'support+tok_abc123@inbound.test' },
      });
    },
  );

  rowFor('Organizations')(
    '**`revokeInboundToken` answers 204 with no body**',
    async () => {
      peers.auth.on('OrganizationService/RevokeInboundToken').reply({});

      const response = await new Session(gateway.baseUrl).request(
        'DELETE',
        `${API}/organizations/current/inbound-token`,
        { headers: headers(['organization.update']) },
      );

      expect(response.status).toBe(204);
    },
  );

  rowFor('Organizations')(
    '**`update` sends only the fields present in the body**',
    async () => {
      peers.auth
        .on('OrganizationService/UpdateOrganization')
        .reply(wireOrganization({ name: 'Acme Corp' }));

      const response = await new Session(gateway.baseUrl).request(
        'PATCH',
        `${API}/organizations/current`,
        {
          body: { name: 'Acme Corp' },
          headers: headers(['organization.update']),
        },
      );

      expect(response.status).toBe(200);
      const [call] = peers.auth.calls('OrganizationService/UpdateOrganization');
      expect(call.request).toMatchObject({ name: 'Acme Corp' });
      expect(call.request).not.toHaveProperty('slug');
      expect(call.request).not.toHaveProperty('domain');
    },
  );

  rowFor('Organizations')(
    '**`getSettings` returns the governance fields**',
    async () => {
      peers.auth.on('OrganizationService/GetOrganizationSettings').reply({
        enforceTwoFactor: true,
        allowedEmailDomains: ['acme.com'],
        publicDomainWarnings: [],
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/organizations/current/settings`,
        headers(['organization.read']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        message: 'OK',
        data: {
          enforceTwoFactor: true,
          allowedEmailDomains: ['acme.com'],
          inboundAddress: null,
        },
      });
    },
  );

  rowFor('Organizations')(
    '**`getSettings` answers the inbound address built from the token, never the token**',
    async () => {
      const token = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
      peers.auth.on('OrganizationService/GetOrganizationSettings').reply({
        enforceTwoFactor: false,
        allowedEmailDomains: [],
        publicDomainWarnings: [],
        inboundToken: token,
      });

      const response = await new Session(gateway.baseUrl).get<{
        data: Record<string, unknown>;
      }>(
        `${API}/organizations/current/settings`,
        headers(['organization.read']),
      );

      expect(response.status).toBe(200);
      expect(response.body.data.inboundAddress).toBe(
        `support+${token}@inbound.test`,
      );
      expect(response.body.data).not.toHaveProperty('inboundToken');
    },
  );

  rowFor('Organizations')(
    '**`updateSettings`: an absent override field leaves it unchanged on the wire**',
    async () => {
      peers.auth.on('OrganizationService/UpdateOrganizationSettings').reply({
        enforceTwoFactor: false,
        allowedEmailDomains: [],
        publicDomainWarnings: [],
      });

      const response = await new Session(gateway.baseUrl).request(
        'PATCH',
        `${API}/organizations/current/settings`,
        {
          body: { enforceTwoFactor: true },
          headers: headers(['organization.update']),
        },
      );

      expect(response.status).toBe(200);
      const [call] = peers.auth.calls(
        'OrganizationService/UpdateOrganizationSettings',
      );
      expect(call.request).not.toHaveProperty('maxDocumentBytesOverride');
      expect(call.request).toMatchObject({
        clearMaxDocumentBytesOverride: false,
        replaceAllowedEmailDomains: false,
      });
    },
  );

  rowFor('Organizations')(
    '**`updateSettings`: an explicit `null` override clears it, distinctly from absence**',
    async () => {
      peers.auth.on('OrganizationService/UpdateOrganizationSettings').reply({
        enforceTwoFactor: false,
        allowedEmailDomains: [],
        publicDomainWarnings: [],
      });

      const response = await new Session(gateway.baseUrl).request(
        'PATCH',
        `${API}/organizations/current/settings`,
        {
          body: { maxDocumentBytesOverride: null },
          headers: headers(['organization.update']),
        },
      );

      expect(response.status).toBe(200);
      const [call] = peers.auth.calls(
        'OrganizationService/UpdateOrganizationSettings',
      );
      expect(call.request).toMatchObject({
        clearMaxDocumentBytesOverride: true,
      });
      expect(call.request).not.toHaveProperty('maxDocumentBytesOverride');
    },
  );

  rowFor('Organizations')(
    '**`updateSettings`: an empty `allowedEmailDomains` array still replaces — the exact bug this reads the raw body to avoid**',
    async () => {
      peers.auth.on('OrganizationService/UpdateOrganizationSettings').reply({
        enforceTwoFactor: true,
        allowedEmailDomains: [],
        publicDomainWarnings: [],
      });

      // Deliberately touches ONLY `enforceTwoFactor`, alongside an empty
      // `allowedEmailDomains` — proof that Java does not confuse "sent
      // empty" with "not sent", which would otherwise wipe the tenant's
      // self-signup allowlist on an update that never meant to touch it.
      const response = await new Session(gateway.baseUrl).request(
        'PATCH',
        `${API}/organizations/current/settings`,
        {
          body: { enforceTwoFactor: true, allowedEmailDomains: [] },
          headers: headers(['organization.update']),
        },
      );

      expect(response.status).toBe(200);
      const [call] = peers.auth.calls(
        'OrganizationService/UpdateOrganizationSettings',
      );
      expect(call.request).toMatchObject({
        replaceAllowedEmailDomains: true,
        allowedEmailDomains: [],
      });
    },
  );

  rowFor('Organizations')(
    '**`updateSettings` surfaces `publicDomainWarnings` as a response warning**',
    async () => {
      peers.auth.on('OrganizationService/UpdateOrganizationSettings').reply({
        enforceTwoFactor: false,
        allowedEmailDomains: ['gmail.com'],
        publicDomainWarnings: ['gmail.com'],
      });

      const response = await new Session(gateway.baseUrl).request(
        'PATCH',
        `${API}/organizations/current/settings`,
        {
          body: { allowedEmailDomains: ['gmail.com'] },
          headers: headers(['organization.update']),
        },
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        message: 'Settings updated',
        warning:
          'Anyone with an address at gmail.com can now join this workspace automatically.',
      });
    },
  );

  rowFor('Organizations')(
    '**`getUsage` composes the storage meter from ingestion, seats and tokens from auth**',
    async () => {
      peers.auth.on('OrganizationService/GetOrganizationUsage').reply({
        seats: { available: true, used: 3, limit: 10 },
        aiTokens: { available: false, unavailableReason: 'NOT_AVAILABLE' },
        billingCycleStart: { seconds: 1_756_684_800, nanos: 0 },
        aiModelTier: 'AI_MODEL_TIER_FAST',
        planName: 'Pro',
      });
      peers.ingestion.on('DocumentService/GetStorageUsage').reply({
        usedBytes: '500',
        limitBytes: '1000000000',
        documentCount: 4,
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/organizations/current/usage`,
        headers(['organization.read']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: {
          seats: { available: true, used: 3, limit: 10 },
          storage: { available: true, used: 500, limit: 1_000_000_000 },
          aiTokens: { available: false, unavailableReason: 'NOT_AVAILABLE' },
          planName: 'Pro',
        },
      });
    },
  );

  rowFor('Organizations')(
    '**`getUsage` degrades the storage meter, never the whole page, when ingestion fails**',
    async () => {
      peers.auth.on('OrganizationService/GetOrganizationUsage').reply({
        seats: { available: true, used: 3, limit: 10 },
        aiTokens: { available: false },
        billingCycleStart: { seconds: 1_756_684_800, nanos: 0 },
        aiModelTier: 'AI_MODEL_TIER_FAST',
        planName: 'Pro',
      });
      peers.ingestion
        .on('DocumentService/GetStorageUsage')
        .fail(GrpcStatus.UNAVAILABLE, 'ingestion unavailable');

      const response = await new Session(gateway.baseUrl).get<{
        data: { storage: { unavailableReason?: string } };
      }>(`${API}/organizations/current/usage`, headers(['organization.read']));

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { storage: { available: false, used: null, limit: null } },
      });
      expect(response.body.data.storage.unavailableReason).toBe('READ_FAILED');
    },
  );

  rowFor('Organizations')(
    '**`getOnboarding` passes the checklist through**',
    async () => {
      peers.auth.on('OrganizationService/GetOnboarding').reply({
        steps: [
          { key: 'departments', label: 'Create a department', complete: true },
        ],
        canComplete: true,
        status: toProtoOrgStatus(OrgStatus.PENDING_ONBOARDING),
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/organizations/current/onboarding`,
        headers(['organization.read']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: {
          steps: [
            {
              key: 'departments',
              label: 'Create a department',
              complete: true,
            },
          ],
          canComplete: true,
          status: 'PENDING_ONBOARDING',
        },
      });
    },
  );

  rowFor('Organizations')(
    '**`completeOnboarding` answers with the fixed message**',
    async () => {
      peers.auth
        .on('OrganizationService/CompleteOnboarding')
        .reply(
          wireOrganization({ status: toProtoOrgStatus(OrgStatus.ACTIVE) }),
        );

      const response = await new Session(gateway.baseUrl).post(
        `${API}/organizations/current/onboarding/complete`,
        undefined,
        headers(['organization.update']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ message: 'Onboarding complete' });
    },
  );

  rowFor('Organizations')(
    '**`requestOffboard` forwards the reason and carries the fixed warning**',
    async () => {
      peers.auth
        .on('OrganizationService/DeleteOrganization')
        .reply({ revokedSessionCount: 5 });

      const response = await new Session(gateway.baseUrl).request(
        'DELETE',
        `${API}/organizations/current`,
        {
          body: { reason: 'Customer requested closure' },
          headers: headers(['organization.delete']),
        },
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        message: 'Offboarding requested',
        warning:
          'This workspace is frozen pending review. Contact support to cancel.',
        data: { revokedSessionCount: 5 },
      });
      const [call] = peers.auth.calls('OrganizationService/DeleteOrganization');
      expect(call.request).toMatchObject({
        reason: 'Customer requested closure',
      });
    },
  );

  rowFor('Organizations')(
    '**`update` with a taken slug answers 409 naming the address**',
    async () => {
      const sentence = 'That address is already taken by another organization.';
      peers.auth
        .on('OrganizationService/UpdateOrganization')
        .fail(GrpcStatus.ALREADY_EXISTS, sentence);

      const response = await new Session(gateway.baseUrl).request(
        'PATCH',
        `${API}/organizations/current`,
        { body: { slug: 'taken' }, headers: headers(['organization.update']) },
      );

      expect(response.status).toBe(409);
      expect((response.body as { error: string }).error).toBe(
        `${sentence.slice(0, -1)}!`,
      );
    },
  );
});
