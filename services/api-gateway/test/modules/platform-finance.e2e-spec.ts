import { of } from 'rxjs';
import {
  REVENUE_EXCLUSIONS,
  RevenueUnavailableReason,
} from '@synapsedesk/common';
import {
  API,
  E2eFixture,
  authenticatedAgent,
  bootstrapE2eTest,
} from '../utils';
import { timestamp } from '../fixtures/wire';

/**
 * The two `/platform/finance` routes, at the gateway boundary.
 *
 * What this layer can prove alone is its own: the guard, the query validation
 * and the mapper. Whether the numbers are right is auth-service's suite —
 * `finance.e2e-spec.ts` — and duplicating it here would assert the stub.
 */
describe('Platform finance (e2e)', () => {
  let fx: E2eFixture;

  const superAdmin = () =>
    authenticatedAgent(fx.app, { isSuperAdmin: true, organizationId: null });

  const snapshot = (revenue: Record<string, unknown>) => ({
    tenants: { total: 3, byStatus: { ACTIVE: 2, SUSPENDED_PAST_DUE: 1 } },
    plans: [
      { planId: 'plan-1', planName: 'Pro', subscribers: 2, seatsAllocated: 30 },
    ],
    dunning: {
      pastDue: 1,
      tenants: [
        { id: 'org-1', name: 'Acme', updatedAt: timestamp(new Date()) },
      ],
    },
    revenue,
    generatedAt: timestamp(new Date()),
  });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  });

  beforeEach(() => jest.clearAllMocks());

  afterAll(() => fx.close());

  it('1. both routes are SUPER ADMIN only', async () => {
    // Cross-tenant money. A tenant admin with every tenant-scoped permission
    // is still not a platform operator.
    const tenantAdmin = authenticatedAgent(fx.app, {
      permissionCodes: ['organization.read'],
    });

    await tenantAdmin.get(`${API}/platform/finance`).expect(403);
    await tenantAdmin
      .get(`${API}/platform/finance/events`)
      .query({ from: '2026-03-01', to: '2026-03-31' })
      .expect(403);
  });

  it('2. **a degraded revenue section becomes explicit nulls, not missing keys**', async () => {
    // The proto uses `optional` because a degraded section genuinely has no
    // number; REST says so with `null`, so a client destructuring the object
    // gets the same fields in both branches rather than `undefined` in one.
    fx.stubs.platform.getFinanceSnapshot.mockReturnValue(
      of(
        snapshot({
          available: false,
          unavailableReason: RevenueUnavailableReason.NOT_CONFIGURED,
          excludes: [...REVENUE_EXCLUSIONS],
        }),
      ) as never,
    );

    const response = await superAdmin()
      .get(`${API}/platform/finance`)
      .expect(200);

    expect(response.body.data.revenue).toEqual({
      available: false,
      unavailableReason: RevenueUnavailableReason.NOT_CONFIGURED,
      estimatedMrr: null,
      currency: null,
      activeSubscriptions: null,
      computedAt: null,
      // Present even with no number, or a client learns the caveat is optional.
      excludes: [...REVENUE_EXCLUSIONS],
    });
    // The three local sections are untouched by the degrade.
    expect(response.body.data.tenants.total).toBe(3);
    expect(response.body.data.dunning.pastDue).toBe(1);
  });

  it('3. an available revenue section carries the number and its age', async () => {
    // The control on test 2: without it, "maps to null" would also pass for a
    // mapper that nulls everything.
    const computedAt = new Date('2026-03-04T01:00:00.000Z');

    fx.stubs.platform.getFinanceSnapshot.mockReturnValue(
      of(
        snapshot({
          available: true,
          estimatedMrr: 12_500,
          currency: 'usd',
          activeSubscriptions: 2,
          computedAt: timestamp(computedAt),
          excludes: [...REVENUE_EXCLUSIONS],
        }),
      ) as never,
    );

    const response = await superAdmin()
      .get(`${API}/platform/finance`)
      .expect(200);

    expect([
      response.body.data.revenue.estimatedMrr,
      response.body.data.revenue.currency,
      response.body.data.revenue.computedAt,
    ]).toEqual([12_500, 'usd', computedAt.toISOString()]);
  });

  it('4. **the range is required and must be a DATE**', async () => {
    // `billing_events` never shrinks, so an optional `from` would walk the
    // whole history on a page load. A timestamp is refused rather than
    // truncated: the series is bucketed by UTC day, and accepting one would
    // suggest a sub-day window that does not exist.
    await superAdmin().get(`${API}/platform/finance/events`).expect(400);

    await superAdmin()
      .get(`${API}/platform/finance/events`)
      .query({ from: '2026-03-01' })
      .expect(400);

    await superAdmin()
      .get(`${API}/platform/finance/events`)
      .query({ from: '2026-03-01T00:00:00Z', to: '2026-03-31' })
      .expect(400);

    expect(fx.stubs.platform.listBillingEvents).not.toHaveBeenCalled();
  });

  it('5. the series passes through, observed types included', async () => {
    fx.stubs.platform.listBillingEvents.mockReturnValue(
      of({
        points: [
          { day: '2026-03-04', eventType: 'invoice.payment_failed', count: 4 },
        ],
        currentlyOffboarded: [
          { day: '2026-03-05', eventType: 'organization.offboarded', count: 1 },
        ],
        observedEventTypes: ['invoice.payment_failed'],
      }),
    );

    const response = await superAdmin()
      .get(`${API}/platform/finance/events`)
      .query({ from: '2026-03-01', to: '2026-03-31' })
      .expect(200);

    expect(response.body.data.points).toEqual([
      { day: '2026-03-04', eventType: 'invoice.payment_failed', count: 4 },
    ]);
    expect(response.body.data.observedEventTypes).toEqual([
      'invoice.payment_failed',
    ]);
    // The rename reaches the wire. `offboardings` read as a count of events and
    // the series is a projection of current state — a restore removes a tenant
    // from every past range — so the name is the disclosure and a client that
    // still sees the old one is reading history that is not there.
    expect(response.body.data.currentlyOffboarded).toEqual([
      { day: '2026-03-05', eventType: 'organization.offboarded', count: 1 },
    ]);
    expect(response.body.data.offboardings).toBeUndefined();
    expect(fx.stubs.platform.listBillingEvents).toHaveBeenCalledWith(
      { from: '2026-03-01', to: '2026-03-31' },
      expect.anything(),
    );
  });
});
