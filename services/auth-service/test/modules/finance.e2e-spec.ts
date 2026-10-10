import type Stripe from 'stripe';
import { faultInjector } from '@synapsedesk/common/testing/fault';
import { expectRpc } from '@synapsedesk/common/testing/rpc';
import { status } from '@grpc/grpc-js';
import {
  BillingEventSource,
  BillingEventStatus,
  OrgStatus,
  REVENUE_EXCLUSIONS,
  RevenueUnavailableReason,
  SCHEDULED_JOBS,
  compareAlphabetically,
} from '@synapsedesk/common';
import { E2eFixture, bootstrapE2eTest, superAdminContext } from '../utils';
import { createOrganization, seedPlans } from '../factories';
import {
  FinanceService,
  STRIPE_EVENTS,
} from '../../src/modules/finance/finance.service';
import { BillingSnapshotJob } from '../../src/modules/finance/billing-snapshot.job';
import {
  BillingSnapshotStore,
  FINANCE_REDIS,
} from '../../src/modules/finance/billing-snapshot.store';
import type Redis from 'ioredis';
import { StripeService } from '../../src/modules/billing/stripe.service';
import { PlanAdminService } from '../../src/modules/billing/plan-admin.service';
import { SchedulerProcessor } from '../../src/modules/scheduler/scheduler.processor';
import { PlatformService } from '../../src/modules/platform/platform.service';

/**
 * Platform finance.
 *
 * Two properties dominate this file and neither is about arithmetic:
 * `billing_events` has **two producers**, and "subscribers" is **three
 * different questions** wearing one name.
 */
