import { status as GrpcStatus } from '@grpc/grpc-js';
import { of, throwError } from 'rxjs';
import { AiModelTier, OrgStatus } from '@synapsedesk/grpc-proto';
import { UsageUnavailableReason } from '@synapsedesk/contracts';
import {
  API,
  E2eFixture,
  authenticatedAgent,
  bootstrapE2eTest,
} from '../utils';
import { grpcError, timestamp } from '../fixtures/wire';

/**
 * `GET /platform/organizations/{id}`: the organization with its meters, each
 * from the service that counts it — seats and the AI allowance from auth,
 * storage's bytes from ingestion against the organization's own limit.
 */
describe('Platform organizations (e2e)', () => {
  let fx: E2eFixture;

  const superAdmin = () =>
    authenticatedAgent(fx.app, { isSuperAdmin: true, organizationId: null });

  const organizationId = '11111111-2222-4333-8444-555555555555';
  const GIB = 1024 ** 3;

  const wireOrganization = () => ({
    organization: {
      id: organizationId,
      name: 'Northwind Health',
      slug: 'northwind',
      status: OrgStatus.ORG_STATUS_ACTIVE,
      enforceTwoFactor: false,
      allowedEmailDomains: [],
      maxAgentSeats: 25,
      maxStorageBytes: 50 * GIB,
      monthlyAiTokenBudget: 10_000_000,
      aiModelTier: AiModelTier.AI_MODEL_TIER_QUALITY,
      billingCycleStart: timestamp(),
      maxDocumentBytes: 25 * 1024 * 1024,
      maxAttachmentBytes: 5 * 1024 * 1024,
      maxDocumentUploads: 10_000,
      maxAnalyticsRangeDays: 180,
      createdAt: timestamp(),
      updatedAt: timestamp(),
    },
    userCount: 18,
    pendingInvitationCount: 2,
    departmentCount: 4,
  });

  const wireUsage = () => ({
    seats: { available: true, used: 20, limit: 25 },
    storage: {
      available: false,
      unavailableReason: UsageUnavailableReason.READ_FAILED,
    },
    aiTokens: { available: true, used: 4_590_000, limit: 10_000_000 },
    billingCycleStart: timestamp(),
    cycleResetsAt: timestamp(),
    aiModelTier: AiModelTier.AI_MODEL_TIER_QUALITY,
    planName: 'Pro',
  });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    fx.stubs.platform.getOrganization.mockReturnValue(of(wireOrganization()));
    fx.stubs.platform.getOrganizationUsage.mockReturnValue(of(wireUsage()));
    fx.stubs.ingestionPlatform.getPlatformUsage.mockReturnValue(
      of({
        usage: [{ organizationId, usedBytes: 12 * GIB, documentCount: 340 }],
      }),
    );
  });

  afterAll(() => fx.close());

  it('composes seats and the allowance from auth, storage from ingestion', async () => {
    const response = await superAdmin()
      .get(`${API}/platform/organizations/${organizationId}`)
      .expect(200);

    expect(response.body.data.userCount).toBe(18);
    expect(response.body.data.usage).toEqual({
      seats: { available: true, used: 20, limit: 25, unavailableReason: null },
      storage: {
        available: true,
        used: 12 * GIB,
        limit: 50 * GIB,
        unavailableReason: null,
      },
      aiTokens: {
        available: true,
        used: 4_590_000,
        limit: 10_000_000,
        unavailableReason: null,
      },
    });
    expect(fx.stubs.platform.getOrganizationUsage.mock.calls[0][0]).toEqual({
      organizationId,
    });
    expect(
      fx.stubs.ingestionPlatform.getPlatformUsage.mock.calls[0][0],
    ).toEqual({ organizationIds: [organizationId] });
  });

  it('a leg that fails is READ_FAILED on its meters, and the page still loads', async () => {
    fx.stubs.platform.getOrganizationUsage.mockReturnValue(
      throwError(() => grpcError(GrpcStatus.UNAVAILABLE, 'down')),
    );
    fx.stubs.ingestionPlatform.getPlatformUsage.mockReturnValue(
      throwError(() => grpcError(GrpcStatus.UNAVAILABLE, 'down')),
    );

    const response = await superAdmin()
      .get(`${API}/platform/organizations/${organizationId}`)
      .expect(200);

    const failed = {
      available: false,
      used: null,
      limit: null,
      unavailableReason: 'READ_FAILED',
    };
    expect(response.body.data.usage).toEqual({
      seats: failed,
      storage: failed,
      aiTokens: failed,
    });
    expect(response.body.data.organization.name).toBe('Northwind Health');
  });

  it('an unknown organization is still a 404', async () => {
    fx.stubs.platform.getOrganization.mockReturnValue(
      throwError(() =>
        grpcError(GrpcStatus.NOT_FOUND, 'No workspace with that id'),
      ),
    );

    await superAdmin()
      .get(`${API}/platform/organizations/${organizationId}`)
      .expect(404);
  });
});
