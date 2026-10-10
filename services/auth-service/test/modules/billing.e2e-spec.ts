import Stripe from 'stripe';
import { expectRpc } from '@synapsedesk/common/testing/rpc';
import { status } from '@grpc/grpc-js';
import {
  AuditPublisher,
  BillingEventStatus,
  OrgStatus,
  JetStreamPublisher,
  NOTIFICATION_TYPES,
  NotificationPriority,
  STRIPE_PORTAL_MARKER,
} from '@synapsedesk/common';
import { fromProtoAiModelTier } from '@synapsedesk/grpc-proto';
import {
  E2eFixture,
  bootstrapE2eTest,
  memberContext,
  superAdminContext,
} from '../utils';
import { createOrganization, planForPrice, seedPlans } from '../factories';
import { EntitlementWriterService } from '../../src/modules/billing/entitlement-writer.service';
import { BillingService } from '../../src/modules/billing/billing.service';
import { StripeService } from '../../src/modules/billing/stripe.service';
import { BillingEventPublisher } from '../../src/modules/billing/billing-event.publisher';
import { PlatformService } from '../../src/modules/platform/platform.service';
import { OrganizationsService } from '../../src/modules/organizations/organizations.service';
import { faultInjector } from '@synapsedesk/common/testing/fault';

describe('Billing and entitlements (e2e)', () => {
  // Every injected fault in this file is registered here and restored in an
  // `afterEach` that runs whether the test passed, failed or threw.
  const faults = faultInjector();

  let fx: E2eFixture;
  let writer: EntitlementWriterService;
  let billing: BillingService;
  let stripe: StripeService;
  let platform: PlatformService;
  let organizations: OrganizationsService;
  let auditRecord: jest.SpyInstance;
  let publishEntitlementsChanged: jest.SpyInstance;
  let jetstreamPublish: jest.SpyInstance;

  /** Matches `STRIPE_WEBHOOK_SECRET` in .env.test. */
  const WEBHOOK_SECRET = 'whsec_test_secret_for_the_e2e_suite';

  /** A stable id for the operator in the audit assertions. */
  const SUPER_ADMIN_ID = '00000000-0000-4000-8000-00000000dead';

  const STARTER = 'price_starter_monthly';
  const PRO = 'price_pro_monthly';

  /**
   * Builds a signed webhook exactly as Stripe would.
   *
   * **Signed with the real SDK over the real bytes**, not stubbed. Verification
   * is the piece built first — "every other test in this
   * document needs a webhook that verifies, and debugging a mapping function
   * through a signature failure is a bad afternoon" — so a suite that mocked it
   * away would be testing the mapping against a door it had propped open.
   */
  const signedEvent = (
    event: Record<string, unknown>,
  ): {
    payload: Buffer;
    signature: string;
  } => {
    const payload = Buffer.from(JSON.stringify(event), 'utf8');
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload: payload.toString('utf8'),
      secret: WEBHOOK_SECRET,
    });

    return { payload, signature };
  };

  let eventCounter = 0;

  const subscriptionEvent = (options: {
    type?: string;
    customerId: string;
    priceId?: string;
    subscriptionId?: string;
    createdAt?: Date;
    subscriptionStatus?: string;
    periodStart?: Date;
  }): Record<string, unknown> => {
    eventCounter += 1;

    return {
      id: `evt_test_${eventCounter}_${Date.now()}`,
      object: 'event',
      api_version: '2024-06-20',
      // SECONDS, like Stripe. Reading this as milliseconds would put every event
      // in 1970 and make the monotonic guard skip everything after the first.
      created: Math.floor((options.createdAt ?? new Date()).getTime() / 1000),
      type: options.type ?? 'customer.subscription.updated',
      data: {
        object: {
          id: options.subscriptionId ?? 'sub_test_1',
          object: 'subscription',
          customer: options.customerId,
          status: options.subscriptionStatus ?? 'active',
          items: {
            object: 'list',
            data: [
              {
                id: 'si_test_1',
                price: { id: options.priceId ?? PRO, object: 'price' },
                current_period_start: Math.floor(
                  (options.periodStart ?? new Date()).getTime() / 1000,
                ),
              },
            ],
          },
        },
      },
    };
  };

  const subscribedOrganization = async (customerId: string) => {
    return createOrganization(fx.prisma, { stripeCustomerId: customerId });
  };

  /**
   * A failed payment, shaped as Stripe sends it.
   *
   * `next_payment_attempt` present means "we will try again"; absent means this
   * was the last attempt — which is the distinction the notice turns on.
   */
  const invoicePaymentFailedEvent = (options: {
    customerId: string;
    nextAttempt?: number | null;
  }): Record<string, unknown> => {
    eventCounter += 1;

    return {
      id: `evt_dunning_${eventCounter}_${Date.now()}`,
      object: 'event',
      api_version: '2024-06-20',
      created: Math.floor(Date.now() / 1000),
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: `in_test_${eventCounter}`,
          object: 'invoice',
          customer: options.customerId,
          amount_due: 4900,
          currency: 'usd',
          attempt_count: 1,
          next_payment_attempt:
            options.nextAttempt === undefined
              ? Math.floor(Date.now() / 1000) + 86_400 * 3
              : options.nextAttempt,
        },
      },
    };
  };

  const deliver = async (event: Record<string, unknown>) => {
    const { payload, signature } = signedEvent(event);

    return writer.handle(payload, signature);
  };

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    writer = fx.moduleRef.get(EntitlementWriterService);
    billing = fx.moduleRef.get(BillingService);
    stripe = fx.moduleRef.get(StripeService);
    platform = fx.moduleRef.get(PlatformService);
    organizations = fx.moduleRef.get(OrganizationsService);

    // The audit write is fire-and-forget over NATS, which is not running here —
    // so a real publish would prove nothing either way.
    auditRecord = jest.spyOn(fx.moduleRef.get(AuditPublisher), 'record');

    // **Spied, not stubbed.** The plan-changed notice is built INSIDE
    // `publishEntitlementsChanged`, so replacing the method removes the thing
    // under test — every assertion about the notice would have measured a
    // method that never ran. The real one executes and the transport below is
    // what gets replaced.
    publishEntitlementsChanged = jest.spyOn(
      fx.moduleRef.get(BillingEventPublisher),
      'publishEntitlementsChanged',
    );

    // NATS is not running for this suite and the publish is fire-and-forget, so
    // the real one would log an error and prove nothing. This is the boundary
    // the notice actually crosses.
    jetstreamPublish = jest.spyOn(
      fx.moduleRef.get(JetStreamPublisher),
      'publish',
    );
  });

  beforeEach(async () => {
    await fx.reset();
    // The catalogue is a TABLE now, so every test needs it written. `reset`
    // truncates, which is what makes the seed a per-test step rather than a
    // one-off — and what makes "an unmapped price" a state a test can create
    // by simply not seeding one.
    await seedPlans(fx.prisma);
    jest.clearAllMocks();
    jetstreamPublish.mockImplementation(() => undefined);
    auditRecord.mockImplementation(() => undefined);
  });

  afterAll(async () => {
    await fx.close();
  });

  // ------------------------------------------------------- the schema

  describe('Schema and the grandfathered path', () => {
    it('1. Defaults BOTH Stripe columns to NULL, and such a tenant is fully usable', async () => {
      // The grandfathering path, and the test that fails if someone makes the
      // columns required. On the day this ships, EVERY tenant looks like this.
      const organization = await createOrganization(fx.prisma);

      expect(organization.stripeCustomerId).toBeNull();
      expect(organization.stripeSubscriptionId).toBeNull();

      // And every entitlement a quota gate reads is still populated, so the
      // gates keep working with no billing involved at all.
      expect(organization.maxAgentSeats).toBeGreaterThan(0);
      expect(organization.maxStorageBytes).toBeGreaterThan(0n);
      expect(organization.monthlyAiTokenBudget).toBeGreaterThan(0n);
    });

    it('2. Enforces stripe_event_id UNIQUE as a DATABASE constraint', async () => {
      // The idempotency guarantee is a constraint, not a code path — so this
      // asserts the constraint rather than the handler. A handler-level check
      // has a race between two concurrent deliveries that both pass it, which
      // is the normal case when Stripe retries a request that timed out.
      const [row] = await fx.prisma.$queryRawUnsafe<{ indexname: string }[]>(
        `SELECT indexname FROM pg_indexes
         WHERE tablename = 'billing_events'
           AND indexdef ILIKE '%UNIQUE%'
           AND indexdef ILIKE '%stripe_event_id%'`,
      );

      expect(row).toBeDefined();
    });

    it('3. Defaults ai_model_tier to FAST for every row', async () => {
      // A NULL tier reaching the settings layer is an unresolvable model name
      // at request time — the failure would land on a user's question, not on
      // the migration.
      const organization = await createOrganization(fx.prisma);

      expect(organization.aiModelTier).toBe('FAST');
    });
  });

  // ------------------------------------------- the entitlement writer

  describe('The entitlement writer', () => {
    it('1. Applies entitlements to the right organization', async () => {
      const organization = await subscribedOrganization('cus_apply');

      const outcome = await deliver(
        subscriptionEvent({ customerId: 'cus_apply', priceId: PRO }),
      );

      expect(outcome.status).toBe(BillingEventStatus.PROCESSED);

      const updated = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: organization.id },
      });
      const plan = planForPrice(PRO);

      expect(updated.maxAgentSeats).toBe(plan.maxAgentSeats);
      expect(updated.maxStorageBytes).toBe(plan.maxStorageBytes);
      expect(updated.monthlyAiTokenBudget).toBe(plan.monthlyAiTokenBudget);
      expect(updated.aiModelTier).toBe(plan.aiModelTier);
      expect(updated.maxDocumentBytes).toBe(plan.maxDocumentBytes);
      expect(updated.maxAttachmentBytes).toBe(plan.maxAttachmentBytes);
      expect(updated.stripeSubscriptionId).toBe('sub_test_1');
    });

    it('1b. **Applies a plan that NARROWS the file-size grants**', async () => {
      // Pro sits at the platform ceiling on both, so test 1 cannot tell an
      // applied grant from an untouched default — the numbers are the same.
      // Starter narrows both, which is the only shape that proves the write.
      const organization = await subscribedOrganization('cus_narrow');
      const plan = planForPrice(STARTER);

      // The tenant starts at the platform ceiling, by column default.
      const before = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: organization.id },
      });
      expect(before.maxDocumentBytes).toBeGreaterThan(plan.maxDocumentBytes);
      expect(before.maxAttachmentBytes).toBeGreaterThan(
        plan.maxAttachmentBytes,
      );

      await deliver(
        subscriptionEvent({ customerId: 'cus_narrow', priceId: STARTER }),
      );

      const updated = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: organization.id },
      });

      expect(updated.maxDocumentBytes).toBe(plan.maxDocumentBytes);
      expect(updated.maxAttachmentBytes).toBe(plan.maxAttachmentBytes);
    });

    it('1c. **Monthly and ANNUAL prices of one plan grant the SAME entitlements**', async () => {
      // The reason the catalogue is keyed on Stripe PRODUCT rather than price.
      // Keying by price makes "Pro monthly" and "Pro annual" two rows carrying
      // duplicated entitlements, and the failure is not a crash — it is drift:
      // someone raises a seat count on one row, and half the Pro customers
      // silently keep the old one. Checkout and invoices render the PRODUCT
      // name, so the two are indistinguishable on the customer's receipt while
      // granting different things.
      const monthly = await subscribedOrganization('cus_pro_monthly');
      const annual = await subscribedOrganization('cus_pro_annual');

      // Distinct subscription ids: `stripe_subscription_id` is UNIQUE, and two
      // tenants genuinely have two subscriptions. Reusing the fixture default
      // would fail on the constraint rather than on anything this test is about.
      await deliver(
        subscriptionEvent({
          customerId: 'cus_pro_monthly',
          priceId: PRO,
          subscriptionId: 'sub_pro_monthly',
        }),
      );
      await deliver(
        subscriptionEvent({
          customerId: 'cus_pro_annual',
          priceId: 'price_pro_annual',
          subscriptionId: 'sub_pro_annual',
        }),
      );

      const [onMonthly, onAnnual] = await Promise.all([
        fx.prisma.organization.findUniqueOrThrow({ where: { id: monthly.id } }),
        fx.prisma.organization.findUniqueOrThrow({ where: { id: annual.id } }),
      ]);

      const grants = (row: typeof onMonthly) => ({
        planId: row.planId,
        maxAgentSeats: row.maxAgentSeats,
        maxStorageBytes: row.maxStorageBytes,
        monthlyAiTokenBudget: row.monthlyAiTokenBudget,
        aiModelTier: row.aiModelTier,
        maxDocumentBytes: row.maxDocumentBytes,
        maxAttachmentBytes: row.maxAttachmentBytes,
      });

      // Every grant, not a sample — a drift bug shows up in whichever column
      // nobody thought to assert.
      expect(grants(onAnnual)).toEqual(grants(onMonthly));
      // And they are the SAME plan row, which is what makes that true by
      // construction rather than by two fixtures happening to agree.
      expect(onAnnual.planId).toBe(onMonthly.planId);
      expect(onAnnual.planId).not.toBeNull();
    });

    it('2. Applies the SAME event delivered twice exactly ONCE', async () => {
      // Not merely "200 both times". Stripe retries on any non-2xx, including
      // a timeout on a request that actually succeeded, so a redelivery is the
      // normal path — and a second write is only harmless while the mapping
      // stays idempotent. It stops being harmless the day anything becomes
      // incremental (a credit top-up, a proration).
      const organization = await subscribedOrganization('cus_twice');
      const event = subscriptionEvent({
        customerId: 'cus_twice',
        priceId: PRO,
      });

      const first = await deliver(event);
      const second = await deliver(event);

      expect(first.status).toBe(BillingEventStatus.PROCESSED);
      expect(second.status).toBe(BillingEventStatus.SKIPPED_DUPLICATE);

      await expect(
        fx.prisma.billingEvent.count({
          where: { organizationId: organization.id },
        }),
      ).resolves.toBe(1);
      // One entitlement write, so one invalidation.
      expect(publishEntitlementsChanged).toHaveBeenCalledTimes(1);
    });

    it('3. REFUSES to let an out-of-order older event overwrite newer entitlements', async () => {
      // **The silent-downgrade guard**, and the one that bites. A delayed
      // `subscription.updated` carrying yesterday's Starter plan can land after
      // today's upgrade to Pro. Nothing errors; the tenant notices days later
      // when their seat limit stops matching what they bought, and the audit
      // trail shows a successful webhook doing exactly what it was told.
      const organization = await subscribedOrganization('cus_order');
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 3_600_000);

      await deliver(
        subscriptionEvent({
          customerId: 'cus_order',
          priceId: PRO,
          createdAt: now,
        }),
      );

      const stale = await deliver(
        subscriptionEvent({
          customerId: 'cus_order',
          priceId: STARTER,
          createdAt: yesterday,
        }),
      );

      expect(stale.status).toBe(BillingEventStatus.SKIPPED_STALE);

      const updated = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: organization.id },
      });
      // Still Pro. The paying customer keeps what they paid for.
      expect(updated.aiModelTier).toBe(planForPrice(PRO).aiModelTier);
      expect(updated.maxAgentSeats).toBe(planForPrice(PRO).maxAgentSeats);
    });

    it('3b. Still applies a NEWER event after an older one was skipped', async () => {
      // The complement, and it matters: a monotonic guard that latched would
      // block every later change too, turning one out-of-order delivery into a
      // permanently frozen plan.
      const organization = await subscribedOrganization('cus_recover');
      const now = new Date();

      await deliver(
        subscriptionEvent({
          customerId: 'cus_recover',
          priceId: PRO,
          createdAt: now,
        }),
      );
      await deliver(
        subscriptionEvent({
          customerId: 'cus_recover',
          priceId: STARTER,
          createdAt: new Date(now.getTime() - 3_600_000),
        }),
      );

      const later = await deliver(
        subscriptionEvent({
          customerId: 'cus_recover',
          priceId: STARTER,
          createdAt: new Date(now.getTime() + 3_600_000),
        }),
      );

      expect(later.status).toBe(BillingEventStatus.PROCESSED);

      const updated = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: organization.id },
      });
      expect(updated.maxAgentSeats).toBe(planForPrice(STARTER).maxAgentSeats);
    });

    it('5. **A PINNED organization records the event and writes NOTHING**', async () => {
      // D3's live gap. `PATCH /platform/organizations/:id` already grants a
      // negotiated `maxAgentSeats` today, and the next routine webhook — a
      // renewal, a card update — silently reverts it by re-deriving from the
      // price. The monotonic guard cannot help: it compares Stripe's `created`
      // timestamps and a manual edit has none.
      const organization = await subscribedOrganization('cus_pinned');
      const negotiated = 999;

      await fx.prisma.organization.update({
        where: { id: organization.id },
        data: { maxAgentSeats: negotiated, entitlementsPinned: true },
      });

      const outcome = await deliver(
        subscriptionEvent({ customerId: 'cus_pinned', priceId: PRO }),
      );

      const updated = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: organization.id },
      });

      // The negotiated grant survives a webhook that would have overwritten it.
      expect(updated.maxAgentSeats).toBe(negotiated);
      expect(updated.maxAgentSeats).not.toBe(planForPrice(PRO).maxAgentSeats);
      expect(outcome.status).toBe(BillingEventStatus.SKIPPED_PINNED);
    });

    it('5b. **…and SKIPPED_PINNED is distinguishable from SKIPPED_STALE**', async () => {
      // Two skips that mean opposite things. Stale is a transport artefact and
      // self-correcting; pinned is a deliberate policy about one tenant that
      // will skip EVERY future event until someone unpins it. Collapsing them
      // makes an operator reading the ledger unable to tell a delayed delivery
      // from a tenant deliberately held off-catalogue.
      const pinned = await subscribedOrganization('cus_pin_status');
      await fx.prisma.organization.update({
        where: { id: pinned.id },
        data: { entitlementsPinned: true },
      });

      await deliver(
        subscriptionEvent({ customerId: 'cus_pin_status', priceId: PRO }),
      );

      const row = await fx.prisma.billingEvent.findFirstOrThrow({
        where: { organizationId: pinned.id },
        orderBy: { processedAt: 'desc' },
      });

      expect(row.status).toBe(BillingEventStatus.SKIPPED_PINNED);
      expect(row.status).not.toBe(BillingEventStatus.SKIPPED_STALE);
    });

    it('5c. **The pin skips the write but NOT the recording**', async () => {
      // The half that makes a pin auditable rather than a black hole: the event
      // is still stored, still ordered, still answerable. Only the UPDATE is
      // skipped. A pin that dropped events would leave no trace that Stripe had
      // been trying to tell us something for six months.
      const pinned = await subscribedOrganization('cus_pin_ledger');
      await fx.prisma.organization.update({
        where: { id: pinned.id },
        data: { entitlementsPinned: true },
      });

      await deliver(
        subscriptionEvent({ customerId: 'cus_pin_ledger', priceId: PRO }),
      );

      await expect(
        fx.prisma.billingEvent.count({ where: { organizationId: pinned.id } }),
      ).resolves.toBe(1);
    });

    it('5d. **`invoice.payment_failed` reaches the DUNNING consumer, not the writer**', async () => {
      // §4's whole design. Widening `HANDLED_EVENT_TYPES` instead would feed an
      // INVOICE into a writer that reads `event.data.object` as a Subscription
      // and derives a plan from its price — applying entitlements from an
      // object that does not describe one.
      const organization = await subscribedOrganization('cus_dunning');
      const before = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: organization.id },
      });

      const outcome = await deliver(
        invoicePaymentFailedEvent({ customerId: 'cus_dunning' }),
      );

      expect(outcome.status).toBe(BillingEventStatus.PROCESSED);

      // **Not one entitlement moved.** The dunning path tells somebody; it does
      // not decide what they are entitled to. Suspension arrives separately, on
      // the subscription event Stripe sends alongside.
      const after = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: organization.id },
      });
      expect(after.maxAgentSeats).toBe(before.maxAgentSeats);
      expect(after.aiModelTier).toBe(before.aiModelTier);
      expect(after.maxDocumentUploads).toBe(before.maxDocumentUploads);

      // And it is recorded against the tenant, so "did we tell them" is
      // answerable during the support call that follows.
      const row = await fx.prisma.billingEvent.findFirstOrThrow({
        where: { organizationId: organization.id },
        orderBy: { processedAt: 'desc' },
      });
      expect(row.eventType).toBe('invoice.payment_failed');

      // **And somebody was actually told.** The three assertions above are the
      // negative half — nothing moved — which a `handle` that returned
      // immediately would also satisfy. This is the half that fails if the
      // dunning consumer stops publishing.
      const dunning = jetstreamPublish.mock.calls.find(([, command]) =>
        String((command as { eventId?: string }).eventId ?? '').startsWith(
          'dunning:',
        ),
      );
      expect(dunning).toBeDefined();

      const [, command, messageId] = dunning as [
        string,
        {
          organizationId: string;
          type: string;
          priority: string;
          eventId: string;
          data: { nextAttempt: string | null };
        },
        string,
      ];
      expect(command.organizationId).toBe(organization.id);
      expect(command.type).toBe(NOTIFICATION_TYPES.paymentFailed);
      // Always CRITICAL: every one of these has a deadline attached.
      expect(command.priority).toBe(NotificationPriority.CRITICAL);
      expect(command.data.nextAttempt).not.toBeNull();
      // Derived, and the SAME string in both places — so the stream's dedupe
      // window and Domain E's partial unique index collapse on one field.
      expect(messageId).toBe(command.eventId);
    });

    it('5e. …and an unresolved customer is recorded rather than dropped', async () => {
      // The same rule the entitlement path follows: a payment failing for a
      // customer we cannot resolve is a data problem worth a row, not a silent
      // discard.
      const outcome = await deliver(
        invoicePaymentFailedEvent({ customerId: 'cus_nobody_dunning' }),
      );

      expect(outcome.status).toBe(BillingEventStatus.PROCESSED);

      // **Unattached, which is the stated behaviour.** Counting rows of this
      // event type was satisfied by 5d's row too, so it asserted nothing this
      // test is about: a customer we cannot resolve has no tenant to hang the
      // row on, and the row is kept anyway.
      const row = await fx.prisma.billingEvent.findFirstOrThrow({
        where: { eventType: 'invoice.payment_failed' },
        orderBy: { processedAt: 'desc' },
      });
      expect(row.organizationId).toBeNull();

      // And nobody was notified, because there is nobody to notify.
      expect(
        jetstreamPublish.mock.calls.filter(([, command]) =>
          String((command as { eventId?: string }).eventId ?? '').startsWith(
            'dunning:',
          ),
        ),
      ).toHaveLength(0);
    });

    it('4. Records NOTHING for a tampered payload', async () => {
      // A `billing_events` row means "we believed this and acted on it".
      // Recording unverified events would turn the table into a log of things
      // anyone could have sent us — which is exactly what makes it useless
      // during an incident.
      await subscribedOrganization('cus_tampered');

      const { payload, signature } = signedEvent(
        subscriptionEvent({ customerId: 'cus_tampered' }),
      );
      const tampered = Buffer.from(
        payload.toString('utf8').replace(PRO, STARTER),
        'utf8',
      );

      await expectRpc(
        writer.handle(tampered, signature),
        status.INVALID_ARGUMENT,
      );

      await expect(fx.prisma.billingEvent.count()).resolves.toBe(0);
    });

    it('4b. Records nothing for a MISSING signature either', async () => {
      const { payload } = signedEvent(
        subscriptionEvent({ customerId: 'cus_nosig' }),
      );

      await expectRpc(writer.handle(payload, ''), status.INVALID_ARGUMENT);

      await expect(fx.prisma.billingEvent.count()).resolves.toBe(0);
    });

    it('6. Records FAILED and changes NOTHING for an unknown price id', async () => {
      // **Fail closed.** Defaulting to the free tier would downgrade a paying
      // customer on a config typo — one price created in the Stripe dashboard
      // and not added to the catalog, and their seat limit drops with no error
      // anywhere.
      const organization = await subscribedOrganization('cus_unknown_price');
      const before = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: organization.id },
      });

      const outcome = await deliver(
        subscriptionEvent({
          customerId: 'cus_unknown_price',
          priceId: 'price_typo_that_does_not_exist',
        }),
      );

      expect(outcome.status).toBe(BillingEventStatus.FAILED);

      const after = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: organization.id },
      });
      expect(after.maxAgentSeats).toBe(before.maxAgentSeats);
      expect(after.aiModelTier).toBe(before.aiModelTier);

      // Recorded with a reason, so a replay is possible once the catalog is
      // fixed rather than the event being lost.
      const row = await fx.prisma.billingEvent.findFirstOrThrow({
        where: { organizationId: organization.id },
      });
      expect(row.status).toBe(BillingEventStatus.FAILED);
      expect(row.errorLog).toContain('price_typo_that_does_not_exist');
    });

    it('7. Stores organization_id = NULL for an unknown customer and ACKs', async () => {
      // Checkout can complete before onboarding does, so an unresolvable
      // customer is a timing artefact rather than an error — and dropping the
      // event loses money, because nothing else will ever tell us that
      // subscription exists.
      const outcome = await deliver(
        subscriptionEvent({ customerId: 'cus_nobody_has_this' }),
      );

      expect(outcome.status).toBe(BillingEventStatus.PROCESSED);

      const row = await fx.prisma.billingEvent.findFirstOrThrow();
      expect(row.organizationId).toBeNull();
      expect(row.payload).toBeDefined();
    });

    it('8. Maps past_due → SUSPENDED_PAST_DUE, and a later active back to ACTIVE', async () => {
      // The lifecycle enum was designed before billing existed and maps onto
      // Stripe's statuses without modification (RDM §1.15) — the lifecycle gate is the
      // enforcement mechanism billing needed most and did not have to be built.
      const organization = await subscribedOrganization('cus_lifecycle');
      const now = new Date();

      await deliver(
        subscriptionEvent({
          customerId: 'cus_lifecycle',
          subscriptionStatus: 'past_due',
          createdAt: now,
        }),
      );

      await expect(
        fx.prisma.organization
          .findUniqueOrThrow({ where: { id: organization.id } })
          .then((row) => row.status),
      ).resolves.toBe(OrgStatus.SUSPENDED_PAST_DUE);

      await deliver(
        subscriptionEvent({
          customerId: 'cus_lifecycle',
          subscriptionStatus: 'active',
          createdAt: new Date(now.getTime() + 60_000),
        }),
      );

      await expect(
        fx.prisma.organization
          .findUniqueOrThrow({ where: { id: organization.id } })
          .then((row) => row.status),
      ).resolves.toBe(OrgStatus.ACTIVE);
    });

    it('9. Reaches its handler while the tenant is FROZEN', async () => {
      // The webhook bypass, proven. The gate reads `organizations.status` and this
      // endpoint's job is to WRITE it — so gating on it would make suspension a
      // one-way door: a frozen tenant whose payment succeeds could never
      // receive the event that reactivates them.
      const organization = await createOrganization(fx.prisma, {
        stripeCustomerId: 'cus_frozen',
        status: OrgStatus.FROZEN,
      });

      const outcome = await deliver(
        subscriptionEvent({
          customerId: 'cus_frozen',
          subscriptionStatus: 'active',
        }),
      );

      expect(outcome.status).toBe(BillingEventStatus.PROCESSED);
      await expect(
        fx.prisma.organization
          .findUniqueOrThrow({ where: { id: organization.id } })
          .then((row) => row.status),
      ).resolves.toBe(OrgStatus.ACTIVE);
    });

    it('9b. Treats a DELETED subscription as terminal regardless of its status field', async () => {
      const organization = await subscribedOrganization('cus_cancelled');

      await deliver(
        subscriptionEvent({
          customerId: 'cus_cancelled',
          type: 'customer.subscription.deleted',
          // Deliberately NOT `canceled` — reading the event TYPE means a future
          // status value cannot silently leave a cancelled tenant ACTIVE.
          subscriptionStatus: 'active',
        }),
      );

      await expect(
        fx.prisma.organization
          .findUniqueOrThrow({ where: { id: organization.id } })
          .then((row) => row.status),
      ).resolves.toBe(OrgStatus.FROZEN);
    });

    it('10. Emits billing.entitlements_changed AFTER a successful write', async () => {
      // A stale settings cache keeps a downgraded tenant on the premium model
      // for the whole TTL — the system giving away the exact thing it just
      // stopped being paid for.
      const organization = await subscribedOrganization('cus_emit');

      await deliver(subscriptionEvent({ customerId: 'cus_emit' }));

      expect(publishEntitlementsChanged).toHaveBeenCalledWith(
        organization.id,
        // The Stripe event id, carried through as the change id — see test 12.
        expect.any(String),
      );
    });

    it('12. Publishes a plan-changed notice ONLY when a grant actually moved', async () => {
      // Stripe sends `customer.subscription.updated` for a card change, a
      // `cancel_at_period_end` toggle, a quantity edit and every renewal. A
      // notice on each one says "the limits on your workspace have changed"
      // when nothing did — which is how a useful notice becomes one people
      // filter. The cache invalidation stays unconditional; only the tenant
      // notice is gated.
      const organization = await subscribedOrganization('cus_same_grants');

      // First event: no plan on the row yet, so every grant moves.
      await deliver(subscriptionEvent({ customerId: 'cus_same_grants' }));

      const planChangedOf = () =>
        jetstreamPublish.mock.calls.filter(([, command]) =>
          String((command as { eventId?: string }).eventId ?? '').startsWith(
            'plan-changed:',
          ),
        );

      expect(planChangedOf()).toHaveLength(1);
      const [, first] = planChangedOf()[0] as [
        string,
        { organizationId: string; eventId: string },
      ];
      expect(first.organizationId).toBe(organization.id);

      jetstreamPublish.mockClear();

      // Second event: same price, same grants. A renewal.
      await deliver(subscriptionEvent({ customerId: 'cus_same_grants' }));

      // The cache still gets invalidated — cheap, and a consumer refreshing
      // from an unchanged row is harmless.
      expect(publishEntitlementsChanged).toHaveBeenCalled();
      // The tenant does not get told twice about one plan.
      expect(planChangedOf()).toHaveLength(0);
    });

    it('12b. …and the notice’s id comes from the Stripe event, not the clock', async () => {
      // `new Date().toISOString()` at publish time is what
      // `limitThresholdEventId`'s docblock forbids two files away: a redelivery
      // of one logical change mints a second id, and Domain E's constraint has
      // nothing to collapse on. The event id is what the change OWNS.
      await subscribedOrganization('cus_derived_id');
      const event = subscriptionEvent({ customerId: 'cus_derived_id' });

      await deliver(event);

      const [, command, messageId] = jetstreamPublish.mock.calls.find(
        ([, payload]) =>
          String((payload as { eventId?: string }).eventId ?? '').startsWith(
            'plan-changed:',
          ),
      ) as [string, { eventId: string }, string];

      expect(command.eventId).toContain(String(event.id));
      expect(messageId).toBe(command.eventId);
    });

    it('10b. Emits NOTHING when the write was skipped or failed', async () => {
      // An invalidation with no change behind it is a cache stampede for free.
      await subscribedOrganization('cus_no_emit');

      await deliver(
        subscriptionEvent({
          customerId: 'cus_no_emit',
          priceId: 'price_unknown',
        }),
      );

      expect(publishEntitlementsChanged).not.toHaveBeenCalled();
    });

    it('11. Sets billing_cycle_start from Stripe’s current_period_start', async () => {
      // Load-bearing beyond its own column: the epoch is inside the Redis quota
      // key, so this line also re-arms every threshold alert and zeroes the
      // counter — correct at a renewal, and the reason the manual reset
      // endpoint is now break-glass.
      const organization = await subscribedOrganization('cus_cycle');
      const periodStart = new Date('2026-09-01T00:00:00.000Z');

      await deliver(
        subscriptionEvent({ customerId: 'cus_cycle', periodStart }),
      );

      const updated = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: organization.id },
      });
      expect(updated.billingCycleStart.toISOString()).toBe(
        periodStart.toISOString(),
      );
    });

    it('12. Ignores an event type that carries no entitlements', async () => {
      // Stripe sends dozens of types. Acting on the wrong one — `invoice.paid`,
      // say — would apply entitlements from an object that does not describe a
      // plan.
      const organization = await subscribedOrganization('cus_other');
      const before = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: organization.id },
      });

      await deliver(
        subscriptionEvent({
          customerId: 'cus_other',
          type: 'invoice.payment_succeeded',
        }),
      );

      const after = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: organization.id },
      });
      expect(after.maxAgentSeats).toBe(before.maxAgentSeats);
      // Recorded anyway, so "did we ever receive X" stays answerable.
      await expect(fx.prisma.billingEvent.count()).resolves.toBe(1);
    });
  });

  // ------------------------------------------------------- /billing/*

  describe('/billing', () => {
    it('2. Reads Postgres and makes ZERO Stripe calls', async () => {
      // A dashboard that fans out to a third party on every load fails when
      // they do — and this is the page a customer opens when something is
      // already wrong.
      const organization = await subscribedOrganization('cus_read');
      const apiSpy = faults.spy(stripe, 'api', 'get');

      const response = await billing.getSubscription(
        memberContext({ id: 'u', organizationId: organization.id }),
      );

      expect(apiSpy).not.toHaveBeenCalled();
      expect(response.stripeCustomerId).toBe('cus_read');
      expect(response.maxAgentSeats).toBe(organization.maxAgentSeats);
    });

    it('4. Answers coherently for a tenant with NO stripe_customer_id', async () => {
      // The grandfathered case again — and on the day this ships it is every
      // tenant, so a 500 here takes the billing page down for all of them.
      const organization = await createOrganization(fx.prisma);

      const response = await billing.getSubscription(
        memberContext({ id: 'u', organizationId: organization.id }),
      );

      expect(response.stripeCustomerId).toBeUndefined();
      expect(response.stripeSubscriptionId).toBeUndefined();
      expect(response.planName).toBe('Free');
      // The entitlements are still real — they were set by hand and no webhook
      // will ever overwrite them.
      expect(response.maxAgentSeats).toBe(organization.maxAgentSeats);
    });

    it('4b. Returns an EMPTY invoice list rather than failing, with no customer', async () => {
      const organization = await createOrganization(fx.prisma);

      await expect(
        billing.listInvoices(
          { limit: 10 },
          memberContext({ id: 'u', organizationId: organization.id }),
        ),
      ).resolves.toEqual({ items: [] });
    });

    it('4c. Refuses a portal session for a tenant with no billing account', async () => {
      // FAILED_PRECONDITION → 400. Minting a customer just to show an empty
      // portal would create a Stripe object for someone who has never paid.
      const organization = await createOrganization(fx.prisma);

      await expectRpc(
        billing.createPortalSession(
          { returnUrl: 'https://app.test/settings' },
          memberContext({ id: 'u', organizationId: organization.id }),
        ),
        status.FAILED_PRECONDITION,
      );
    });

    /**
     * The portal is the one surface that can change a plan without passing
     * `POST /billing/plan`, so which CONFIGURATION a session opens with is a
     * correctness question, not a cosmetic one (known-gaps #20).
     *
     * Stubbed on the RESOLVED provider, not the class — `api` is an instance
     * getter, and `jest.spyOn(StripeService, …)` finds no such property.
     */
    describe('the portal configuration', () => {
      // The cache is PROCESS-lifetime by design — there is one Stripe account
      // and no invalidation hook, so a resolved configuration outlives any
      // single request and, here, any single test. Cleared per test so each one
      // states its own starting point; test 8 is the one that leaves it alone
      // and asserts the caching.
      beforeEach(() => {
        (billing as unknown as { portalCache?: unknown }).portalCache =
          undefined;
      });

      const marked = (overrides = {}) => ({
        id: 'bpc_marked',
        metadata: { [STRIPE_PORTAL_MARKER]: 'v1' },
        features: { subscription_update: { enabled: false } },
        ...overrides,
      });

      const stubPortal = (configurations: unknown[]) => {
        const list = jest.fn().mockResolvedValue({ data: configurations });
        const create = jest
          .fn()
          .mockResolvedValue({ url: 'https://portal.test/s' });

        jest
          .spyOn(fx.moduleRef.get(StripeService), 'api', 'get')
          .mockReturnValue({
            billingPortal: { configurations: { list }, sessions: { create } },
          } as never);

        return { list, create };
      };

      const openPortal = async (organizationId: string) =>
        billing.createPortalSession(
          { returnUrl: 'https://app.test/settings' },
          memberContext({ id: 'u', organizationId }),
        );

      it('**5. Opens with the MARKED configuration, not the first one**', async () => {
        // An unmarked configuration is one anybody could have made in the
        // Dashboard, and Stripe would use the account default if none were
        // passed. Ordering it first is the case that catches "took [0]".
        const organization = await subscribedOrganization('cus_portal_marked');
        const { create } = stubPortal([
          { id: 'bpc_someone_elses', metadata: {}, features: {} },
          marked(),
        ]);

        await expect(openPortal(organization.id)).resolves.toEqual({
          url: 'https://portal.test/s',
        });

        expect(create).toHaveBeenCalledWith(
          expect.objectContaining({ configuration: 'bpc_marked' }),
        );
      });

      it('**6. REFUSES when the marked configuration allows plan changes**', async () => {
        // The flip the row is about. A plan change made in the portal arrives
        // as `customer.subscription.updated` AFTER Stripe applied it, so the
        // over-limit block never runs — refusing to open beats opening a portal
        // that can bypass it.
        const organization = await subscribedOrganization('cus_portal_flipped');
        const { create } = stubPortal([
          marked({ features: { subscription_update: { enabled: true } } }),
        ]);

        await expectRpc(
          openPortal(organization.id),
          status.FAILED_PRECONDITION,
        );
        expect(create).not.toHaveBeenCalled();
      });

      it('7. REFUSES when nothing carries the marker', async () => {
        // Not provisioned. Opening with the account default is exactly the
        // second-configuration hole, so this refuses and names the script.
        const organization = await subscribedOrganization('cus_portal_bare');
        const { create } = stubPortal([
          { id: 'bpc_unmarked', metadata: {}, features: {} },
        ]);

        await expectRpc(
          openPortal(organization.id),
          status.FAILED_PRECONDITION,
        );
        expect(create).not.toHaveBeenCalled();
      });

      it('8. Resolves the configuration ONCE across two opens', async () => {
        // The cache. A portal open is rare, but the thing being checked changes
        // on the timescale of a deploy — see `PORTAL_CONFIGURATION_TTL_MS`.
        const organization = await subscribedOrganization('cus_portal_cached');
        const { list, create } = stubPortal([marked()]);

        await openPortal(organization.id);
        await openPortal(organization.id);

        expect(create).toHaveBeenCalledTimes(2);
        expect(list).toHaveBeenCalledTimes(1);
      });
    });

    it('1. Rejects a checkout for a price the WEBHOOK could not map', async () => {
      // Validated before Stripe is called: a price the webhook cannot map is a
      // price that would take payment and then grant nothing — the customer
      // pays and stays on the old plan.
      const organization = await subscribedOrganization('cus_checkout');

      await expectRpc(
        billing.createCheckoutSession(
          {
            priceId: 'price_not_in_the_catalog',
            successUrl: 'https://app.test/ok',
            cancelUrl: 'https://app.test/no',
          },
          memberContext({ id: 'u', organizationId: organization.id }),
        ),
        status.INVALID_ARGUMENT,
      );
    });

    it('1b. Writes NO entitlement change while creating a checkout session', async () => {
      // The confirmation-before-grant rule. Stripe is unconfigured in this
      // suite, so the call fails at the SDK — and the assertion that matters is
      // that the organization row is untouched either way.
      const organization = await subscribedOrganization('cus_nograntyet');
      const before = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: organization.id },
      });

      await billing
        .createCheckoutSession(
          {
            priceId: PRO,
            successUrl: 'https://app.test/ok',
            cancelUrl: 'https://app.test/no',
          },
          memberContext({ id: 'u', organizationId: organization.id }),
        )
        .catch(() => undefined);

      const after = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: organization.id },
      });
      expect(after.maxAgentSeats).toBe(before.maxAgentSeats);
      expect(after.aiModelTier).toBe(before.aiModelTier);
      expect(after.stripeSubscriptionId).toBe(before.stripeSubscriptionId);
    });

    it('3. Cannot reach another tenant’s billing', async () => {
      // The isolation sweep instance. The tenant comes from the verified
      // context and never from the request, so there is no id to tamper with —
      // this asserts that property rather than a filter.
      const mine = await subscribedOrganization('cus_mine');
      await subscribedOrganization('cus_theirs');

      const response = await billing.getSubscription(
        memberContext({ id: 'u', organizationId: mine.id }),
      );

      expect(response.stripeCustomerId).toBe('cus_mine');
    });
  });

  // ------------------ what changes in already-shipped Domain A code

  describe('The meaning changes', () => {
    it('1. REFUSES a billing-cycle reset with no reason', async () => {
      // The endpoint used to be routine. It now desynchronizes the quota window
      // from the Stripe invoice period AND grants a fresh AI budget, neither of
      // which appears in the response — so the audit row is the only record,
      // and a row saying "reset by an operator" answers no question anyone will
      // actually have.
      const organization = await createOrganization(fx.prisma);

      await expectRpc(
        platform.resetBillingCycle(
          { organizationId: organization.id, reason: '   ' },
          superAdminContext(SUPER_ADMIN_ID),
        ),
        status.INVALID_ARGUMENT,
      );
    });

    it('1b. Writes an audit row carrying the reason when one is given', async () => {
      const organization = await createOrganization(fx.prisma, {
        billingCycleStart: new Date('2020-01-01T00:00:00.000Z'),
      });

      await platform.resetBillingCycle(
        {
          organizationId: organization.id,
          reason: 'make-good after the outage',
        },
        superAdminContext(SUPER_ADMIN_ID),
      );

      expect(auditRecord).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          metadata: expect.objectContaining({
            reason: 'make-good after the outage',
          }),
        }),
      );
    });

    it('3. Rolling the cycle moves the window that AI spend is measured from', async () => {
      // Already true via the cycle-in-the-key design; asserted now that a
      // SECOND thing writes that column. The Redis counter keys on the cycle
      // epoch, so a new cycle is a new key and the old spend simply stops
      // being read.
      const organization = await createOrganization(fx.prisma, {
        billingCycleStart: new Date('2020-01-01T00:00:00.000Z'),
      });

      await platform.resetBillingCycle(
        { organizationId: organization.id, reason: 'incident' },
        superAdminContext(SUPER_ADMIN_ID),
      );

      const after = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: organization.id },
      });
      expect(after.billingCycleStart.getTime()).toBeGreaterThan(
        new Date('2020-01-01T00:00:00.000Z').getTime(),
      );
    });

    it('2. A manual quota PATCH is REVERTED by the next subscription.updated', async () => {
      // Documents the override's lifetime rather than leaving someone to
      // discover it. Correct for a support gesture — "an extra 5 GB while we
      // sort this out" — and wrong as a way to sell an upgrade.
      const organization = await subscribedOrganization('cus_override');

      await platform.updateOrganization(
        { organizationId: organization.id, maxAgentSeats: 999 },
        superAdminContext(SUPER_ADMIN_ID),
      );

      await expect(
        fx.prisma.organization
          .findUniqueOrThrow({ where: { id: organization.id } })
          .then((row) => row.maxAgentSeats),
      ).resolves.toBe(999);

      await deliver(
        subscriptionEvent({ customerId: 'cus_override', priceId: PRO }),
      );

      // Back to what Stripe says. The override survived exactly until the next
      // webhook, with no notice to whoever set it.
      await expect(
        fx.prisma.organization
          .findUniqueOrThrow({ where: { id: organization.id } })
          .then((row) => row.maxAgentSeats),
      ).resolves.toBe(planForPrice(PRO).maxAgentSeats);
    });
  });

  // ------------------------ what Domain A exposes for the tier

  describe('Entitlements over gRPC', () => {
    it('1. Answers the tier AND the quota columns in ONE call', async () => {
      // Both spending services need both, and neither may read postgres_auth
      // (RDM §1.13). A second round trip for the tier would put two calls on
      // the cache-fill path of every AI request.
      const organization = await subscribedOrganization('cus_entitlements');
      await deliver(
        subscriptionEvent({ customerId: 'cus_entitlements', priceId: PRO }),
      );

      const entitlements = await organizations.getOrganizationEntitlements(
        memberContext({ id: 'u', organizationId: organization.id }),
      );

      const plan = planForPrice(PRO);
      expect(entitlements.maxAgentSeats).toBe(plan.maxAgentSeats);
      expect(Number(entitlements.monthlyAiTokenBudget)).toBe(
        Number(plan.monthlyAiTokenBudget),
      );
      expect(fromProtoAiModelTier(entitlements.aiModelTier)).toBe(
        plan.aiModelTier,
      );
      expect(entitlements.billingCycleStart).toBeDefined();
    });

    it('2. Carries the cycle start the QUOTA KEY is built from', async () => {
      // Its epoch is inside `quota:{org}:{cycle}`. A caller reading a different
      // value from this one would meter into a key nothing else reads, and the
      // tenant would appear to have spent nothing.
      const periodStart = new Date('2026-09-01T00:00:00.000Z');
      const organization = await subscribedOrganization('cus_cycle_rpc');
      await deliver(
        subscriptionEvent({ customerId: 'cus_cycle_rpc', periodStart }),
      );

      const entitlements = await organizations.getOrganizationEntitlements(
        memberContext({ id: 'u', organizationId: organization.id }),
      );

      expect(
        new Date(
          Number(entitlements.billingCycleStart!.seconds) * 1000,
        ).toISOString(),
      ).toBe(periodStart.toISOString());
    });

    it('3. Answers FAST for a GRANDFATHERED tenant rather than failing', async () => {
      // Every tenant looks like this on the day billing ships, and the AI path
      // must keep working for all of them.
      const organization = await createOrganization(fx.prisma);

      const entitlements = await organizations.getOrganizationEntitlements(
        memberContext({ id: 'u', organizationId: organization.id }),
      );

      expect(fromProtoAiModelTier(entitlements.aiModelTier)).toBe('FAST');
    });

    it('4. Puts the PLAN beside the meters on the usage page', async () => {
      // This becomes the page a customer opens when they hit a limit, and a
      // limit with no plan next to it is a number they cannot act on.
      const organization = await subscribedOrganization('cus_usage');
      await deliver(
        subscriptionEvent({ customerId: 'cus_usage', priceId: PRO }),
      );

      const usage = await organizations.getOrganizationUsage(
        memberContext({ id: 'u', organizationId: organization.id }),
      );

      expect(fromProtoAiModelTier(usage.aiModelTier)).toBe('QUALITY');
      expect(usage.planName).toBe(planForPrice(PRO).name);
    });

    it('4b. Labels a grandfathered tenant "Free" rather than by its tier', async () => {
      const organization = await createOrganization(fx.prisma);

      const usage = await organizations.getOrganizationUsage(
        memberContext({ id: 'u', organizationId: organization.id }),
      );

      expect(usage.planName).toBe('Free');
    });
  });
});
