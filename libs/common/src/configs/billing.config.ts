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
import {
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS_PER_TENANT,
} from './document.config';
import { MAX_ATTACHMENT_BYTES } from './ticket.config';
import { MAX_ANALYTICS_RANGE_DAYS } from './analytics.config';

/**
 * The limits a plan apply can put a tenant over.
 *
 * The whole vocabulary, including the ones no pass evaluates yet — which is the
 * point: `ApplyPlanResponse.evaluated_dimensions` names what a run DID check,
 * and that is only meaningful against a list of what there is to check.
 *
 * **`analytics` is deliberately absent.** This list means "dimensions where a
 * subscriber can be OVER", and a lookback window has no over-limit subset:
 * narrowing it affects every subscriber equally and immediately. Adding it for
 * symmetry would make the list mean two different things.
 *
 * **Not the same list as `LIMIT_ALERT_DIMENSIONS`**, which happens to have the
 * same three members and answers "which dimensions have an approaching state".
 * Its exclusions are per-file byte gates; this one's exclusion is `analytics`.
 * See that constant for why the two are allowed to diverge.
 *
 * Which of these a given run actually checked is reported per response, because
 * the answer is dynamic: `storage` and `documents` are answered by
 * `ingestion-service`, so a leg that does not respond drops them from that run's
 * coverage rather than silently reporting nobody affected.
 */
export const PLAN_LIMIT_DIMENSIONS = ['seats', 'storage', 'documents'] as const;
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
  /**
   * The most documents this plan admits.
   *
   * A COUNT, not a size — `maxStorageBytes` bounds the bytes and this bounds
   * the corpus behind retrieval. Composed by `min()` against
   * `MAX_DOCUMENTS_PER_TENANT` like every other grant.
   */
  maxDocumentUploads: number;
  /**
   * How far back analytics may look, in days.
   *
   * The one grant whose narrowing is RETROACTIVE: it restricts a read over data
   * that already exists, so there is no "next thing" to refuse and no
   * over-limit subset to report.
   */
  maxAnalyticsRangeDays: number;
  /** For logs and the billing page. NEVER an authorization input. */
  displayName: string;
};

/**
 * What a workspace gets with no subscription.
 *
 * **The single definition of the free tier.** It used to be seven `@default()`s
 * on `organizations`, which put the product's free plan in a Prisma file where
 * nothing that reasons about plans could read it — including the catalogue,
 * which could not seed a Free row from a number it could not see.
 *
 * Four of those defaults were literal copies of platform constants. They are
 * REFERENCED here rather than repeated, so the pair cannot drift: raising
 * `MAX_DOCUMENT_BYTES` used to leave every new tenant at the old number with no
 * error anywhere.
 *
 * **The `satisfies` is why this lives beside `PlanEntitlements`.** The free tier
 * becomes a value of the same type a plan grants, so a field added there cannot
 * be forgotten on the free path — which is how the free tier fell out of the
 * catalogue to begin with.
 *
 * **Organization creates spread {@link FREE_TIER_ORGANIZATION_GRANTS}**, not
 * this — `displayName` is a plan's label and `organizations` has no column for
 * it.
 *
 * @example
 * // Overrides AFTER the base, so a Super Admin's value wins:
 * data: { ...FREE_TIER_ORGANIZATION_GRANTS, ...explicitOverrides }
 */
export const FREE_TIER_ENTITLEMENTS = {
  // The three that copied nothing. These numbers ARE the free tier, and until
  // now `schema.prisma` was the only place they were written down.
  maxAgentSeats: 10,
  maxStorageBytes: 5_368_709_120n,
  monthlyAiTokenBudget: 1_000_000n,
  aiModelTier: 'FAST',

  // The ninth field of `PlanEntitlements`, and the one that lets the catalogue
  // carry a Free row: `plan.name` is what it renders.
  displayName: 'Free',

  // **These four EQUAL the platform ceiling, and that is inherited rather than
  // chosen.** They were `@default()`s copied from the constants beside them, so
  // naming the free tier changed no behaviour — which was the point of the
  // change, and leaves the question it exposed still open: "the most the system
  // permits" and "what someone gets for free" are different numbers that
  // currently have the same value.
  //
  // Narrowing any of them is a PRODUCT decision, not a refactor. `free-tier.spec.ts`
  // pins the equality so that decision is an edit somebody makes on purpose
  // rather than a drift nobody notices.

  // The four that were literal copies of the constants beside them.
  maxDocumentBytes: BigInt(MAX_DOCUMENT_BYTES),
  maxAttachmentBytes: BigInt(MAX_ATTACHMENT_BYTES),
  maxDocumentUploads: MAX_DOCUMENTS_PER_TENANT,
  maxAnalyticsRangeDays: MAX_ANALYTICS_RANGE_DAYS,
} as const satisfies PlanEntitlements;

