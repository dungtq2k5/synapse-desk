import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  CallerContext,
  CheckoutSessionResponse,
  CreateCheckoutSessionRequest,
  CreatePortalSessionRequest,
  ListInvoicesRequest,
  ListInvoicesResponse,
  PortalSessionResponse,
  SubscriptionResponse,
  toProtoTimestamp,
  toProtoAiModelTier,
  toProtoOrgStatus,
} from '@synapsedesk/grpc-proto';
import {
  formatErrorMsg,
  requireActor,
  requireTenant,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from './stripe.service';
import { PlanCatalogService } from './plan-catalog.service';

/** How many invoices a page shows. Stripe's own default is 10. */
const DEFAULT_INVOICE_LIMIT = 12;
const MAX_INVOICE_LIMIT = 100;

/**
 * `/billing/*` — the reads and the two session-minting calls.
 *
 * **Entitlements are read from Postgres, always.** A billing page that fans out
 * to Stripe on every load fails when Stripe does, and a quota gate that called
 * Stripe would fail on every AI request, every invite and every upload. The
 * webhook writes; everything else reads locally.
 *
 * Invoices are the ONE exception, and deliberately so: they are not mirrored,
 * because mirroring them would be the second source of truth this whole design
 * avoids. A live read is correct precisely because nothing here makes an
 * authorization decision from an invoice.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly planCatalog: PlanCatalogService,
  ) {}

  /**
   * The current plan and what it granted — **zero Stripe calls**.
   *
   * A tenant with no `stripe_customer_id` gets a coherent "no subscription"
   * answer rather than a 500. That is not an edge case: it is EVERY tenant on
   * the day this ships, and the grandfathered path is the one that has to work
   * first.
   */
  async getSubscription(context: CallerContext): Promise<SubscriptionResponse> {
    const organization = await this.load(context);

    // **The plan's OWN name, from the row it is on.**
    //
    // This used to reverse a label out of `aiModelTier` against the code
    // catalogue, which was approximate by construction: two plans sharing a
    // tier collapsed into whichever the search found first, so tenants on
    // different plans could read the same label. Now that a plan is a row, the
    // exact answer costs nothing.
    //
    // Still a LABEL and never an authorization input — nothing decides on it,
    // which is what keeps Stripe owning the price and this table owning the
    // grant.
    const planName = organization.stripeSubscriptionId
      ? (organization.plan?.name ?? organization.aiModelTier)
      : 'Free';

    return {
      stripeCustomerId: organization.stripeCustomerId ?? undefined,
      stripeSubscriptionId: organization.stripeSubscriptionId ?? undefined,
      planName,
      maxAgentSeats: organization.maxAgentSeats,
      maxStorageBytes: Number(organization.maxStorageBytes),
      monthlyAiTokenBudget: Number(organization.monthlyAiTokenBudget),
      aiModelTier: toProtoAiModelTier(organization.aiModelTier),
      billingCycleStart: toProtoTimestamp(organization.billingCycleStart),
      status: toProtoOrgStatus(organization.status),
    };
  }

  /**
   * A Checkout URL. **Grants nothing.**
   *
   * Entitlements are written when the webhook confirms, so a user who closes
   * the tab mid-checkout is not upgraded and a user who pays does not depend on
   * their browser making it back to a redirect. Both failure modes are real and
   * they point in opposite directions — which is why the grant lives on the
   * webhook rather than here.
   */
  async createCheckoutSession(
    request: CreateCheckoutSessionRequest,
    context: CallerContext,
  ): Promise<CheckoutSessionResponse> {
    const organization = await this.load(context);
    requireActor(context);

    // Validated against the catalog BEFORE Stripe is called. A price the
    // webhook could not map is a price that would take payment and then fail
    // to grant anything — the customer pays and stays on the old plan.
    if (!(await this.planCatalog.priceExists(request.priceId))) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `'${request.priceId}' is not a plan this workspace can subscribe to`,
      });
    }

    const customerId = await this.ensureCustomer(organization);

    try {
      const session = await this.stripe.api.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: request.priceId, quantity: 1 }],
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
        // The tenant id travels with the subscription so a webhook can resolve
        // it even if the customer lookup somehow cannot — belt and braces on
        // the one path where losing an event loses money.
        subscription_data: {
          metadata: { organizationId: organization.id },
        },
      });

      if (!session.url) {
        throw new Error('Stripe returned a checkout session with no URL');
      }

      return { url: session.url };
    } catch (error) {
      throw this.asClientError(error, 'create a checkout session');
    }
  }

  /**
   * A Customer Portal URL.
   *
   * **This replaces UI you would otherwise build** — card updates, plan changes
   * and cancellation all happen there, and that is most of the reason to use
   * Stripe rather than a payment processor.
   */
  async createPortalSession(
    request: CreatePortalSessionRequest,
    context: CallerContext,
  ): Promise<PortalSessionResponse> {
    const organization = await this.load(context);
    requireActor(context);

    if (!organization.stripeCustomerId) {
      // FAILED_PRECONDITION → 400. A grandfathered tenant has no portal to
      // open, and minting a customer just to show them an empty portal would
      // create a Stripe object for someone who has never paid.
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message:
          'This workspace has no billing account yet. Start a subscription first.',
      });
    }

    try {
      const session = await this.stripe.api.billingPortal.sessions.create({
        customer: organization.stripeCustomerId,
        return_url: request.returnUrl,
      });

      return { url: session.url };
    } catch (error) {
      throw this.asClientError(error, 'open the billing portal');
    }
  }

  /**
   * Invoice history, proxied from Stripe.
   *
   * The one place a live Stripe read is correct: invoices are not mirrored, and
   * nothing here makes an authorization decision from one.
   */
  async listInvoices(
    request: ListInvoicesRequest,
    context: CallerContext,
  ): Promise<ListInvoicesResponse> {
    const organization = await this.load(context);

    // Empty, not an error. A tenant who has never been billed has no invoices,
    // which is a perfectly ordinary state and not worth a 400.
    if (!organization.stripeCustomerId) return { items: [] };

    const limit = Math.min(
      Math.max(request.limit || DEFAULT_INVOICE_LIMIT, 1),
      MAX_INVOICE_LIMIT,
    );

    try {
      const invoices = await this.stripe.api.invoices.list({
        customer: organization.stripeCustomerId,
        limit,
      });

      return {
        items: invoices.data.map((invoice) => ({
          id: invoice.id ?? '',
          number: invoice.number ?? '',
          amountDue: invoice.amount_due,
          currency: invoice.currency,
          status: invoice.status ?? 'unknown',
          created: toProtoTimestamp(new Date(invoice.created * 1000)),
          hostedInvoiceUrl: invoice.hosted_invoice_url ?? '',
        })),
      };
    } catch (error) {
      throw this.asClientError(error, 'list invoices');
    }
  }

  // -------------------------------------------------------------------------

  /**
   * The tenant's Stripe customer, creating one on first checkout.
   *
   * Created lazily rather than at signup, which is what keeps the grandfathered
   * path honest: a tenant that never subscribes never gets a Stripe object, so
   * `stripe_customer_id IS NULL` continues to mean exactly "has never entered
   * billing" rather than "has an empty customer record somewhere".
   */
  private async ensureCustomer(organization: {
    id: string;
    name: string;
    stripeCustomerId: string | null;
  }): Promise<string> {
    if (organization.stripeCustomerId) return organization.stripeCustomerId;

    try {
      const customer = await this.stripe.api.customers.create({
        name: organization.name,
        metadata: { organizationId: organization.id },
      });

      await this.prisma.organization.update({
        where: { id: organization.id },
        data: { stripeCustomerId: customer.id },
      });

      return customer.id;
    } catch (error) {
      throw this.asClientError(error, 'create a billing account');
    }
  }

  private async load(context: CallerContext) {
    const organizationId = requireTenant(context);

    const organization = await this.prisma.organization.findFirst({
      // Tenant-scoped by construction: the id comes from the verified context,
      // never from the request, so there is no cross-tenant read to prevent.
      where: { id: organizationId, deletedAt: null },
      select: {
        id: true,
        name: true,
        status: true,
        maxAgentSeats: true,
        maxStorageBytes: true,
        monthlyAiTokenBudget: true,
        aiModelTier: true,
        billingCycleStart: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        // The plan's own name, for the label above. One join rather than a
        // reverse-lookup by tier that could not tell two QUALITY plans apart.
        plan: { select: { name: true } },
      },
    });

    if (!organization) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Organization not found',
      });
    }

    return organization;
  }

  /** Stripe failures become UNAVAILABLE, not 500 — they are someone else's outage. */
  private asClientError(error: unknown, action: string): RpcException {
    if (error instanceof RpcException) return error;

    this.logger.error(`Could not ${action}: ${formatErrorMsg(error)}`);

    return new RpcException({
      code: status.UNAVAILABLE,
      message: `Could not ${action} right now. Please try again.`,
    });
  }
}
