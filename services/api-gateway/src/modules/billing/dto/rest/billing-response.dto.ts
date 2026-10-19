import type { AiModelTier, OrgStatus } from '@synapsedesk/contracts';

export class SubscriptionResponseDto {
  /** NULL for a grandfathered tenant — free, internal, or pre-billing. */
  stripeCustomerId!: string | null;
  stripeSubscriptionId!: string | null;
  /** A label. Never an authorization input. */
  planName!: string;
  maxAgentSeats!: number;
  maxStorageBytes!: number;
  /**
   * The AI allowance a month, in millionths of a US dollar (1000000 is
   * $1.00), charged by what each AI request costs. Not tokens, whatever the
   * name says.
   */
  monthlyAiTokenBudget!: number;
  aiModelTier!: AiModelTier | null;
  billingCycleStart!: Date | null;
  /**
   * `OrgStatus` — **ours, not Stripe's**, despite living on a subscription
   * response. The proto field is `OrgStatus` and its comment says so: *"the
   * tenant lifecycle status the subscription drove"*. Only the neighbouring
   * `InvoiceResponseDto.status` carries Stripe's vocabulary.
   */
  status!: OrgStatus | null;
  /**
   * When the current period ends: the renewal date, or the end date when
   * `cancelAtPeriodEnd`. Null until a subscription event has named the tenant.
   */
  currentPeriodEnd!: Date | null;
  /** True when the subscription ends at `currentPeriodEnd` instead of renewing. */
  cancelAtPeriodEnd!: boolean;
  /** The Stripe price the subscription is on; null with no subscription. */
  priceId!: string | null;
  /** That price's interval, `month` | `year`; null with no subscription. */
  interval!: string | null;
  /**
   * On a plan agreed with the SynapseDesk team: no self-serve plan change or
   * Checkout applies.
   */
  negotiated!: boolean;
}

export class CheckoutSessionResponseDto {
  url!: string;
}

export class PortalSessionResponseDto {
  url!: string;
}

export class InvoiceResponseDto {
  id!: string;
  number!: string;
  amountDue!: number;
  currency!: string;
  /**
   * **STRIPE's** invoice status — `draft`, `open`, `paid`, `uncollectible`,
   * `void` — passed through from a live API read, so it stays a `string`.
   *
   * The one status field on this surface that must NOT be narrowed. An enum
   * over a third party's vocabulary turns a value they add into a runtime
   * surprise on a page about money; a foreign literal is stored and forwarded
   * as it arrives, the same rule `SubscriptionPlanPrice.interval` follows.
   * Written here rather than only in the proto because this is the third time
   * the question has been asked about a Stripe status field.
   */
  status!: string;
  created!: Date | null;
  hostedInvoiceUrl!: string;
}

export class TenantPlanPriceResponseDto {
  stripePriceId!: string;
  /** Stripe's literal — `month` | `year` in practice, and wider in theory. */
  interval!: string;
  /**
   * What the price charges each interval, in the currency's smallest unit
   * (cents for `usd`). Null for a price seeded before amounts were stored.
   */
  unitAmount!: number | null;
  /** Stripe's lowercase ISO currency code, e.g. `usd`. */
  currency!: string | null;
}

/**
 * A plan as a TENANT sees it.
 *
 * Deliberately not the Super Admin projection re-guarded: that one carries
 * `stripeProductId`, `deletedAt`, `deletedById`, `isActive` and a subscriber
 * count. A tenant is only ever shown joinable plans, so `isActive` carries no
 * information here — and an operator identifier in a tenant response is the
 * kind of thing that turns up in a support ticket.
 */
export class TenantPlanResponseDto {
  id!: string;
  name!: string;
  maxAgentSeats!: number;
  maxStorageBytes!: number;
  /**
   * The AI allowance a month, in millionths of a US dollar (1000000 is
   * $1.00), charged by what each AI request costs. Not tokens, whatever the
   * name says.
   */
  monthlyAiTokenBudget!: number;
  /** `AiModelTier` — see {@link SubscriptionResponseDto.aiModelTier}. */
  aiModelTier!: AiModelTier | null;
  maxDocumentBytes!: number;
  maxAttachmentBytes!: number;
  maxDocumentUploads!: number;
  maxAnalyticsRangeDays!: number;
  prices!: TenantPlanPriceResponseDto[];
}

/**
 * What Stripe accepted — **not the entitlement change.**
 *
 * Entitlements are written when `customer.subscription.updated` arrives,
 * exactly as they are for checkout. A client that treats this as the new grants
 * will read stale limits for as long as the webhook takes.
 */
export class PlanChangeResponseDto {
  planId!: string;
  planName!: string;
  effectiveAt!: Date | null;
  /**
   * Whether the proration credited rather than charged — **`null` when it could
   * not be determined.**
   *
   * A downgrade produces a credit against future invoices, never a refund, and
   * a client that does not say so is a support ticket. Three-valued on purpose:
   * `always_invoice` does not guarantee the proration lands on the invoice this
   * is read from, so a `false` can be wrong for a change that credited and a
   * `true` can be read off an unrelated invoice. `null` means *say nothing* —
   * which is the honest option, and the one a comment on a plain `boolean`
   * cannot give a UI that is already rendering it.
   */
  creditIssued!: boolean | null;
}