/**
 * The free tier as an ORGANIZATION's columns — every grant, minus the label.
 *
 * **`displayName` is a PLAN's field, not a tenant's**, and `organizations` has
 * no such column. Spreading the full entitlement set into an organization
 * create passes an unknown field, which TypeScript cannot see — a spread
 * suppresses excess-property checking — so it compiles and fails at runtime.
 *
 * The two shapes overlap and are not equal, which is the cost of the
 * `satisfies` in `FREE_TIER_ENTITLEMENTS` rather than an argument against it:
 * `Omit<PlanEntitlements, 'displayName'>` keeps the same guarantee here, so a
 * field added to the plan type still has to be answered on the tenant path.
 *
 * Every value is READ from `FREE_TIER_ENTITLEMENTS` rather than repeated, so
 * the two cannot drift.
 */
// Two things worth knowing before these numbers reach a pricing page, moved
// here from the columns they used to sit on:
//
// - `maxAttachmentBytes`' ceiling is a TRANSPORT bound, not a policy one.
//   `MAX_ATTACHMENT_BYTES` is 10 MB because the gRPC message limit binds there,
//   with `MAX_AI_ATTACHMENT_BYTES` at 8 MB beneath it. There is very little
//   room to differentiate a plan on that column.
// - `maxDocumentUploads` was a NARROWING when it arrived. The count was
//   unlimited before the column existed, so a tenant already above it was over
//   on the day it landed. Safe, because a limit gates ADMISSION and never
//   TENURE — they keep every document and are refused the next upload — and the
//   reason the constant sits well above anything reached in practice.
export const FREE_TIER_ORGANIZATION_GRANTS = {
  maxAgentSeats: FREE_TIER_ENTITLEMENTS.maxAgentSeats,
  maxStorageBytes: FREE_TIER_ENTITLEMENTS.maxStorageBytes,
  monthlyAiTokenBudget: FREE_TIER_ENTITLEMENTS.monthlyAiTokenBudget,
  aiModelTier: FREE_TIER_ENTITLEMENTS.aiModelTier,
  maxDocumentBytes: FREE_TIER_ENTITLEMENTS.maxDocumentBytes,
  maxAttachmentBytes: FREE_TIER_ENTITLEMENTS.maxAttachmentBytes,
  maxDocumentUploads: FREE_TIER_ENTITLEMENTS.maxDocumentUploads,
  maxAnalyticsRangeDays: FREE_TIER_ENTITLEMENTS.maxAnalyticsRangeDays,
} as const satisfies Omit<PlanEntitlements, 'displayName'>;

/**
 * The shape a plan row is seeded in.
 *
 * `PlanEntitlements` is NOT it, and the difference is exactly two fields: the
 * plan spells its label `name` rather than `displayName`, and it carries
 * `stripeProductId` — NULL for a plan assigned rather than sold, which is the
 * field that makes the free tier unbuyable by construction.
 *
 * `Prisma.SubscriptionPlanCreateInput` would be the natural type and is
 * unreachable: `libs/` MUST NOT import from `apps/`. So the shape is declared
 * here, derived from `PlanEntitlements` rather than written out — a field added
 * there still has to be answered on all three constants, which is the guarantee
 * the whole arrangement exists for.
 */
type FreePlanSeed = Omit<PlanEntitlements, 'displayName'> & {
  name: string;
  stripeProductId: string | null;
};

