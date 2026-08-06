import { Injectable, Logger } from '@nestjs/common';
import type Stripe from 'stripe';
import {
  BillingEventStatus,
  entitlementsForPrice,
  formatErrorMsg,
  isUniqueConstraintViolation,
  OrgStatus,
  PlanEntitlements,
  STRIPE_STATUS_TO_ORG_STATUS,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { BillingEventPublisher } from './billing-event.publisher';
import { StripeService } from './stripe.service';

/** What the writer decided, for the response and for the tests. */
export type WriteOutcome = {
  status: BillingEventStatus;
  billingEventId?: string;
};

/**
 * The whole integration is this class. Everything else is plumbing.
 *
 * ```txt
 * customer.subscription.created | updated | deleted
 *   ├─ verify signature (raw body)                    → 400, nothing recorded
 *   ├─ INSERT billing_events (stripe_event_id UNIQUE) → duplicate? ACK, stop
 *   ├─ resolve org by stripe_customer_id              → unresolved? org=NULL, ACK
 *   ├─ newer than the last applied for this sub?      → no? SKIPPED_STALE, ACK
 *   ├─ map price id → entitlements                    → unknown? FAILED, alert
 *   ├─ UPDATE organizations SET <5 entitlements>
 *   ├─ map subscription.status → organizations.status
 *   └─ emit billing.entitlements_changed
 * ```
 *
 * **Webhooks are at-least-once and arrive out of order.** The two guards below
 * are not defensive extras — they are the normal operating conditions of the
 * transport, and the second one is the one that bites.
 */
@Injectable()
export class EntitlementWriterService {
  private readonly logger = new Logger(EntitlementWriterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly events: BillingEventPublisher,
  ) {}

  /**
   * Verifies, records, and applies — in that order.
   *
   * **Signature verification happens before `billing_events`.** A row there
   * means "we believed this and acted on it", which is what makes the table
   * useful during an incident; recording unverified events would turn it into
   * a log of things anyone could have sent us.
   */
  async handle(payload: Buffer, signature: string): Promise<WriteOutcome> {
    // Throws on a bad signature. The caller maps it to 400 and NOTHING is
    // recorded — the event never reaches the table.
    const event = this.stripe.constructEvent(payload, signature);

    // **The INSERT comes FIRST, before any work.** That ordering IS the
    // idempotency mechanism: the UNIQUE constraint claims the event id before
    // anything is applied, so a redelivery loses the race in Postgres rather
    // than re-running the entitlement write.
    //
    // Doing the work first and recording afterwards — the obvious order —
    // leaves the constraint catching the second ROW while the second WRITE has
    // already happened. That is harmless only while the mapping stays
    // idempotent, and stops being harmless the day anything becomes
    // incremental (a credit top-up, a proration). It is also what a redelivery
    // does routinely, since Stripe retries any non-2xx including a timeout on
    // a request that actually succeeded.
    const claim = await this.claim(event);
    if (!claim) {
      this.logger.log(`Stripe event ${event.id} was already processed`);
      return { status: BillingEventStatus.SKIPPED_DUPLICATE };
    }

    if (!HANDLED_EVENT_TYPES.has(event.type)) {
      // Recorded but not acted on. Stripe sends far more than this system
      // cares about, and storing them costs a row while making "did we ever
      // receive X" answerable during an incident.
      return { status: BillingEventStatus.PROCESSED, billingEventId: claim };
    }

    const subscription = event.data.object as Stripe.Subscription;
    const customerId = customerIdOf(subscription);

    const organization = customerId
      ? await this.prisma.organization.findUnique({
          where: { stripeCustomerId: customerId },
          select: { id: true },
        })
      : null;

    if (!organization) {
      // **Left with `organization_id = NULL`, not dropped.** Checkout can
      // complete before onboarding does, so an unresolvable customer is a
      // timing artefact rather than an error — and losing the event loses
      // money, because nothing else will ever tell us that subscription
      // exists.
      this.logger.warn(
        `Stripe event ${event.id} names customer ${customerId ?? '(none)'}, which resolves to no tenant`,
      );
      return { status: BillingEventStatus.PROCESSED, billingEventId: claim };
    }

    if (await this.isStale(organization.id, event, claim)) {
      // **The guard that bites.** A delayed `subscription.updated` carrying
      // yesterday's Starter plan can land AFTER today's upgrade to Pro and
      // silently downgrade a paying tenant. Nothing errors; they notice days
      // later when their seat limit stops matching what they bought, and the
      // audit trail shows a successful webhook doing exactly what it was told.
      this.logger.log(
        `Skipping stale Stripe event ${event.id} for organization ${organization.id}`,
      );
      return this.settle(
        claim,
        organization.id,
        BillingEventStatus.SKIPPED_STALE,
      );
    }

    const entitlements = entitlementsForPrice(
      this.stripe.planCatalog,
      priceIdOf(subscription),
    );

    if (!entitlements) {
      // **Fail CLOSED.** Defaulting an unknown price to the free tier
      // downgrades a paying customer on a config typo — one price created in
      // the Stripe dashboard and not added to the catalog, and their seat
      // limit drops with no error anywhere. A FAILED row and an alert means a
      // human fixes a config line instead.
      const message = `No entitlements mapped for price '${priceIdOf(subscription) ?? '(none)'}'`;
      this.logger.error(`${message} (event ${event.id})`);

      return this.settle(
        claim,
        organization.id,
        BillingEventStatus.FAILED,
        message,
      );
    }

    await this.apply(organization.id, subscription, entitlements, event.type);

    const outcome = await this.settle(
      claim,
      organization.id,
      BillingEventStatus.PROCESSED,
    );

    // AFTER the write, never before. An invalidation that arrived first would
    // refill the cache from the OLD row — leaving a downgraded tenant on the
    // premium model for the whole TTL, which is precisely the failure the
    // event exists to prevent.
    this.events.publishEntitlementsChanged(organization.id);

    return outcome;
  }

  /**
   * The five entitlement columns, the cycle, and the lifecycle status.
   *
   * One transaction, because a partial apply is a tenant whose seat limit came
   * from the new plan and whose AI budget came from the old one — a state no
   * plan grants and nothing would ever reconcile.
   */
  private async apply(
    organizationId: string,
    subscription: Stripe.Subscription,
    entitlements: PlanEntitlements,
    eventType: string,
  ): Promise<void> {
    const cycleStart = periodStartOf(subscription);
    const status = this.lifecycleStatusFor(subscription, eventType);

    await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        maxAgentSeats: entitlements.maxAgentSeats,
        maxStorageBytes: entitlements.maxStorageBytes,
        monthlyAiTokenBudget: entitlements.monthlyAiTokenBudget,
        aiModelTier: entitlements.aiModelTier,
        stripeSubscriptionId: subscription.id,
        // **The cycle follows Stripe**, and its epoch is inside the Redis
        // quota key — so this line also re-arms every threshold alert and
        // zeroes the counter. That is correct at a renewal and is why the
        // manual reset endpoint is now break-glass.
        ...(cycleStart ? { billingCycleStart: cycleStart } : {}),
        ...(status ? { status } : {}),
      },
    });
  }

  /**
   * Stripe's subscription status → the tenant lifecycle enum.
   *
   * The enum was designed before billing existed and maps onto Stripe's
   * statuses without modification (RDM §1.15) — §0.4's lifecycle gate is the
   * enforcement mechanism billing needed most and did not have to be built.
   *
   * Returns undefined for a status with no mapping (`incomplete`, mid-checkout)
   * so the caller leaves whatever the tenant already had, rather than inventing
   * a transition out of a state that has not resolved yet.
   */
  private lifecycleStatusFor(
    subscription: Stripe.Subscription,
    eventType: string,
  ): string | undefined {
    if (eventType === 'customer.subscription.deleted') {
      // Deletion is terminal regardless of the status the object carries —
      // Stripe reports a cancelled subscription's status as `canceled`, but
      // reading the event type directly means a future status value cannot
      // silently leave a cancelled tenant ACTIVE.
      return OrgStatus.FROZEN;
    }

    return STRIPE_STATUS_TO_ORG_STATUS[subscription.status];
  }

  /**
   * Whether a NEWER event has already been applied for this tenant.
   *
   * Compared against the newest PROCESSED row rather than the newest row of any
   * status: a `SKIPPED_STALE` row is by definition older than what was applied,
   * and a `FAILED` one changed nothing — treating either as the high-water mark
   * would let one bad event block every later one.
   *
   * `excludeId` is the row this very call just claimed. Without it the check
   * would find itself — the claim is written as PROCESSED — and every event
   * would compare equal to its own timestamp.
   */
  private async isStale(
    organizationId: string,
    event: Stripe.Event,
    excludeId: string,
  ): Promise<boolean> {
    const newest = await this.prisma.billingEvent.findFirst({
      where: {
        organizationId,
        status: BillingEventStatus.PROCESSED,
        id: { not: excludeId },
      },
      orderBy: { stripeCreatedAt: 'desc' },
      select: { stripeCreatedAt: true },
    });
    if (!newest) return false;

    // Strictly older. Equal timestamps are NOT stale: Stripe's `created` is
    // second-granularity, so two events in the same second are ordinary, and
    // discarding the second would drop a real change.
    return stripeCreatedAt(event) < newest.stripeCreatedAt;
  }

  /**
   * Claims the event id, or returns null if Stripe already delivered it.
   *
   * **The UNIQUE constraint resolves the race, not a check-then-write** — two
   * concurrent deliveries of the same event both pass any application-level
   * check, and concurrent duplicates are the normal path rather than a rare
   * one. Postgres decides; this reads the decision.
   *
   * The row is claimed as PROCESSED and corrected by `settle` if the outcome
   * turns out to be otherwise. Provisional-then-corrected rather than
   * written-at-the-end, because a row written at the end is a row that does not
   * exist while the work is running — which is exactly the window a redelivery
   * arrives in.
   */
  private async claim(event: Stripe.Event): Promise<string | null> {
    try {
      const row = await this.prisma.billingEvent.create({
        data: {
          stripeEventId: event.id,
          organizationId: null,
          eventType: event.type,
          stripeCreatedAt: stripeCreatedAt(event),
          payload: event as unknown as Prisma.InputJsonValue,
          status: BillingEventStatus.PROCESSED,
        },
        select: { id: true },
      });

      return row.id;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) return null;

      // Not swallowed. A row that cannot be written means the guards are not
      // in force, and acknowledging would tell Stripe to stop retrying an
      // event nothing recorded.
      this.logger.error(
        `Could not record Stripe event ${event.id}: ${formatErrorMsg(error)}`,
      );
      throw error;
    }
  }

  /** Writes the resolved tenant and outcome onto the claimed row. */
  private async settle(
    billingEventId: string,
    organizationId: string | null,
    status: BillingEventStatus,
    errorLog?: string,
  ): Promise<WriteOutcome> {
    await this.prisma.billingEvent.update({
      where: { id: billingEventId },
      data: { organizationId, status, errorLog: errorLog ?? null },
    });

    return { status, billingEventId };
  }
}

