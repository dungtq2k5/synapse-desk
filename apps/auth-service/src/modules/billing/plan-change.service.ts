import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import Stripe from 'stripe';
import {
  BillingEventSource,
  BillingEventStatus,
  formatErrorMsg,
  CallerContext,
  isUniqueConstraintViolation,
  requireActor,
  requireTenant,
} from '@synapsedesk/common';
import {
  toProtoAiModelTier,
  toProtoTimestamp,
  type ListTenantPlansResponse,
  type PlanChangePreviewResponse,
  type PlanChangeRequest,
  type PlanChangeResponse,
} from '@synapsedesk/grpc-proto';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { StripeService } from './stripe.service';

/**
 * A tenant moving between catalogue plans.
 *
 * **Split from `BillingService` deliberately**: that class answers "what am I
 * on" and hands out Stripe-hosted URLs, and this one is the only place in the
 * product that mutates a live subscription. They share a module and nothing
 * else.
 *
 * **This route exists because Stripe's portal cannot enforce the rule.** Stripe
 * recommends the Customer Portal for self-service plan changes, and
 * `scripts/provision-stripe.mjs` turns `subscription_update` off there for one
 * reason: a change made inside
 * Stripe's UI reaches this system only AFTER Stripe has applied it, which is
 * too late to refuse. The cost of that departure is recorded — the portal
 * setting is an enforcement point living outside this repo (known-gaps #20).
 *
 * **Two calls, and the split is a privilege boundary.** `preview` is everything
 * auth can decide alone; storage and document counts belong to
 * `ingestion-service` and auth cannot dial it — ingestion dials auth on every
 * presign, so the reverse edge closes a cycle on the identity leaf. The gateway
 * reads those from the TENANT-SCOPED usage RPC and refuses there.
 */
@Injectable()
export class PlanChangeService {
  private readonly logger = new Logger(PlanChangeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly organizations: OrganizationsService,
  ) {}