/**
 * The free tier as a `SubscriptionPlan`'s columns.
 *
 * `displayName` is the plan's `name`, and everything else maps one-to-one — so
 * the Free row is seeded from the same constant every create path uses, rather
 * than from a second copy of the same numbers.
 */
export const FREE_PLAN_SEED = {
  name: FREE_TIER_ENTITLEMENTS.displayName,
  // NULL, because the Free plan is assigned rather than sold. It is invisible
  // to Checkout by construction, which is correct: nobody buys it.
  stripeProductId: null,
  maxAgentSeats: FREE_TIER_ENTITLEMENTS.maxAgentSeats,
  maxStorageBytes: FREE_TIER_ENTITLEMENTS.maxStorageBytes,
  monthlyAiTokenBudget: FREE_TIER_ENTITLEMENTS.monthlyAiTokenBudget,
  aiModelTier: FREE_TIER_ENTITLEMENTS.aiModelTier,
  maxDocumentBytes: FREE_TIER_ENTITLEMENTS.maxDocumentBytes,
  maxAttachmentBytes: FREE_TIER_ENTITLEMENTS.maxAttachmentBytes,
  maxDocumentUploads: FREE_TIER_ENTITLEMENTS.maxDocumentUploads,
  maxAnalyticsRangeDays: FREE_TIER_ENTITLEMENTS.maxAnalyticsRangeDays,
} as const satisfies FreePlanSeed;

// ---------------------------------------------------------------- Webhook bookkeeping — RDM §1.15, Table 30

/**
 * Who WROTE a `billing_events` row.
 *
 * **The table has two producers and only one of them is Stripe.** Events we
 * consumed carry `STRIPE`; the in-flight claim a plan change takes carries
 * `LOCAL`. The distinction is load-bearing rather than descriptive: the
 * monotonic staleness guard computes a tenant's high-water mark from the newest
 * PROCESSED row, and a locally-produced row is not an event in that ordering —
 * it carries a wall-clock timestamp with millisecond precision, while Stripe's
 * `created` is whole SECONDS, so a claim written at `10:00:00.190` makes the
 * webhook it caused (`10:00:00.000`) look stale and the entitlement write is
 * skipped.
 *
 * **A `source` column rather than a filter on `eventType`.** Excluding
 * `plan.change_requested` by name would be correct only while there is exactly
 * one local producer — the same single-producer assumption behind the limit
 * alert's hardcoded email template and its generated message id, which is
 * three instances in three phases and therefore a pattern rather than three
 * incidents. A discriminator cannot be silently wrong when a fourth producer
 * arrives.
 */
export enum BillingEventSource {
  /** A webhook we received and verified. Ordered by Stripe's `created`. */
  STRIPE = 'STRIPE',
  /** A row this system wrote about its own act. Never a high-water mark. */
  LOCAL = 'LOCAL',
}

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

// ---------------------------------------------------------------- Finance

/**
 * What `estimatedMrr` leaves out, traveling ON THE WIRE beside the number.
 *
 * Not a docblock, because the caveat has to reach the chart. A field called
 * `mrr` gets quoted in a meeting; a field called `estimatedMrr` arriving with
 * the list of what it excludes cannot be quoted without them.
 *
 * Each entry is a real divergence from Stripe's own MRR, not a hedge:
 *
 * - `discounts` — Stripe applies coupons to its figure and this arithmetic does
 *   not, so ours reads HIGH for any tenant with one.
 * - `trials` — `status: 'active'` excludes `trialing`, while the tenant status
 *   mapping folds `trialing` into `ACTIVE`. The two "active" populations in one
 *   response are deliberately named apart for this reason.
 * - `past_due` — a subscription still being retried is not revenue yet.
 *
 * @example
 * revenue: { estimatedMrr: 249_00, excludes: REVENUE_EXCLUSIONS }
 */
export const REVENUE_EXCLUSIONS = ['discounts', 'trials', 'past_due'] as const;

/**
 * Why the revenue section has no number.
 *
 * A reason rather than a boolean, because the three cases want different
 * responses from whoever is looking: configure billing, wait an hour, or go
 * look at why the job is failing.
 */