/**
 * The event types that carry entitlements.
 *
 * Narrow on purpose. Stripe sends dozens of types and acting on the wrong one —
 * `invoice.paid`, say — would apply entitlements from an object that does not
 * describe a plan.
 */
const HANDLED_EVENT_TYPES = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

function stripeCreatedAt(event: Stripe.Event): Date {
  // Stripe's `created` is UNIX SECONDS. Reading it as milliseconds puts every
  // event in 1970, which makes the monotonic guard compare a real timestamp
  // against a fixed one and skip literally everything after the first.
  return new Date(event.created * 1000);
}

function customerIdOf(subscription: Stripe.Subscription): string | null {
  const customer = subscription.customer;

  // Expanded or not — Stripe returns either an id or the whole object
  // depending on how the event was configured, and a handler that assumed one
  // resolves no tenant for half the deployments.
  if (typeof customer === 'string') return customer;

  return customer?.id ?? null;
}

function priceIdOf(subscription: Stripe.Subscription): string | null {
  return subscription.items?.data?.[0]?.price?.id ?? null;
}

function periodStartOf(subscription: Stripe.Subscription): Date | null {
  // `current_period_start` moved onto the subscription ITEM in recent API
  // versions and remains on the subscription in older ones. Both are read, so
  // the integration does not silently stop tracking the cycle on an API
  // version bump — and a missing value leaves the column alone rather than
  // resetting the tenant's quota window to now.
  const raw =
    subscription.items?.data?.[0]?.current_period_start ??
    (subscription as unknown as { current_period_start?: number })
      .current_period_start;

  return typeof raw === 'number' ? new Date(raw * 1000) : null;
}
