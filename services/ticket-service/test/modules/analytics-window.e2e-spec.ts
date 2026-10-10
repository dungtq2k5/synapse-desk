import { status } from '@grpc/grpc-js';
import { expectRpc } from '@synapsedesk/common/testing/rpc';
import { MAX_ANALYTICS_RANGE_DAYS } from '@synapsedesk/common';
import { E2eFixture, bootstrapE2eTest, memberContext } from '../utils';
import { buildTenant, type TenantFixture } from '../factories';
import { AnalyticsService } from '../../src/modules/analytics/analytics.service';
import { AuthReferenceService } from '../../src/modules/auth-client/auth-reference.service';

/**
 * The one limit whose narrowing is RETROACTIVE, pinned as the behaviour it is.
 *
 * Every other entitlement gates admission: lowering it refuses the next thing
 * and touches nothing that exists. A lookback window has no creation event —
 * narrowing it takes away history the tenant could read yesterday, and no
 * placement of the check avoids that.
 *
 * **That is accepted deliberately rather than grandfathered.** A per-subscriber
 * window would make a plan's stated grant not be what its subscribers have,
 * which is the property the whole catalogue rests on. This file exists so the
 * choice is a pinned decision rather than an emergent one.
 */
describe('The analytics window (e2e)', () => {
  let fx: E2eFixture;
  let analytics: AnalyticsService;
  let getAnalyticsRangeDays: jest.SpyInstance;
  let tenant: TenantFixture;

  const context = () =>
    memberContext(
      { id: tenant.agentId, organizationId: tenant.organizationId },
      ['analytics.read'],
    );

  /** A range of `days`, ending today. */
  const range = (days: number) => {
    const to = new Date();
    const from = new Date(to.getTime() - (days - 1) * 86_400_000);
    const day = (value: Date) => value.toISOString().slice(0, 10);

    return { from: day(from), to: day(to) };
  };

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    analytics = fx.moduleRef.get(AnalyticsService);
    getAnalyticsRangeDays = jest.spyOn(
      fx.moduleRef.get(AuthReferenceService),
      'getAnalyticsRangeDays',
    );
  });

  beforeEach(async () => {
    await fx.reset();
    tenant = buildTenant();
    getAnalyticsRangeDays.mockResolvedValue(MAX_ANALYTICS_RANGE_DAYS);
  });

  afterAll(() => fx.close());

  it('6. **Lowering the window changes what an EXISTING subscriber sees**', async () => {
    // The retroactive effect, stated as the thing that happens rather than the
    // thing that is prevented. Same tenant, same data, same request — and the
    // answer changes because their plan changed.
    const ninetyDays = range(90);

    await expect(
      analytics.getOverview({ ...ninetyDays }, context()),
    ).resolves.toBeDefined();

    // The plan narrows. Nothing about the tenant's data has changed.
    getAnalyticsRangeDays.mockResolvedValue(30);

    await expectRpc(
      analytics.getOverview({ ...ninetyDays }, context()),
      status.INVALID_ARGUMENT,
    );
  });

  it("6b. **The refusal names the TENANT's number, not the platform's**", async () => {
    // An admin told "the maximum is 400" while their plan grants 30 goes
    // looking for a bug. The number in the message has to be the one that
    // actually applied.
    getAnalyticsRangeDays.mockResolvedValue(30);

    await analytics.getOverview({ ...range(90) }, context()).then(
      () => {
        throw new Error('expected a refusal');
      },
      (error: { message?: string; details?: string }) => {
        expect(`${error.message ?? ''}${error.details ?? ''}`).toContain('30');
      },
    );
  });

  it('6c. A range INSIDE the narrowed window still answers', async () => {
    // The complement: a window that refused everything would pass test 6 and be
    // a worse bug.
    getAnalyticsRangeDays.mockResolvedValue(30);

    await expect(
      analytics.getOverview({ ...range(10) }, context()),
    ).resolves.toBeDefined();
  });

  it('6d. An UNREADABLE window refuses rather than falling back to the platform', async () => {
    // Fail-closed, like every other limit: resolving to the ceiling would hand
    // a tenant who narrowed their window the wide one exactly when the check
    // could not run.
    getAnalyticsRangeDays.mockRejectedValue(new Error('auth-service is down'));

    await expect(
      analytics.getOverview({ ...range(10) }, context()),
    ).rejects.toBeDefined();
  });
});