export enum RevenueUnavailableReason {
  /**
   * `STRIPE_SECRET_KEY` is unset — a SUPPORTED deployment, not a fault.
   *
   * The snapshot job records a SUCCESS in this state. An hourly job that threw
   * here would make `/platform/jobs` permanently red on every developer machine
   * and on any billing-disabled deployment, and a red row that is always red is
   * one people learn to scroll past.
   */
  NOT_CONFIGURED = 'billing is not configured on this deployment',

  /**
   * There is no snapshot: the job has not run yet, or the one it wrote outlived
   * {@link SNAPSHOT_TTL_SECONDS}.
   *
   * **A claim about the JOB**, which is why it must not be reused for a store
   * that could not be read — see {@link SNAPSHOT_UNREADABLE}.
   */
  NO_SNAPSHOT = 'the revenue snapshot has not been computed yet',

  /**
   * The snapshot could not be read or could not be understood.
   *
   * **Separate from {@link NO_SNAPSHOT} because the operator's next move is
   * different, and because the corroborating signal points the other way.** A
   * store that is unreachable leaves `/platform/jobs` showing `billing-snapshot`
   * GREEN — the job ran and wrote — so a page saying "not computed yet" beside a
   * job health saying "computed forty minutes ago" offers no correct reading at
   * all. This one says: the number exists or does not, and we could not find
   * out.
   *
   * Covers two facts with one response, deliberately: the client is
   * unreachable, or the stored JSON does not parse as a snapshot — a shape left
   * by a previous deploy. The log line distinguishes them; the wire does not,
   * because in both cases the answer is the same and it is not "wait an hour".
   */
  SNAPSHOT_UNREADABLE = 'the revenue snapshot could not be read',

  /**
   * Two or more currencies among active subscriptions.
   *
   * **Refused rather than summed.** Adding 100 USD to 100 EUR produces 200 of
   * nothing, and it is the fastest available route to a confidently wrong
   * figure — worse than an empty section, because nothing about it looks wrong.
   *
   * **All-or-nothing, and that cost is real.** ONE subscription in a second
   * currency removes the number for the whole platform, permanently, with no
   * path back except a code change. The eventual refinement is per-currency
   * totals rather than one figure — which is what a platform selling in two
   * currencies actually wants — and until then the refusal is deliberate rather
   * than an oversight. The offending subscription id is logged at the refusal,
   * because the reason code names the category and an operator otherwise has no
   * first step among ten thousand subscriptions.
   */
  MIXED_CURRENCIES = 'active subscriptions span more than one currency',

  /**
   * A price this arithmetic cannot normalize to a month.
   *
   * Tiered or metered pricing (`unit_amount` is null), or a recurring interval
   * that is not monthly or annual. **Refused rather than skipped**, for the
   * reason {@link MIXED_CURRENCIES} is: silently dropping the subscriptions it
   * cannot price produces a total that looks complete and is low, which is
   * worse than an empty section because nothing about it looks wrong.
   *
   * **All-or-nothing, with the same cost.** The day the platform sells one
   * usage-based plan, `estimatedMrr` is gone for everyone. The refinement is a
   * priced total beside a count of what could not be priced — honest and still
   * useful. The offending subscription id is logged, for the same reason.
   */
  UNSUPPORTED_PRICING = 'an active subscription uses pricing this estimate cannot normalise',
}

/**
 * How long a revenue snapshot stays servable.
 *
 * **Longer than the hourly cadence on purpose.** At exactly one hour a job that
 * runs a minute late leaves the section blank, which reads as a failure rather
 * than as a schedule. Three hours means the section survives two missed runs
 * and disappears only when something is genuinely wrong — by which point
 * `/platform/jobs` is already saying so, which is the surface that should.
 */
export const SNAPSHOT_TTL_SECONDS = 3 * 60 * 60;

/**
 * The widest range `ListBillingEvents` will answer, in days.
 *
 * **`billing_events` never shrinks**, so the range is the only thing bounding
 * the read. A year covers every question a finance page asks and refuses the
 * one nobody meant to ask — an unbounded default walking the entire history on
 * a page load.
 *
 * Not a plan limit like `MAX_ANALYTICS_RANGE_DAYS`: this surface is Super Admin
 * only and there is no plan to look one up from.
 */
export const MAX_FINANCE_RANGE_DAYS = 366;