  /**
   * The plans a tenant may join.
   *
   * Filtered to `deletedAt: null` AND `isActive` — the same filter
   * {@link PlanChangeService.resolve} refuses on. **One definition of
   * joinable**, or the catalogue offers a plan the endpoint rejects and the
   * tenant reads a refusal as a bug.
   *
   * A retired plan stays readable for the tenants already on it (their
   * `GET /billing/subscription` still names it) and must not be joinable, which
   * is exactly the difference between reading a plan and listing one.
   */
  async listTenantPlans(
    context: CallerContext,
  ): Promise<ListTenantPlansResponse> {
    requireTenant(context);

    const plans = await this.prisma.subscriptionPlan.findMany({
      // **`prices: { some: {} }` is part of "joinable", not an optimization.**
      // The Free plan is seeded with `stripeProductId: null` and no prices at
      // all — it is assigned rather than sold. Listing it would offer a plan
      // the UI cannot put a price on and this endpoint must refuse, because
      // `changePlan` resolves the target through a price. A catalogue that
      // shows a plan the endpoint rejects is worse than one that omits it.
      where: { deletedAt: null, isActive: true, prices: { some: {} } },
      include: { prices: { orderBy: { interval: 'asc' } } },
      orderBy: { maxAgentSeats: 'asc' },
    });

    return {
      items: plans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        maxAgentSeats: plan.maxAgentSeats,
        maxStorageBytes: Number(plan.maxStorageBytes),
        monthlyAiTokenBudget: Number(plan.monthlyAiTokenBudget),
        aiModelTier: toProtoAiModelTier(plan.aiModelTier),
        maxDocumentBytes: Number(plan.maxDocumentBytes),
        maxAttachmentBytes: Number(plan.maxAttachmentBytes),
        maxDocumentUploads: plan.maxDocumentUploads,
        maxAnalyticsRangeDays: plan.maxAnalyticsRangeDays,
        prices: plan.prices.map((price) => ({
          stripePriceId: price.stripePriceId,
          interval: price.interval,
        })),
      })),
    };
  }

  /**
   * What auth can decide alone, for the gateway to finish.
   *
   * Runs every refusal and the seat check, then names the dimensions the
   * gateway still has to verify. **Reads nothing and writes nothing** — a
   * preview that mutated would be a plan change with a different name.
   */
  async previewPlanChange(
    request: PlanChangeRequest,
    context: CallerContext,
  ): Promise<PlanChangePreviewResponse> {
    const { organization, plan } = await this.resolve(request, context);

    return {
      overLimit: await this.seatOverruns(organization.id, plan.maxAgentSeats),
      narrowedDimensions: narrowedDimensions(organization, plan),
      // **Numbers off the row, never a rendered string.** The plan-apply
      // projection carries `"before -> after"` for display and the gateway's
      // composer parses it; reusing that here would make a formatting change
      // upstream turn this block into an allow, silently.
      targetMaxStorageBytes: Number(plan.maxStorageBytes),
      targetMaxDocumentUploads: plan.maxDocumentUploads,
      planName: plan.name,
    };
  }

  /**
   * Move the subscription, after the gateway's half of the block passed.
   *
   * **Every refusal runs again.** The preview happened a round trip ago and
   * this is the call that spends money — re-reading is one query against a
   * tenant who may have invited somebody in between. Storage and documents are
   * NOT re-checked here and cannot be: they are the gateway's half, and the
   * cycle above is why.
   *
   * **So there is a window, and it is not closable from here.** preview →
   * verify → change is three round trips, and a tenant who uploads between the
   * gateway's check and this call lands over the new limit. Accepted: the
   * window is milliseconds, the tenant keeps what they have (a limit gates
   * admission, never tenure), and the limit alert's level alarm crosses 100%
   * and tells them. What it is NOT is re-checkable here — reading storage from this
   * service is the edge that closes a cycle on the identity leaf.
   */
  async changePlan(
    request: PlanChangeRequest,
    context: CallerContext,
  ): Promise<PlanChangeResponse> {
    // An ASSERTION, not a value — it throws when the caller has no actor. Read
    // as a leftover otherwise, which is why it is voided rather than called
    // bare: a plan change is an act somebody is accountable for.
    void requireActor(context);

    const { organization, plan } = await this.resolve(request, context);

    const overLimit = await this.seatOverruns(
      organization.id,
      plan.maxAgentSeats,
    );
    if (overLimit.length > 0) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: `This plan does not fit your current usage — ${overLimit.join('; ')}`,
      });
    }

    const idempotencyKey = this.idempotencyKeyFor(organization.id, request);
    await this.claim(organization.id, idempotencyKey, request);

    const subscriptionId = organization.stripeSubscriptionId as string;

    try {
      // **The item id is mandatory.** Stripe's own guide: *"You must specify
      // the subscription item to replace the current price with the new price.
      // Failing to do so results in ADDING the new price so both prices are
      // active."* Nothing stores the item id, so the retrieve is a required
      // step rather than an optimization.
      //
      // The failure if it is skipped is silent at every hop: two active items,
      // the customer billed for both plans, and `priceIdOf` reading
      // `items.data[0].price.id` — the OLD price — so entitlements never move
      // and no error is raised anywhere.
      const subscription =
        await this.stripe.api.subscriptions.retrieve(subscriptionId);
      const itemId = subscription.items.data[0]?.id;

      if (!itemId) {
        throw new Error(
          `Stripe subscription ${subscriptionId} has no items to replace`,
        );
      }

      const updated = await this.stripe.api.subscriptions.update(
        subscriptionId,
        {
          items: [{ id: itemId, price: request.priceId }],
          // **Immediate in BOTH directions**, against Stripe's usual convention
          // of deferring downgrades to period end. A deferred downgrade means
          // the block has to run again, unattended, against a tenant who may
          // have grown — either a scheduled job silently cancels a change the
          // tenant was told was accepted, or it does not run and the block is a
          // formality that a month of ordinary usage defeats.
          //
          // `always_invoice` rather than the default `create_prorations`: the
          // default computes line items and leaves them for the next invoice,
          // so an upgrade grants now and collects later.
          proration_behavior: 'always_invoice',
          // **Quantity is deliberately not passed.** Stripe resets a changed
          // item's quantity to 1, which is correct here because this repo bills
          // per PLAN — seats are an entitlement column, not a Stripe quantity.
          // Anyone adding seat-based pricing has to pass it here.

          // Unrelated to the above: the proration invoice is what
          // `prorationCredited` reads, and without the expand it arrives as an
          // id string and the answer is "not determined" every time.
          expand: ['latest_invoice'],
        },
        // Stripe's own idempotency, and the guard that stops the second
        // invoice. Derived rather than generated — see `idempotencyKeyFor`.
        { idempotencyKey },
      );

      return {
        planId: plan.id,
        planName: plan.name,
        // Immediate, so the moment Stripe applied it is the moment the grants
        // change. The entitlement WRITE still happens on the webhook this call
        // causes, exactly as it does for checkout.
        effectiveAt: toProtoTimestamp(new Date()),
        creditIssued: prorationCredited(updated),
      };
    } catch (error) {
      if (error instanceof Stripe.errors.StripeError) {
        this.logger.error(
          `Stripe rejected a plan change for ${organization.id} (${error.type}): ${error.message}`,
        );

        throw new RpcException(planChangeFailure(error));
      }

      throw error;
    } finally {
      // **Released either way.** The claim is a lock on an in-flight attempt,
      // so the moment the attempt settles it has nothing left to say — and a
      // claim that outlives its request is a plan change nobody can retry: a
      // declined card left one behind permanently, and the no-header fallback
      // key is the plan tuple, which recurs the next time a tenant moves back.
      //
      // Deliberately NOT bounded by a date bucket instead. A bucket boundary is
      // a moment when this key and Stripe's roll together, so a double-submit
      // straddling midnight passes both guards and bills twice — rare,
      // timing-dependent and financial, which is the worst combination to
      // diagnose. Releasing has no boundary.
      await this.release(idempotencyKey);
    }
  }

  // ---------------------------------------------------------------- Internals

  /**
   * The four refusals, cheapest first, before Stripe is touched.
   *
   * Each answers a different question, and the order is the cost order: two
   * reads this request already needs, then a lookup, then a filter.
   */
  private async resolve(request: PlanChangeRequest, context: CallerContext) {
    const organizationId = requireTenant(context);

    const organization = await this.prisma.organization.findFirst({
      // Tenant-scoped by construction: the id is the verified caller's, never
      // the request's.
      where: { id: organizationId, deletedAt: null },
      select: {
        id: true,
        entitlementsPinned: true,
        stripeSubscriptionId: true,
        maxStorageBytes: true,
        maxDocumentUploads: true,
      },
    });

    if (!organization) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Organization not found',
      });
    }

    // 1 — nothing to change. Null for every grandfathered and Free tenant, who
    // are the majority: moving ONTO a plan is checkout, which already exists,
    // and a second checkout path started from here would be two ways to do one
    // thing with only one of them tested.
    if (!organization.stripeSubscriptionId) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message:
          'This workspace has no subscription to change — start one from checkout',
      });
    }

    // 2 — off-catalogue by deliberate policy. The webhook already refuses to
    // overwrite a pinned tenant (`SKIPPED_PINNED`); letting them self-serve
    // onto a catalogue plan would discard the negotiated grant through the
    // front door while the back door is bolted.
    if (organization.entitlementsPinned) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message:
          'This workspace is on a negotiated plan — contact support to change it',
      });
    }

    const price = await this.prisma.subscriptionPlanPrice.findUnique({
      where: { stripePriceId: request.priceId },
      include: { plan: true },
    });

    // 3 — the caller sends both ids and they must agree. Trusting `priceId`
    // alone would let a caller name Pro's plan and Starter's price; trusting
    // `planId` alone would charge them for a price the plan does not own.
    if (!price || price.planId !== request.planId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `'${request.priceId}' is not a price on that plan`,
      });
    }

    // 4 — the same filter `listTenantPlans` applies. A retired plan stays
    // readable for its existing subscribers and must not be joinable.
    if (price.plan.deletedAt !== null || !price.plan.isActive) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'That plan is no longer available',
      });
    }

    return { organization, plan: price.plan };
  }

  /**
   * Seat overruns, in the string shape the plan-apply projection already uses.
   *
   * `seatsInUse` and nothing local: the count that decides this refusal has to
   * be the count that refuses the tenant's next invitation, or a tenant is
   * blocked from a plan they would fit on — or worse, allowed onto one they
   * would not.
   */
  private async seatOverruns(
    organizationId: string,
    maxAgentSeats: number,
  ): Promise<string[]> {
    const seatsInUse = await this.organizations.seatsInUse(
      this.prisma,
      organizationId,
    );

    return seatsInUse > maxAgentSeats
      ? [`maxAgentSeats: ${seatsInUse} in use, plan grants ${maxAgentSeats}`]
      : [];
  }

  /**
   * The key Stripe deduplicates on.
   *
   * **Derived, never generated** — a generated key makes every retry a new
   * operation, which is the whole failure this guards: `always_invoice` means
   * a double-click, a proxy retry or a client retry-on-timeout is a second
   * proration invoice that looks legitimate at every layer.
   *
   * The caller's `Idempotency-Key` is preferred when present, because a plan
   * change is not idempotent the way a payment is: two identical requests a
   * month apart are two legitimate changes, and only the caller knows which is
   * which. Without a header the derived form still collapses a double-click,
   * and it cannot collapse next month's change — Stripe expires idempotency
   * keys after 24 hours.
   */
  private idempotencyKeyFor(
    organizationId: string,
    request: PlanChangeRequest,
  ): string {
    return request.idempotencyKey
      ? `plan-change:${organizationId}:${request.idempotencyKey}`
      : `plan-change:${organizationId}:${request.planId}:${request.priceId}`;
  }

  /**
   * Drops the lock. Never throws — the plan change has already settled.
   *
   * A failure here costs the next attempt a spurious `ALREADY_EXISTS` until
   * somebody clears the row, which is worth a warning and is not worth turning
   * a completed plan change into an error the caller cannot act on.
   */
  private async release(idempotencyKey: string): Promise<void> {
    try {
      await this.prisma.billingEvent.deleteMany({
        where: { stripeEventId: idempotencyKey },
      });
    } catch (error) {
      this.logger.warn(
        `Could not release the plan-change claim '${idempotencyKey}': ${formatErrorMsg(error)}`,
      );
    }
  }

  /**
   * A LOCK on an in-flight attempt, released either way — never a ledger entry.
   *
   * **The unique constraint does the work**, exactly as it does for a
   * redelivered webhook — the same mechanism from the other direction:
   * `billing_events` records events we CONSUMED, and this records a change we
   * are PRODUCING. A check-then-write would leave the window this is about wide
   * open.
   *
   * **`source: LOCAL` is load-bearing, not descriptive.** The monotonic
   * staleness guard takes the newest PROCESSED row as a tenant's high-water
   * mark; this row carries `now()` to the millisecond and Stripe's `created` is
   * whole seconds, so an untagged claim makes the webhook it causes look stale
   * and the entitlement write is skipped.
   *
   * **Released in a `finally`, which is what bounds its lifetime to the
   * request.** Its whole job is that a double-click does not reach Stripe
   * twice; everything past the in-flight window is Stripe's idempotency key's
   * job, and that key already has the right semantics — collapse for 24 hours,
   * then treat it as a new operation. Kept permanently it did the opposite: a
   * declined card left a claim nobody could clear, and the no-header fallback
   * key is the plan tuple, so Starter → Pro → Starter was refused forever on
   * the third step.
   *
   * A duplicate arriving AFTER release reaches Stripe and is collapsed by the
   * idempotency key into an idempotent success, which is the truer answer than
   * `ALREADY_EXISTS`: the change they asked for is in effect, once.
   *
   * **A duplicate that is refused does NOT release the lock**, and the ordering
   * is what guarantees it: this throws before the caller enters the `try`, so
   * the `finally` belongs to the attempt that took the lock and to no other. A
   * duplicate that cleared it would let a third request straight through.
   */
  private async claim(
    organizationId: string,
    idempotencyKey: string,
    request: PlanChangeRequest,
  ): Promise<void> {
    try {
      await this.prisma.billingEvent.create({
        data: {
          stripeEventId: idempotencyKey,
          organizationId,
          eventType: 'plan.change_requested',
          stripeCreatedAt: new Date(),
          source: BillingEventSource.LOCAL,
          payload: { planId: request.planId, priceId: request.priceId },
          status: BillingEventStatus.PROCESSED,
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new RpcException({
          code: status.ALREADY_EXISTS,
          message: 'That plan change has already been submitted',
        });
      }

      throw error;
    }
  }
}

/**
 * A Stripe error, as the failure the tenant can act on.
 *
 * **`StripeError` is the BASE class, and catching it wholesale says one thing
 * about four different situations.** Telling somebody their payment provider
 * refused them, when Stripe was simply unreachable, sends them to check a card
 * that is fine — the same distinction the plan-change gate draws for its usage
 * leg between *"we could not verify, try again"* and *"this does not fit"*,
 * applied to the other dependency.
 *
 * - **Connection and API errors are OUTAGES.** `UNAVAILABLE`, which the gateway
 *   renders as 503 — retryable, and true.
 * - **A rate limit is the same shape**, briefer, and equally not the caller's
 *   fault.
 * - **An idempotency error means the caller reused a key with different
 *   parameters.** That is a statement about their own request, not about their
 *   card.
 * - **Card and invalid-request errors are genuine refusals**, which is what the
 *   original message was written for.
 */
function planChangeFailure(error: Stripe.errors.StripeError): {
  code: number;
  message: string;
} {
  if (
    error instanceof Stripe.errors.StripeConnectionError ||
    error instanceof Stripe.errors.StripeAPIError ||
    error instanceof Stripe.errors.StripeRateLimitError
  ) {
    return {
      code: status.UNAVAILABLE,
      message:
        'Your payment provider could not be reached just now — please try again shortly',
    };
  }

  if (error instanceof Stripe.errors.StripeIdempotencyError) {
    return {
      code: status.ALREADY_EXISTS,
      message:
        'That Idempotency-Key was already used for a different plan change',
    };
  }

  return {
    code: status.FAILED_PRECONDITION,
    message: 'Your payment provider refused the plan change',
  };
}

/**
 * The dimensions where the target plan grants LESS than the tenant holds today.
 *
 * Only these are checked, and only these dial ingestion — a change that widens
 * everything is one Stripe round trip and cannot be blocked by an unrelated
 * outage.
 *
 * **Compared against the tenant's current GRANT, not their usage**, which has
 * one consequence worth naming: a tenant already over a limit — only reachable
 * by a Super Admin plan apply, since every enforcement point refuses additions
 * — can move to a wider-but-still-insufficient plan without being blocked. That
 * is the intended reading of "a limit gates admission, never tenure": this
 * block exists to stop a change that CREATES an overrun, and moving to a wider
 * plan strictly improves the position they were already in.
 *
 * That case is reachable ONLY through a Super Admin plan apply — every
 * enforcement point refuses additions — and such a tenant is already at 100% on
 * the level alarm, so they are not silent about it. This block simply is not
 * the mechanism that tells them.
 */
function narrowedDimensions(
  organization: { maxStorageBytes: bigint; maxDocumentUploads: number },
  plan: { maxStorageBytes: bigint; maxDocumentUploads: number },
): string[] {
  const narrowed: string[] = [];

  if (plan.maxStorageBytes < organization.maxStorageBytes) {
    narrowed.push('storage');
  }
  if (plan.maxDocumentUploads < organization.maxDocumentUploads) {
    narrowed.push('documents');
  }

  return narrowed;
}

/**
 * Whether the proration produced a CREDIT rather than a charge, or `undefined`
 * when that cannot be told from what Stripe returned.
 *
 * Stripe does not auto-refund a negative proration: a downgrade becomes a
 * credit against future invoices, and a client that does not say so is a
 * support ticket. Read from the invoice rather than inferred from the direction
 * of the change — inferring would be a guess dressed as a fact.
 *
 * **The reading itself is UNPROVEN, which is why the absent case exists.**
 * `always_invoice` does not guarantee the proration lands on `latest_invoice`:
 * Stripe may issue it as a customer credit balance transaction, in which case
 * this field points at the PREVIOUS invoice and a `false` here is wrong for a
 * change that did credit. The mirror is also available — a negative
 * `latest_invoice` on a straight upgrade would read `true`. Only a sandbox
 * downgrade against a real card settles which shape arrives, and nothing in
 * this repository can.
 *
 * So: an expanded invoice answers, and anything else answers "not determined"
 * rather than `false`. Turning this into a total function is an edit somebody
 * makes after the measurement, on purpose.
 */
function prorationCredited(
  subscription: Stripe.Subscription,
): boolean | undefined {
  const invoice = subscription.latest_invoice;

  if (typeof invoice !== 'object' || invoice === null) return undefined;

  return invoice.total < 0;
}
