/**
 * Price id → entitlements. **The whole integration is this table plus one
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

/** What a plan grants. Exactly the five entitlement columns, and no more. */
export type PlanEntitlements = {
  maxAgentSeats: number;
  maxStorageBytes: bigint;
  /** MICROS of currency, not tokens — RDM §1.14. The name is kept for continuity. */
  monthlyAiTokenBudget: bigint;
  /** `FAST | QUALITY`. The sellable AI entitlement. */
  aiModelTier: AiModelTier;
  /** For logs and the billing page. NEVER an authorization input. */
  displayName: string;
};

const GIB = 1024n * 1024n * 1024n;

/**
 * The mapping, keyed by Stripe price id.
 *
 * Read from the environment in a real deployment — the ids differ between
 * Stripe's test and live modes, and hardcoding either means the integration
 * works in exactly one of them. The defaults below are the test-mode ids so a
 * fresh clone can run the suite; `loadPlanCatalog` is what production uses.
 */
export const DEFAULT_PLAN_CATALOG: Record<string, PlanEntitlements> = {
  price_starter_monthly: {
    maxAgentSeats: 5,
    maxStorageBytes: 5n * GIB,
    monthlyAiTokenBudget: 1_000_000n,
    aiModelTier: 'FAST',
    displayName: 'Starter',
  },
  price_pro_monthly: {
    maxAgentSeats: 25,
    maxStorageBytes: 50n * GIB,
    monthlyAiTokenBudget: 10_000_000n,
    // The tier is what makes Pro sellable as more than a bigger number —
    // The tier a tenant buys.
    aiModelTier: 'QUALITY',
    displayName: 'Pro',
  },
  price_enterprise_monthly: {
    maxAgentSeats: 200,
    maxStorageBytes: 500n * GIB,
    monthlyAiTokenBudget: 100_000_000n,
    aiModelTier: 'QUALITY',
    displayName: 'Enterprise',
  },
};

/**
 * Reads a catalog override from the environment, falling back to the defaults.
 *
 * The override is JSON keyed by price id. It exists because Stripe price ids
 * are environment-specific: `price_1Ox…` in test mode and a different opaque
 * string in live mode, so a table baked into the build works in exactly one of
 * them and fails closed in the other — which, thanks to `entitlementsForPrice`
 * below, means a paying customer's webhook lands as FAILED rather than
 * downgrading them.
 */
export function loadPlanCatalog(
  raw: string | undefined,
): Record<string, PlanEntitlements> {
  if (!raw) return DEFAULT_PLAN_CATALOG;

  const parsed = JSON.parse(raw) as Record<
    string,
    Omit<PlanEntitlements, 'maxStorageBytes' | 'monthlyAiTokenBudget'> & {
      maxStorageBytes: string | number;
      monthlyAiTokenBudget: string | number;
    }
  >;

  return Object.fromEntries(
    Object.entries(parsed).map(([priceId, plan]) => [
      priceId,
      {
        ...plan,
        // Through BigInt because JSON has no integer type large enough for a
        // byte count in the hundreds of gigabytes — `JSON.parse` would hand
        // back a float and the value would be quietly approximate.
        maxStorageBytes: BigInt(plan.maxStorageBytes),
        monthlyAiTokenBudget: BigInt(plan.monthlyAiTokenBudget),
      },
    ]),
  );
}

/**
 * The entitlements a price grants, or **null**.
 *
 * Null rather than a default, and this is the single most consequential line in
 * the file. Defaulting an unknown price id to the free tier means one typo in
 * the catalog — or one price created in the Stripe dashboard and not added here
 * — **downgrades a paying customer** on their next `subscription.updated`.
 * Nothing errors; their seat limit simply drops, and they find out days later.
 *
 * The caller records `FAILED`, alerts, and changes nothing.
 * Failing closed here means a human fixes a config line; failing open means a
 * customer discovers it.
 */
export function entitlementsForPrice(
  catalog: Record<string, PlanEntitlements>,
  priceId: string | null | undefined,
): PlanEntitlements | null {
  if (!priceId) return null;

  return catalog[priceId] ?? null;
}

// ---------------------------------------------------------------------------
// Webhook bookkeeping — RDM §1.15, Table 30
// ---------------------------------------------------------------------------

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
  /** Recorded and NOT applied — an unknown price id, most likely. */
  FAILED = 'FAILED',
}

/**
 * Stripe subscription status → tenant lifecycle status.
 *
 * **The enum was designed before billing existed and maps onto Stripe's
 * statuses without modification** (RDM §1.15), which is why §0.4's lifecycle
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
