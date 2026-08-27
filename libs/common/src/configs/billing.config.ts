/**
 * @file Price id → entitlements. **The whole integration is this table plus one
 * function**; everything else is plumbing around it.
 *
 * **What is deliberately NOT here: plan names, price points, feature lists.**
 * Mirroring them into Postgres — or into this file — creates a second source of
 * truth that diverges the first time someone edits a price in the Stripe
 * dashboard, and the divergence is silent because both sides keep answering
 * questions confidently. What a plan COSTS is Stripe's business. What it
 * GRANTS is this table's, and the two are joined by an opaque id.
 *
 * The `displayName` here is the exception that proves it: it is a label for an
 * operator reading a log line, never an authorization input, and nothing
 * compares against it.
 */

import { AiModelTier } from './ai-settings.config';

/**
 * The limits a plan apply can put a tenant over.
 *
 * The whole vocabulary, including the ones no pass evaluates yet — which is the
 * point: `ApplyPlanResponse.evaluated_dimensions` names what a run DID check,
 * and that is only meaningful against a list of what there is to check.
 *
 * `storage` is presently never evaluated; counting it needs a platform-scoped
 * usage read in `ingestion-service` that does not exist (known-gaps #18).
 */
export const PLAN_LIMIT_DIMENSIONS = ['seats', 'storage'] as const;
export type PlanLimitDimension = (typeof PLAN_LIMIT_DIMENSIONS)[number];

/**
 * The Stripe API version every caller in this repo pins to.
 *
 * Shared so the service and `scripts/provision-stripe.mjs` cannot drift: the
 * script CREATES the Products, Prices and portal configuration that the service
 * then reads, and two versions across that boundary is a shape mismatch nobody
 * sees until a field is missing.
 *
 * Bumping it is a deliberate act with a changelog to read, not a default to
 * inherit from whatever the account happens to be set to.
 */
export const STRIPE_API_VERSION = '2026-07-29.dahlia';

/** What a plan grants. Exactly the five entitlement columns, and no more. */
export type PlanEntitlements = {
  maxAgentSeats: number;
  maxStorageBytes: bigint;
  /** MICROS of currency, not tokens — RDM §1.14. The name is kept for continuity. */
  monthlyAiTokenBudget: bigint;
  /** `FAST | QUALITY`. The sellable AI entitlement. */
  aiModelTier: AiModelTier;
  /**
   * The largest document this plan admits.
   *
   * A plan can only NARROW: an argument to `min()` against the platform
   * ceiling, never a replacement for it. `MAX_DOCUMENT_BYTES` protects the
   * parser and is not sellable.
   */
  maxDocumentBytes: bigint;
  /**
   * The largest attachment this plan admits — the same narrow-only rule as
   * {@link PlanEntitlements.maxDocumentBytes}.
   *
   * Bounded by `MAX_ATTACHMENT_BYTES`, which is a TRANSPORT limit rather than a
   * policy one: it sits where the gRPC message size binds, so there is very
   * little room to differentiate plans on this number.
   */
  maxAttachmentBytes: bigint;
  /** For logs and the billing page. NEVER an authorization input. */
  displayName: string;
};

// ---------------------------------------------------------------- Webhook bookkeeping — RDM §1.15, Table 30

/**
 * What happened to a Stripe webhook the system accepted.
 *
 * `SKIPPED_STALE` is the monotonic guard firing, and seeing it regularly is
 * INFORMATION rather than noise: webhooks arrive out of order as a matter of
 * course, and a run of them says the transport is behaving normally. A run of
 * `FAILED` says a price id is missing from the mapping table.
 */
export enum BillingEventStatus {
  PROCESSED = 'PROCESSED',
  /** The monotonic guard: an older event arrived after a newer one. */
  SKIPPED_STALE = 'SKIPPED_STALE',
  /** The idempotency guard: Stripe redelivered something already applied. */
  SKIPPED_DUPLICATE = 'SKIPPED_DUPLICATE',
  /**
   * Recorded and NOT applied — the tenant's entitlements are PINNED.
   *
   * A Super Admin granted this workspace something off-catalogue, so the
   * writer must not re-derive its columns from the price on the next routine
   * webhook. Distinct from `SKIPPED_STALE`: that one is an ordering fact about
   * the transport, this one is a deliberate policy about one tenant, and
   * conflating them would make a pin look like a delivery quirk.
   */
  SKIPPED_PINNED = 'SKIPPED_PINNED',
  /** Recorded and NOT applied — an unknown price id, most likely. */
  FAILED = 'FAILED',
}

/**
 * Stripe subscription status → tenant lifecycle status.
 *
 * **The enum was designed before billing existed and maps onto Stripe's
 * statuses without modification** (RDM §1.15), which is why the lifecycle
 * gate is the enforcement mechanism billing needed most and did not have to be
 * built. `incomplete` is deliberately absent: it means checkout has not
 * completed, and a tenant mid-checkout has whatever status they already had.
 */
export const STRIPE_STATUS_TO_ORG_STATUS: Record<string, string> = {
  active: 'ACTIVE',
  trialing: 'ACTIVE',
  past_due: 'SUSPENDED_PAST_DUE',
  unpaid: 'SUSPENDED_PAST_DUE',
  canceled: 'FROZEN',
  incomplete_expired: 'FROZEN',
};
