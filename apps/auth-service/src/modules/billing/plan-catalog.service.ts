import { Injectable, Logger } from '@nestjs/common';
import { PlanEntitlements } from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * What a Stripe price GRANTS, read from `subscription_plans`.
 *
 * **Replaces the code catalogue entirely.** `DEFAULT_PLAN_CATALOG` and
 * `loadPlanCatalog` are gone rather than kept beside this: two sources
 * answering one question is what §12.3 and this repo's known-gaps history are
 * about, and the code one could only ever be right for the environment it was
 * compiled for.
 *
 * **No cache, and it needs none.** This runs once per webhook, not once per
 * request — and `subscription_plans` lives in `postgres_auth` beside
 * `organizations`, so nothing crosses a service boundary to answer it.
 */
@Injectable()
export class PlanCatalogService {
  private readonly logger = new Logger(PlanCatalogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The entitlements a price grants, or `null` when nothing maps it.
   *
   * **`null` is the FAIL-CLOSED answer and the caller must keep it that way.**
   * Defaulting an unmapped price to the cheapest plan downgrades a paying
   * customer over a config typo — one price created in the Stripe dashboard and
   * never added here — and their seat limit drops with no error anywhere. The
   * caller records `FAILED` and alerts instead, which is a loud, diagnosable
   * state with the raw payload attached.
   *
   * @param priceId a Stripe price id from a subscription's line item.
   */
  async entitlementsForPrice(
    priceId: string | null | undefined,
  ): Promise<(PlanEntitlements & { planId: string }) | null> {
    if (!priceId) return null;

    const price = await this.prisma.subscriptionPlanPrice.findUnique({
      where: { stripePriceId: priceId },
      include: { plan: true },
    });

    // A soft-deleted plan is not a plan. §7.1 — every read filters it, and a
    // price still pointing at one is the same unmapped case as a price nobody
    // ever added.
    if (price?.plan.deletedAt !== null) {
      this.logger.warn(`No active plan maps Stripe price '${priceId}'`);

      return null;
    }

    return {
      planId: price.plan.id,
      maxAgentSeats: price.plan.maxAgentSeats,
      maxStorageBytes: price.plan.maxStorageBytes,
      monthlyAiTokenBudget: price.plan.monthlyAiTokenBudget,
      aiModelTier: price.plan.aiModelTier as PlanEntitlements['aiModelTier'],
      maxDocumentBytes: price.plan.maxDocumentBytes,
      maxAttachmentBytes: price.plan.maxAttachmentBytes,
      // A label for logs and the billing page. NEVER an authorization input —
      // the same rule the code catalogue carried, and the reason `name` is not
      // what anything joins on.
      displayName: price.plan.name,
    };
  }

  /** Whether any price at all is sellable — used to reject a bogus checkout. */
  async priceExists(priceId: string): Promise<boolean> {
    return (await this.entitlementsForPrice(priceId)) !== null;
  }
}