describe('Finance (e2e)', () => {
  const faults = faultInjector();

  let fx: E2eFixture;
  let finance: FinanceService;
  let snapshotJob: BillingSnapshotJob;
  let store: BillingSnapshotStore;
  let stripe: StripeService;
  let planAdmin: PlanAdminService;
  let processor: SchedulerProcessor;
  let platform: PlatformService;

  /** A day well inside every range this file asks for. */
  const DAY = '2026-03-04';
  const at = (hour: number) => new Date(`${DAY}T0${hour}:00:00.000Z`);
  const RANGE = { from: '2026-03-01', to: '2026-03-31' };

  /** Writes a `billing_events` row directly — see test 1 for why. */
  const event = (overrides: {
    stripeEventId: string;
    eventType: string;
    source?: BillingEventSource;
    stripeCreatedAt?: Date;
    organizationId?: string;
  }) =>
    fx.prisma.billingEvent.create({
      data: {
        stripeEventId: overrides.stripeEventId,
        eventType: overrides.eventType,
        source: overrides.source ?? BillingEventSource.STRIPE,
        stripeCreatedAt: overrides.stripeCreatedAt ?? at(1),
        organizationId: overrides.organizationId ?? null,
        payload: {},
        status: BillingEventStatus.PROCESSED,
      },
    });

  /**
   * A `subscriptions.list` result the `for await` in the job can walk.
   *
   * An async iterable, not an array — the job pages with `for await`, and a
   * plain array would let a synchronous implementation pass a test written for
   * a paginating one.
   */
  const listing = (items: unknown[]) =>
    ({
      [Symbol.asyncIterator]: async function* () {
        // The `async` is what makes this the async iterable the job consumes;
        // there is nothing real to await, so this yields to the loop once and
        // satisfies the rule honestly rather than silencing it.
        await Promise.resolve();
        for (const item of items) yield item;
      },
    }) as never;

  /** One active subscription with a single monthly item. */
  const subscription = (unitAmount: number, currency: string) =>
    ({
      items: {
        data: [
          {
            quantity: 1,
            price: {
              unit_amount: unitAmount,
              currency,
              recurring: { interval: 'month', interval_count: 1 },
            },
          },
        ],
      },
    }) as unknown as Stripe.Subscription;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    finance = fx.moduleRef.get(FinanceService);
    snapshotJob = fx.moduleRef.get(BillingSnapshotJob);
    store = fx.moduleRef.get(BillingSnapshotStore);
    stripe = fx.moduleRef.get(StripeService);
    planAdmin = fx.moduleRef.get(PlanAdminService);
    processor = fx.moduleRef.get(SchedulerProcessor);
    platform = fx.moduleRef.get(PlatformService);
  });

  beforeEach(async () => {
    await fx.reset();
    await seedPlans(fx.prisma);
    // The snapshot lives in Redis, which `reset()` does not touch — so without
    // this, test 4's "no snapshot" assertion would pass or fail depending on
    // which test ran before it.
    await store.clear();
  });

  afterAll(() => fx.close());

  // --------------------------------------------------------------- Producers

  describe('the two producers of billing_events', () => {
    it('1. **a count taken WHILE a plan change holds its claim excludes it**', async () => {
      // **The claim is created and released inside this test, deliberately.**
      // A `LOCAL` row is a lock: `PlanChangeService` releases it in a
      // `finally`, so steady state has none and a fixture that seeded one
      // before the suite ran would be asserting over a row production never
      // leaves behind. The unfiltered query is correct almost always and wrong
      // only in this window — which is the whole reason the bug is worth a
      // test: a constant inflation gets noticed, an intermittent one is right
      // whenever anybody checks it and wrong on the day it is quoted.
      const organization = await createOrganization(fx.prisma);

      await event({ stripeEventId: 'evt_1', eventType: 'invoice.paid' });

      const claim = await event({
        stripeEventId: `plan-change:${organization.id}:key`,
        eventType: 'plan.change_requested',
        source: BillingEventSource.LOCAL,
        organizationId: organization.id,
      });

      try {
        const result = await finance.listEvents(RANGE);

        expect(result.points).toEqual([
          { day: DAY, eventType: 'invoice.paid', count: 1 },
        ]);
        expect(result.observedEventTypes).toEqual(['invoice.paid']);
      } finally {
        // Exactly what `PlanChangeService.release` does, so the arrangement
        // matches the lifetime rather than only the shape.
        await fx.prisma.billingEvent.delete({ where: { id: claim.id } });
      }
    });
  });

  // ------------------------------------------------------------- Definitions

  describe('subscribers is three questions', () => {
    it('2. **an offboarded tenant leaves the plan mix, and the plan still cannot be retired**', async () => {
      // **A pair on purpose.** Either half alone permits the wrong fix: assert
      // only the mix and somebody adds `deletedAt: null` to `PLAN_INCLUDE`,
      // which lets a plan be retired out from under a restorable tenant;
      // assert only the refusal and the mix keeps counting offboarded tenants
      // beside a `tenants.total` that does not.
      //
      // **Two plans, because one cannot isolate the second half.** With a live
      // subscriber and an offboarded one on the SAME plan, filtering the shared
      // count still leaves 1 and the refusal still fires — measured: that
      // sabotage passed. Only a plan whose sole subscriber is offboarded shows
      // what the filter would cost.
      const starter = await fx.prisma.subscriptionPlan.findFirstOrThrow({
        where: { name: 'Starter' },
      });
      const pro = await fx.prisma.subscriptionPlan.findFirstOrThrow({
        where: { name: 'Pro' },
      });
      const superAdmin = await fx.prisma.user.findFirstOrThrow({
        where: { isSuperAdmin: true },
      });
      const ctx = superAdminContext(superAdmin.id);

      // **7 seats on a 5-seat plan** — a pinned or hand-overridden tenant, and
      // the only arrangement that tells the two definitions apart: at 5 the sum
      // and `plan.maxAgentSeats x subscribers` agree, so the assertion below
      // would pass for either.
      await createOrganization(fx.prisma, {
        plan: { connect: { id: starter.id } },
        maxAgentSeats: 7,
        entitlementsPinned: true,
      });
      await createOrganization(fx.prisma, {
        plan: { connect: { id: starter.id } },
        maxAgentSeats: 9,
        deletedAt: new Date(),
      });
      // Pro's ONLY subscriber is offboarded — and restorable.
      await createOrganization(fx.prisma, {
        plan: { connect: { id: pro.id } },
        maxAgentSeats: 25,
        deletedAt: new Date(),
      });

      const snapshot = await finance.getSnapshot();
      const mix = new Map(snapshot.plans.map((row) => [row.planId, row]));

      // One subscriber and the seats THAT TENANT HOLDS — not two, not 16, and
      // not the plan's 5.
      expect([
        mix.get(starter.id)?.subscribers,
        mix.get(starter.id)?.seatsAllocated,
      ]).toEqual([1, 7]);
      // Pro is ABSENT rather than reported with a zero: nobody is on it.
      expect(mix.has(pro.id)).toBe(false);
      // The same response's tenant total agrees, which is the disagreement a
      // reader would actually notice.
      expect(snapshot.tenants?.total).toBe(1);

      // And the other question keeps its own answer. Both plans are still
      // pointed at by a restorable tenant, so retiring either would dangle a
      // `plan_id` — including the one finance reports as having no subscribers.
      await expectRpc(
        planAdmin.deletePlan(pro.id, ctx),
        status.FAILED_PRECONDITION,
      );
      await expectRpc(
        planAdmin.deletePlan(starter.id, ctx),
        status.FAILED_PRECONDITION,
      );
    });
  });

  // ------------------------------------------------------------- The series

  describe('the event series', () => {
    it('3. **four failed payments for one invoice are four events and no amount**', async () => {
      // Stripe retries an invoice up to four times and each attempt is its own
      // event. Summing `amount_due` would count one unpaid invoice four times
      // — and a retry that later succeeds leaves its failure row in place, so
      // the sum also counts money that WAS collected. A count is a fact about
      // events we received; an amount is a claim about money Stripe will
      // contradict.
      for (const attempt of [1, 2, 3, 4]) {
        await event({
          stripeEventId: `evt_failed_${attempt}`,
          eventType: 'invoice.payment_failed',
          stripeCreatedAt: at(attempt),
        });
      }

      const result = await finance.listEvents(RANGE);

      expect(result.points).toEqual([
        { day: DAY, eventType: 'invoice.payment_failed', count: 4 },
      ]);

      // **No amount, asserted structurally.** Checking that a particular field
      // is absent would guard one spelling; this fails for any money-shaped
      // field somebody adds to the point.
      expect(Object.keys(result.points[0]).sort(compareAlphabetically)).toEqual(
        ['count', 'day', 'eventType'].sort(compareAlphabetically),
      );
    });

    it('3a. offboardings are a separate series from cancellations', async () => {
      // Stripe cancelling a subscription and an operator offboarding a
      // workspace are different endings. Merged, a dashboard cannot tell
      // voluntary churn from an incident.
      await event({
        stripeEventId: 'evt_cancelled',
        eventType: 'customer.subscription.deleted',
      });
      await createOrganization(fx.prisma, { deletedAt: at(2) });

      const result = await finance.listEvents(RANGE);

      expect(result.points).toEqual([
        { day: DAY, eventType: 'customer.subscription.deleted', count: 1 },
      ]);
      expect(result.currentlyOffboarded).toEqual([
        { day: DAY, eventType: 'organization.offboarded', count: 1 },
      ]);
    });

    it('3b. **a type never seen is absent from `observedEventTypes`, not zero**', async () => {
      // Which event types arrive at all is the Stripe endpoint's
      // `enabled_events`, and nothing in this repository configures it. Without
      // this field, "no cancellations this month" and "cancellations were never
      // enabled" render identically.
      await event({
        stripeEventId: 'evt_created',
        eventType: 'customer.subscription.created',
      });

      const result = await finance.listEvents(RANGE);

      expect(result.observedEventTypes).toEqual([
        'customer.subscription.created',
      ]);
      expect(result.observedEventTypes).not.toContain(
        'customer.subscription.deleted',
      );
    });

    it('3c. the range is inclusive at both ends and bounded', async () => {
      // Inclusive `to`: asking for the 1st through the 31st means the month,
      // and a half-open bound silently drops the last day of every range
      // anybody types.
      await event({
        stripeEventId: 'evt_last_day',
        eventType: 'invoice.paid',
        stripeCreatedAt: new Date('2026-03-31T23:59:59.000Z'),
      });

      const result = await finance.listEvents(RANGE);
      expect(result.points).toEqual([
        { day: '2026-03-31', eventType: 'invoice.paid', count: 1 },
      ]);

      // `billing_events` never shrinks, so the range is the only thing bounding
      // the read.
      await expectRpc(
        finance.listEvents({ from: '2020-01-01', to: '2026-12-31' }),
        status.INVALID_ARGUMENT,
      );

      // **No `expect(MAX_FINANCE_RANGE_DAYS).toBe(366)` here.** That asserts a
      // constant equals its own literal: the only edit that reddens it is
      // changing the constant, and the repair is to change the number to match.
      // The refusal above is the property, and it moves with the cap.
    });

    it('3d. **a restore rewrites `currentlyOffboarded` and cannot touch `points`**', async () => {
      // **The asymmetry is the property.** `billing_events` is append-only, so
      // its series is a record. `organizations.deleted_at` is CLEARED by a
      // restore, so that series is a projection of current state — restoring a
      // tenant removes it from every past range, including months already read
      // and quoted.
      //
      // Called `offboardings` that was a defect: an event count that shrinks.
      // Called `currentlyOffboarded` it is a specification, and this test is
      // what keeps the two apart — nobody reading the field later has to
      // discover the behaviour from a chart that changed.
      const superAdmin = await fx.prisma.user.findFirstOrThrow({
        where: { isSuperAdmin: true },
      });
      const organization = await createOrganization(fx.prisma, {
        deletedAt: at(2),
      });
      await event({
        stripeEventId: 'evt_cancelled_restore',
        eventType: 'customer.subscription.deleted',
      });

      const before = await finance.listEvents(RANGE);
      expect(before.currentlyOffboarded).toEqual([
        { day: DAY, eventType: 'organization.offboarded', count: 1 },
      ]);

      await platform.restoreOrganization(
        { organizationId: organization.id },
        superAdminContext(superAdmin.id),
      );

      const after = await finance.listEvents(RANGE);

      // The projection moved, exactly as its name says it may.
      expect(after.currentlyOffboarded).toEqual([]);
      // And the append-only series did not — which is the half a sabotage can
      // break, and the half a reader is entitled to rely on.
      expect(after.points).toEqual(before.points);
      expect(after.points).toEqual([
        { day: DAY, eventType: 'customer.subscription.deleted', count: 1 },
      ]);
    });

    it('3e. **the aggregate is complete, not capped** — and both filters agree', async () => {
      // The range bounds DAYS, not rows: the result is days x tenants x
      // events-per-tenant, and an earlier version selected every row to produce
      // a few hundred points. Aggregating in Postgres removes the materialised
      // result — and a `LIMIT` would have removed the correctness instead,
      // which is a strange property for a chart.
      const TOTAL = 250;
      for (let index = 0; index < TOTAL; index++) {
        await event({
          stripeEventId: `evt_bulk_${index}`,
          eventType:
            index % 2 === 0 ? 'invoice.paid' : 'invoice.payment_failed',
          stripeCreatedAt: new Date(
            `2026-03-${String((index % 28) + 1).padStart(2, '0')}T03:00:00.000Z`,
          ),
        });
      }

      const result = await finance.listEvents(RANGE);
      const counted = result.points.reduce(
        (total, point) => total + point.count,
        0,
      );

      expect(counted).toBe(TOTAL);

      // **The one exposure `$queryRaw` adds, pinned.** The aggregation spells
      // `source` in SQL and `STRIPE_EVENTS` spells it in Prisma; the value has
      // one spelling because it is a bound parameter, but the COLUMN NAME has
      // two. Running both over the same rows is what stops them drifting.
      const viaPrisma = await fx.prisma.billingEvent.count({
        where: {
          ...STRIPE_EVENTS,
          stripeCreatedAt: {
            gte: new Date('2026-03-01T00:00:00.000Z'),
            lt: new Date('2026-04-01T00:00:00.000Z'),
          },
        },
      });
      expect(counted).toBe(viaPrisma);
    });
  });

  // -------------------------------------------------------------- Degrading

  describe('the revenue section', () => {
    it('4. **with no snapshot, revenue degrades and the rest is intact**', async () => {
      const plan = await fx.prisma.subscriptionPlan.findFirstOrThrow({
        where: { name: 'Pro' },
      });
      await createOrganization(fx.prisma, {
        plan: { connect: { id: plan.id } },
        status: OrgStatus.SUSPENDED_PAST_DUE,
      });

      const snapshot = await finance.getSnapshot();

      expect(snapshot.revenue?.available).toBe(false);
      expect(snapshot.revenue?.unavailableReason).toBe(
        RevenueUnavailableReason.NO_SNAPSHOT,
      );
      // **The other three sections are local and exact**, and a missing
      // third-party read must not cost them — that is the entire reason the
      // section degrades instead of the call failing.
      expect(snapshot.tenants?.total).toBe(1);
      expect(snapshot.plans).toHaveLength(1);
      expect(snapshot.dunning?.pastDue).toBe(1);

      // The caveats travel even when there is no number, or a client learns
      // they are optional.
      expect(snapshot.revenue?.excludes).toEqual([...REVENUE_EXCLUSIONS]);
    });

    it('4a. **an unreachable store is NOT reported as "not computed yet"**', async () => {
      // `NO_SNAPSHOT` is a claim about the JOB, and a store that cannot be read
      // is a claim about the store — reported, before this, while
      // `/platform/jobs` showed `billing-snapshot` green and forty minutes
      // fresh. No reading of those two surfaces together was correct.
      //
      // **The client is made to reject rather than the key deleted.** A missing
      // key is the branch test 4 already owns; faulting
      // `BillingSnapshotStore.read` instead would stub out the `catch` that is
      // the subject and would pass against an implementation with no `catch` at
      // all.
      faults.fail(
        fx.moduleRef.get<Redis>(FINANCE_REDIS),
        'get',
        new Error('ECONNREFUSED'),
      );

      const snapshot = await finance.getSnapshot();

      expect(snapshot.revenue?.unavailableReason).toBe(
        RevenueUnavailableReason.SNAPSHOT_UNREADABLE,
      );
      expect(snapshot.revenue?.unavailableReason).not.toBe(
        RevenueUnavailableReason.NO_SNAPSHOT,
      );
      // And the local sections are untouched, which is why the store swallows
      // rather than throws.
      expect(snapshot.tenants?.total).toBe(0);
    });

    it('4b. **a snapshot missing its number degrades, rather than claiming one**', async () => {
      // What `JSON.parse(raw) as RevenueSnapshot` produced: a shape left by a
      // previous deploy satisfies the discriminant and carries no number.
      // Nothing downstream noticed — `toRevenue` trusts the discriminant, the
      // gateway mapper's `?? null` fills the hole, and the wire said
      // `available: true, estimatedMrr: null`. A section claiming a number it
      // does not have is worse than the degraded branch this design built.
      await fx.moduleRef.get<Redis>(FINANCE_REDIS).set(
        'finance:revenue-snapshot',
        // **`computedAt` present, `estimatedMrr` absent** — the shape a
        // previous deploy actually leaves, and the only fixture that reaches
        // the field checks. A bare `{"available":true}` is rejected by the
        // `computedAt` line alone, so it would have passed against a shape
        // check that stopped at the discriminant: measured, that sabotage
        // stayed green.
        '{"available":true,"computedAt":"2026-03-04T00:00:00.000Z"}',
      );

      const snapshot = await finance.getSnapshot();

      expect(snapshot.revenue?.available).toBe(false);
      expect(snapshot.revenue?.unavailableReason).toBe(
        RevenueUnavailableReason.SNAPSHOT_UNREADABLE,
      );
      expect(snapshot.revenue?.estimatedMrr).toBeUndefined();
    });

    it('5. **neither route makes a Stripe call**', async () => {
      // The one property that silently stops holding the day somebody "fixes"
      // a stale number by fetching it directly. Spying the GETTER rather than
      // one method catches every route to the SDK, which is why
      // `billing.e2e-spec` does the same for `getSubscription`.
      const apiSpy = faults.spy(stripe, 'api', 'get');

      await finance.getSnapshot();
      await finance.listEvents(RANGE);

      expect(apiSpy).not.toHaveBeenCalled();
    });

    it('6. **two currencies refuse rather than sum**', async () => {
      // 100 USD plus 100 EUR is 200 of nothing. Conversion would need a rate
      // this system does not have and a date it would have to pick, so the
      // section reports why instead of producing a confident wrong figure.
      // **`.env.test` sets no `STRIPE_SECRET_KEY`**, so `isConfigured` is false
      // by default here and the job would take its unconfigured branch. Forced
      // true, or this test would assert test 7's path under test 6's name.
      faults.spy(stripe, 'isConfigured', 'get').mockReturnValue(true);
      faults.spy(stripe, 'api', 'get').mockReturnValue({
        subscriptions: {
          list: () =>
            listing([subscription(10_000, 'usd'), subscription(10_000, 'eur')]),
        },
      });

      await snapshotJob.run();
      const snapshot = await finance.getSnapshot();

      expect(snapshot.revenue?.available).toBe(false);
      expect(snapshot.revenue?.unavailableReason).toBe(
        RevenueUnavailableReason.MIXED_CURRENCIES,
      );
    });

    it('6a. one currency sums, and an annual price is divided by twelve', async () => {
      // The control on test 6: without it, "refuses to sum" would also pass for
      // an implementation that never sums anything.
      const annual = subscription(120_000, 'usd');
      annual.items.data[0].price.recurring = {
        interval: 'year',
        interval_count: 1,
      } as never;

      faults.spy(stripe, 'isConfigured', 'get').mockReturnValue(true);
      faults.spy(stripe, 'api', 'get').mockReturnValue({
        subscriptions: {
          list: () => listing([subscription(2_500, 'usd'), annual]),
        },
      });

      await snapshotJob.run();
      const snapshot = await finance.getSnapshot();

      // 2500 + 120000/12 = 12500
      expect([
        snapshot.revenue?.available,
        snapshot.revenue?.estimatedMrr,
        snapshot.revenue?.currency,
        snapshot.revenue?.activeSubscriptions,
      ]).toEqual([true, 12_500, 'usd', 2]);
    });
  });

  // -------------------------------------------------------------- The job

  describe('the snapshot job', () => {
    it('7. **an unconfigured Stripe records a SUCCESS, not a failure**', async () => {
      // `STRIPE_SECRET_KEY` is optional by design — the service boots and every
      // tenant stays grandfathered. An hourly job that threw here would make
      // `/platform/jobs` permanently red on every developer machine and on any
      // billing-disabled deployment, and a row that is always red is one people
      // learn to scroll past. The job did its work; there was nothing to fetch.
      // **Pinned rather than inherited.** `.env.test` sets no
      // `STRIPE_SECRET_KEY`, so this is already the ambient state — which is
      // exactly why it is stated: a key added to `.env.test` later would
      // silently turn this into a test of a different branch.
      faults.spy(stripe, 'isConfigured', 'get').mockReturnValue(false);

      await processor.process({
        name: SCHEDULED_JOBS.BILLING_SNAPSHOT,
        data: {},
      } as never);

      const run = await fx.prisma.jobRun.findUniqueOrThrow({
        where: { jobName: SCHEDULED_JOBS.BILLING_SNAPSHOT },
      });
      expect([run.lastSucceededAt !== null, run.consecutiveFailures]).toEqual([
        true,
        0,
      ]);

      // And the endpoint says which of the three "no number" cases this is.
      const snapshot = await finance.getSnapshot();
      expect(snapshot.revenue?.unavailableReason).toBe(
        RevenueUnavailableReason.NOT_CONFIGURED,
      );
    });

    it('7a. **a configured Stripe that fails is left to fail**', async () => {
      // The other half of test 7, and the reason the unconfigured case needed
      // naming at all: a credential that STOPS working must show up as a stale
      // job rather than as a quietly frozen number. Swallowing both would make
      // `/platform/jobs` blind to the failure it exists to surface.
      faults.spy(stripe, 'isConfigured', 'get').mockReturnValue(true);
      faults.spy(stripe, 'api', 'get').mockReturnValue({
        subscriptions: {
          list: () => {
            throw new Error('Stripe is unreachable');
          },
        },
      });

      await expect(
        processor.process({
          name: SCHEDULED_JOBS.BILLING_SNAPSHOT,
          data: {},
        } as never),
      ).rejects.toThrow('Stripe is unreachable');

      const run = await fx.prisma.jobRun.findUniqueOrThrow({
        where: { jobName: SCHEDULED_JOBS.BILLING_SNAPSHOT },
      });
      expect(run.consecutiveFailures).toBe(1);
    });
  });
});
