import Stripe from 'stripe';
import { status } from '@grpc/grpc-js';
import { expectRpc } from '@synapsedesk/common/testing/rpc';
import { waitFor } from '@synapsedesk/common/testing/wait';
import { BillingEventSource, BillingEventStatus } from '@synapsedesk/common';
import { E2eFixture, bootstrapE2eTest, memberContext } from '../utils';
import {
  PLAN_FIXTURES,
  createInvitation,
  seedPlans,
  seedTenantWithUser,
} from '../factories';
import { PlanChangeService } from '../../src/modules/billing/plan-change.service';
import { StripeService } from '../../src/modules/billing/stripe.service';
import { EntitlementWriterService } from '../../src/modules/billing/entitlement-writer.service';
import { OrganizationsService } from '../../src/modules/organizations/organizations.service';

/**
 * `POST /billing/plan`'s auth-service half.
 *
 * The refusals, the seat check and the Stripe call live here; the storage and
 * document half is the gateway's, because ingestion dials auth on every presign
 * and the reverse edge would close a cycle on the identity leaf.
 */
describe('Plan change (e2e)', () => {
  let fx: E2eFixture;
  let planChange: PlanChangeService;
  let writer: EntitlementWriterService;
  let organizations: OrganizationsService;

  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';

  let retrieve: jest.Mock;
  let update: jest.Mock;

  const ctx = (t: { user: { id: string; organizationId: string | null } }) =>
    memberContext(t.user, ['organization.update', 'organization.read']);

  /**
   * Numbers the fake Stripe ids this file mints.
   *
   * **`Math.random()` was safe here and is replaced anyway.** Nothing reads
   * these for authenticity — they are fixture strings in a local database —
   * and the collision the `@unique` columns would punish did not happen in
   * 200,000 measured draws. The lint's own question answers "yes".
   *
   * What a counter buys is what the lint does not mention: a failure reporting
   * `cus_plan_change_3` names the fixture, where `cus_k3n2xq8p` names nothing
   * and differs on every run. Every sibling suite already spells these
   * descriptively — `cus_dunning`, `cus_apply`, `cus_cycle`.
   */
  let fixtureSeq = 0;

  /** The plan rows, by name, after `seedPlans` has written them. */
  const planNamed = async (name: string) =>
    fx.prisma.subscriptionPlan.findFirstOrThrow({ where: { name } });

  /** A tenant on Pro with a live Stripe subscription. */
  const subscribedTenant = async (
    overrides: Record<string, unknown> = {},
    seats = 25,
  ) => {
    const pro = await planNamed('Pro');
    const seq = (fixtureSeq += 1);
    const tenant = await seedTenantWithUser(fx.prisma, {
      organization: {
        // One number for the pair, so a customer and its subscription read as
        // belonging together in a failure message.
        stripeCustomerId: `cus_plan_change_${seq}`,
        stripeSubscriptionId: `sub_plan_change_${seq}`,
        plan: { connect: { id: pro.id } },
        maxAgentSeats: seats,
        maxStorageBytes: pro.maxStorageBytes,
        maxDocumentUploads: pro.maxDocumentUploads,
        ...overrides,
      },
    });

    return tenant;
  };

  /** The webhook Stripe sends immediately after a plan change lands. */
  const subscriptionUpdated = (
    customerId: string,
    subscriptionId: string,
    priceId: string,
  ) => ({
    // `stripe_event_id` is `@unique`, and one test delivers two events — so
    // this advances per CALL rather than per tenant.
    id: `evt_plan_change_${(fixtureSeq += 1)}`, // NOSONAR
    object: 'event',
    api_version: '2024-06-20',
    // **SECONDS, like Stripe.** This is the whole of §1: the claim row carries
    // `now()` to the millisecond, so an untagged claim makes this look older
    // than itself.
    created: Math.floor(Date.now() / 1000),
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: subscriptionId,
        object: 'subscription',
        customer: customerId,
        status: 'active',
        items: {
          data: [
            {
              id: 'si_existing_item',
              price: { id: priceId },
              current_period_start: Math.floor(Date.now() / 1000),
            },
          ],
        },
      },
    },
  });

  const deliver = async (event: Record<string, unknown>) => {
    const payload = Buffer.from(JSON.stringify(event), 'utf8');

    return writer.handle(
      payload,
      Stripe.webhooks.generateTestHeaderString({
        payload: payload.toString('utf8'),
        secret: WEBHOOK_SECRET,
      }),
    );
  };

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    planChange = fx.moduleRef.get(PlanChangeService);
    writer = fx.moduleRef.get(EntitlementWriterService);
    organizations = fx.moduleRef.get(OrganizationsService);

    // **The `api` GETTER is stubbed, not the client.** `.env.test` carries no
    // Stripe secret, so `StripeService.api` refuses with "billing is not
    // configured" — which is the correct production behaviour and makes the
    // real client unavailable here. Every assertion in this file is about what
    // we ASK Stripe rather than what it answers.
    retrieve = jest.fn();
    update = jest.fn();
    jest.spyOn(fx.moduleRef.get(StripeService), 'api', 'get').mockReturnValue({
      subscriptions: { retrieve, update },
    } as never);
  });

  beforeEach(async () => {
    await fx.reset();
    await seedPlans(fx.prisma);
    jest.clearAllMocks();

    retrieve.mockResolvedValue({
      id: 'sub_test',
      items: { data: [{ id: 'si_existing_item' }] },
    });
    update.mockResolvedValue({
      id: 'sub_test',
      latest_invoice: { total: -1_250 },
    });
  });

  afterAll(async () => {
    await fx.close();
  });

  // ------------------------------------------------------ the write it causes

  describe('The entitlement write the change causes', () => {
    it('1. **A plan change, then its webhook, WRITES the new entitlements**', async () => {
      // The test that should have existed from the start, and the one whose
      // absence hid a live defect: every other test here stops at "Stripe was
      // asked the right thing", which is exactly where the failure began.
      //
      // Measured before the fix: the webhook settled `SKIPPED_STALE`, the
      // organization kept Pro's 25 seats while being billed for Starter's 5,
      // and — because the notice and the cache invalidation are both downstream
      // of the write — nothing told anyone.
      const t = await subscribedTenant();
      const starter = await planNamed('Starter');

      await planChange.changePlan(
        { planId: starter.id, priceId: 'price_starter_monthly' },
        ctx(t),
      );

      const outcome = await deliver(
        subscriptionUpdated(
          t.org.stripeCustomerId as string,
          t.org.stripeSubscriptionId as string,
          'price_starter_monthly',
        ),
      );

      expect(outcome.status).toBe(BillingEventStatus.PROCESSED);

      const after = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: t.org.id },
      });

      expect(after.maxAgentSeats).toBe(starter.maxAgentSeats);
      expect(after.maxStorageBytes).toBe(starter.maxStorageBytes);
      expect(after.planId).toBe(starter.id);
      // Not vacuous: the tenant really was on Pro's larger grant beforehand.
      expect(t.org.maxAgentSeats).toBeGreaterThan(starter.maxAgentSeats);
    });

    it('2. **The claim is not the staleness high-water mark**', async () => {
      // §1 at the mechanism rather than at the outcome. The claim row carries
      // `now()` to the millisecond and Stripe's `created` is whole seconds, so
      // a webhook minted in the SAME second as the claim compares older than
      // it. Only `source: LOCAL` keeps it out of the ordering.
      const t = await subscribedTenant();
      const starter = await planNamed('Starter');

      await planChange.changePlan(
        { planId: starter.id, priceId: 'price_starter_monthly' },
        ctx(t),
      );

      // The claim is released after the attempt, so re-create the exact hazard:
      // a LOCAL row, still PROCESSED, timestamped inside this second.
      await fx.prisma.billingEvent.create({
        data: {
          stripeEventId: `plan-change:${t.org.id}:manual`,
          organizationId: t.org.id,
          eventType: 'plan.change_requested',
          stripeCreatedAt: new Date(),
          source: BillingEventSource.LOCAL,
          payload: {},
          status: BillingEventStatus.PROCESSED,
        },
      });

      const outcome = await deliver(
        subscriptionUpdated(
          t.org.stripeCustomerId as string,
          t.org.stripeSubscriptionId as string,
          'price_starter_monthly',
        ),
      );

      expect(outcome.status).toBe(BillingEventStatus.PROCESSED);
      await expect(
        fx.prisma.organization.findUniqueOrThrow({ where: { id: t.org.id } }),
      ).resolves.toMatchObject({ maxAgentSeats: starter.maxAgentSeats });
    });

    it('2b. …and a genuinely STALE Stripe event is still skipped', async () => {
      // The control. The guard must keep doing its job — excluding LOCAL rows
      // must not become excluding the ordering itself.
      const t = await subscribedTenant();
      const starter = await planNamed('Starter');

      await deliver(
        subscriptionUpdated(
          t.org.stripeCustomerId as string,
          t.org.stripeSubscriptionId as string,
          'price_starter_monthly',
        ),
      );

      const stale = {
        ...subscriptionUpdated(
          t.org.stripeCustomerId as string,
          t.org.stripeSubscriptionId as string,
          'price_pro_monthly',
        ),
        created: Math.floor(Date.now() / 1000) - 3_600,
      };

      const outcome = await deliver(stale);

      expect(outcome.status).toBe(BillingEventStatus.SKIPPED_STALE);
      // And the older event did not put them back on Pro.
      await expect(
        fx.prisma.organization.findUniqueOrThrow({ where: { id: t.org.id } }),
      ).resolves.toMatchObject({ maxAgentSeats: starter.maxAgentSeats });
    });
  });

  // ------------------------------------------------------------- the refusals

  describe('The four refusals, before Stripe is touched', () => {
    it('6. Refuses a PINNED tenant', async () => {
      // A Super Admin granted this workspace something off-catalogue, and the
      // webhook already refuses to overwrite it (`SKIPPED_PINNED`). Letting the
      // tenant self-serve onto a catalogue plan would discard the negotiated
      // grant through the front door while the back door is bolted.
      const t = await subscribedTenant({ entitlementsPinned: true });
      const starter = await planNamed('Starter');

      await expectRpc(
        planChange.changePlan(
          { planId: starter.id, priceId: 'price_starter_monthly' },
          ctx(t),
        ),
        status.FAILED_PRECONDITION,
      );

      expect(update).not.toHaveBeenCalled();
    });

    it('7. Refuses a price that belongs to a DIFFERENT plan', async () => {
      // Trusting `priceId` alone would let a caller name Pro's plan and
      // Starter's price — paying for one and being granted the other.
      const t = await subscribedTenant();
      const pro = await planNamed('Pro');

      await expectRpc(
        planChange.changePlan(
          { planId: pro.id, priceId: 'price_starter_monthly' },
          ctx(t),
        ),
        status.INVALID_ARGUMENT,
      );

      expect(update).not.toHaveBeenCalled();
    });

    it('Refuses a tenant with NO subscription — that is checkout, not a change', async () => {
      const t = await subscribedTenant({ stripeSubscriptionId: null });
      const starter = await planNamed('Starter');

      await expectRpc(
        planChange.changePlan(
          { planId: starter.id, priceId: 'price_starter_monthly' },
          ctx(t),
        ),
        status.FAILED_PRECONDITION,
      );
    });

    it('8. A RETIRED plan is absent from the catalogue AND refused by the endpoint', async () => {
      // One definition of "joinable", used by the list and by the gate — or the
      // UI offers a plan the endpoint rejects and the tenant reads a refusal as
      // a bug. Retired stays readable for the tenants already on it.
      const t = await subscribedTenant();
      const starter = await planNamed('Starter');

      await fx.prisma.subscriptionPlan.update({
        where: { id: starter.id },
        data: { isActive: false },
      });

      const listed = await planChange.listTenantPlans(ctx(t));
      expect(listed.items.map((plan) => plan.name)).not.toContain('Starter');
      // Not vacuous: the other plans are still listed. The seeded FREE plan is
      // absent from this count on purpose — it carries no prices, so it is not
      // joinable and the next test pins that.
      expect(listed.items.length).toBe(PLAN_FIXTURES.length - 1);

      await expectRpc(
        planChange.changePlan(
          { planId: starter.id, priceId: 'price_starter_monthly' },
          ctx(t),
        ),
        status.NOT_FOUND,
      );
    });

    it('8b. A plan with NO PRICES is not listed — it cannot be joined', async () => {
      // The seeded Free plan is `stripeProductId: null` with no prices: it is
      // assigned rather than sold. Listing it would offer a plan the UI cannot
      // put a price on and `changePlan` must refuse, because the target is
      // resolved through a price.
      const t = await subscribedTenant();

      const free = await fx.prisma.subscriptionPlan.findFirstOrThrow({
        where: { prices: { none: {} } },
      });
      // The row really is active and undeleted — so it is the price filter
      // keeping it out, not one of the other two.
      expect(free.isActive).toBe(true);
      expect(free.deletedAt).toBeNull();

      const listed = await planChange.listTenantPlans(ctx(t));

      expect(listed.items.map((plan) => plan.id)).not.toContain(free.id);
      expect(listed.items.length).toBe(PLAN_FIXTURES.length);
    });

    it('…and a soft-DELETED plan is refused on the same terms', async () => {
      const t = await subscribedTenant();
      const starter = await planNamed('Starter');

      await fx.prisma.subscriptionPlan.update({
        where: { id: starter.id },
        data: { deletedAt: new Date() },
      });

      const listed = await planChange.listTenantPlans(ctx(t));
      expect(listed.items.map((plan) => plan.name)).not.toContain('Starter');

      await expectRpc(
        planChange.changePlan(
          { planId: starter.id, priceId: 'price_starter_monthly' },
          ctx(t),
        ),
        status.NOT_FOUND,
      );
    });
  });

  // ------------------------------------------------------------- the seat half

  describe('The seat half of the block', () => {
    it('Refuses when seats in use exceed the target plan grant', async () => {
      // Starter grants 5. The tenant holds six seats, so the change is refused
      // with the number to reduce — and Stripe is never reached.
      const t = await subscribedTenant({}, 25);
      const starter = await planNamed('Starter');

      for (let i = 0; i < 5; i += 1) {
        await createInvitation(fx.prisma, t.org.id, {
          invitedById: t.user.id,
          email: `seat-${i}@plan-change.test`,
        });
      }

      await expectRpc(
        planChange.changePlan(
          { planId: starter.id, priceId: 'price_starter_monthly' },
          ctx(t),
        ),
        status.FAILED_PRECONDITION,
      );

      expect(update).not.toHaveBeenCalled();
    });

    it('1. Uses the SAME seat count the invitation gate does — locked users included', async () => {
      // The regression this phase fixed: `overLimit` counted `isLocked: false`
      // and the gate did not, so a tenant with locked users read as one number
      // to a refusal and another to a projection. A block computed from a
      // different number than the gate that refuses afterwards is not a block.
      const t = await subscribedTenant({}, 25);

      await fx.prisma.user.update({
        where: { id: t.user.id },
        data: { isLocked: true },
      });

      const preview = await planChange.previewPlanChange(
        {
          planId: (await planNamed('Starter')).id,
          priceId: 'price_starter_monthly',
        },
        ctx(t),
      );

      const seatsInUse = await organizations.seatsInUse(fx.prisma, t.org.id);

      // The locked user is counted — deleting frees a seat, locking does not.
      expect(seatsInUse).toBe(1);
      // And what the preview reports about seats is derived from that count.
      expect(preview.overLimit).toEqual([]);

      // Now put the tenant over Starter's five seats with locked users only.
      for (let i = 0; i < 5; i += 1) {
        await fx.prisma.user.create({
          data: {
            organizationId: t.org.id,
            email: `locked-${i}@plan-change.test`,
            fullName: 'Locked',
            isLocked: true,
          },
        });
      }

      const after = await planChange.previewPlanChange(
        {
          planId: (await planNamed('Starter')).id,
          priceId: 'price_starter_monthly',
        },
        ctx(t),
      );

      expect(after.overLimit).toEqual([
        'maxAgentSeats: 6 in use, plan grants 5',
      ]);
    });
  });

  // ------------------------------------------------------- narrowing and Stripe

  describe('What the preview hands the gateway', () => {
    it('Names only the dimensions that NARROW, with the target grants as numbers', async () => {
      // The gateway dials ingestion for these and nothing else. Grants travel
      // as numbers off `subscription_plans` — never parsed out of a rendered
      // "before -> after" string, which would make a formatting change upstream
      // turn a block into an allow.
      const t = await subscribedTenant();
      const starter = await planNamed('Starter');

      const preview = await planChange.previewPlanChange(
        { planId: starter.id, priceId: 'price_starter_monthly' },
        ctx(t),
      );

      expect(preview.narrowedDimensions).toEqual(['storage', 'documents']);
      expect(preview.targetMaxStorageBytes).toBe(
        Number(starter.maxStorageBytes),
      );
      expect(preview.targetMaxDocumentUploads).toBe(starter.maxDocumentUploads);
      expect(preview.planName).toBe('Starter');
    });

    it('Names NOTHING when the target widens every dimension', async () => {
      // An upgrade dials no usage RPC at all, which is what keeps it one Stripe
      // round trip and unblockable by an unrelated outage.
      const starter = await planNamed('Starter');
      const t = await subscribedTenant({
        plan: { connect: { id: starter.id } },
        maxStorageBytes: starter.maxStorageBytes,
        maxDocumentUploads: starter.maxDocumentUploads,
      });
      const enterprise = await planNamed('Enterprise');

      const preview = await planChange.previewPlanChange(
        { planId: enterprise.id, priceId: 'price_enterprise_monthly' },
        ctx(t),
      );

      expect(preview.narrowedDimensions).toEqual([]);
    });

    it('Writes nothing — a preview that mutated would be a plan change', async () => {
      const t = await subscribedTenant();
      const before = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: t.org.id },
      });

      await planChange.previewPlanChange(
        {
          planId: (await planNamed('Starter')).id,
          priceId: 'price_starter_monthly',
        },
        ctx(t),
      );

      const after = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: t.org.id },
      });

      expect(after).toEqual(before);
      expect(await fx.prisma.billingEvent.count()).toBe(0);
    });
  });

  describe('The Stripe call', () => {
    it('5. **Passes the existing subscription ITEM id**', async () => {
      // Stripe's own guide, in bold: *"You must specify the subscription item
      // to replace the current price with the new price. Failing to do so
      // results in ADDING the new price so both prices are active."*
      //
      // The failure if it is skipped is silent at every hop: two items, the
      // customer billed for both plans, and `priceIdOf` reading
      // `items.data[0].price.id` — the OLD price — so entitlements never move.
      const t = await subscribedTenant();
      const starter = await planNamed('Starter');

      await planChange.changePlan(
        { planId: starter.id, priceId: 'price_starter_monthly' },
        ctx(t),
      );

      const [subscriptionId, params, options] = update.mock.calls[0] as [
        string,
        { items: { id: string; price: string }[]; proration_behavior: string },
        { idempotencyKey?: string },
      ];

      expect(subscriptionId).toBe(t.org.stripeSubscriptionId);
      expect(params.items).toEqual([
        { id: 'si_existing_item', price: 'price_starter_monthly' },
      ]);
      // Immediate in both directions, and billed at the moment the grant moves.
      expect(params.proration_behavior).toBe('always_invoice');
      // Derived rather than generated: a generated key makes every retry a new
      // operation, which is the whole failure it guards.
      expect(options.idempotencyKey).toContain(t.org.id);
    });

    it('Reports a CREDIT rather than a refund when the proration is negative', async () => {
      // Stripe does not auto-refund a negative proration. Read from the invoice
      // `always_invoice` just created, not inferred from the direction.
      const t = await subscribedTenant();
      const starter = await planNamed('Starter');

      const response = await planChange.changePlan(
        { planId: starter.id, priceId: 'price_starter_monthly' },
        ctx(t),
      );

      expect(response.creditIssued).toBe(true);
      expect(response.planName).toBe('Starter');
    });

    it('12. **A duplicate arriving WHILE the first is in flight is refused**', async () => {
      // The window the claim exists for, and the only one it should cover: a
      // double-click, a proxy retry, two tabs. `always_invoice` means the
      // second attempt is a second proration invoice that looks legitimate at
      // every layer.
      const t = await subscribedTenant();
      const starter = await planNamed('Starter');
      const request = {
        planId: starter.id,
        priceId: 'price_starter_monthly',
        idempotencyKey: 'client-key-1',
      };

      // Hold Stripe open so the first attempt is genuinely in flight.
      let release!: () => void;
      update.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({ id: 'sub_test', latest_invoice: { total: -1_250 } });
          }),
      );

      const first = planChange.changePlan(request, ctx(t));
      // **Wait for the lock to actually be held**, not for a tick to pass. The
      // first version raced `retrieve`'s microtask and released a promise
      // nobody had created yet, which hung the run rather than failing it.
      await waitFor(() => update.mock.calls.length === 1);

      await expectRpc(
        planChange.changePlan(request, ctx(t)),
        status.ALREADY_EXISTS,
      );

      release();
      await first;

      expect(update).toHaveBeenCalledTimes(1);
    });

    it('3. **A Stripe refusal leaves NO claim, and the retry works**', async () => {
      // The claim is a lock on an attempt, not a record that one was made.
      // Kept after a failure it was a permanent refusal: the tenant fixes their
      // card, retries the identical request, and is told the change "has
      // already been submitted" forever — the only escape being a different
      // header, which a browser retry will not produce.
      const t = await subscribedTenant();
      const starter = await planNamed('Starter');
      const request = {
        planId: starter.id,
        priceId: 'price_starter_monthly',
        idempotencyKey: 'client-key-1',
      };

      update.mockRejectedValueOnce(
        new Stripe.errors.StripeCardError({
          message: 'Your card was declined',
        }),
      );

      await expectRpc(
        planChange.changePlan(request, ctx(t)),
        status.FAILED_PRECONDITION,
      );

      // Nothing left behind — the table holds no claim for this tenant.
      await expect(
        fx.prisma.billingEvent.count({
          where: { organizationId: t.org.id, source: BillingEventSource.LOCAL },
        }),
      ).resolves.toBe(0);

      const retried = await planChange.changePlan(request, ctx(t));

      expect(retried.planName).toBe('Starter');
      expect(update).toHaveBeenCalledTimes(2);
    });

    it('4. **With NO Idempotency-Key, the same change can be made again**', async () => {
      // The fallback key is the plan tuple, and the tuple recurs: a tenant who
      // moves Starter → Pro → Starter would have been refused the third step
      // forever, having done nothing wrong. Releasing the claim is what bounds
      // it to the request — no date bucket, and therefore no boundary at which
      // this key and Stripe's roll together and a straddling double-submit
      // passes both.
      const t = await subscribedTenant();
      const starter = await planNamed('Starter');
      const request = {
        planId: starter.id,
        priceId: 'price_starter_monthly',
      };

      await planChange.changePlan(request, ctx(t));
      const again = await planChange.changePlan(request, ctx(t));

      expect(again.planName).toBe('Starter');
      expect(update).toHaveBeenCalledTimes(2);
    });

    it('6. **A Stripe OUTAGE is `UNAVAILABLE`, not a refusal**', async () => {
      // `StripeError` is the base class, and catching it wholesale tells a
      // tenant their payment provider refused them when Stripe was simply
      // unreachable — sending them to check a card that is fine. The same
      // distinction the usage leg draws between "we could not verify" and
      // "this does not fit".
      const t = await subscribedTenant();
      const starter = await planNamed('Starter');

      update.mockRejectedValueOnce(
        new Stripe.errors.StripeConnectionError({
          message: 'the network is unreachable',
        }),
      );

      await expectRpc(
        planChange.changePlan(
          { planId: starter.id, priceId: 'price_starter_monthly' },
          ctx(t),
        ),
        status.UNAVAILABLE,
      );
    });

    it('6b. …and a reused key with different parameters is ALREADY_EXISTS', async () => {
      const t = await subscribedTenant();
      const starter = await planNamed('Starter');

      update.mockRejectedValueOnce(
        new Stripe.errors.StripeIdempotencyError({
          message: 'That key was used with different parameters',
        }),
      );

      await expectRpc(
        planChange.changePlan(
          { planId: starter.id, priceId: 'price_starter_monthly' },
          ctx(t),
        ),
        status.ALREADY_EXISTS,
      );
    });
  });
});
