/**
 * The one billing event Domain C already has to care about.
 *
 * **The publisher is the Stripe webhook** — see
 * `docs/decisions/0026-stripe-webhook-idempotency.md`.
 *
 * Without the consumer, a downgraded tenant keeps receiving the premium model
 * for the length of the cache TTL: the system giving away the thing it just
 * stopped being paid for, in the direction that costs money rather than the
 * direction someone complains about.
 *
 * Defined here rather than in the billing service so the webhook emits against
 * a subject and payload that already have a reader.
 */
export const BILLING_PATTERNS = {
  /**
   * A tenant's plan, tier or quotas changed.
   *
   * Carries no entitlement VALUES on purpose. A payload that shipped the new
   * tier would be a second source of truth racing the database read, and the
   * loser of that race is whichever message NATS happened to redeliver. This
   * is a cache-invalidation signal: it says *re-read*, never *here is the
   * answer*.
   */
  entitlementsChanged: 'billing.entitlements_changed',
} as const;

export type BillingPattern =
  (typeof BILLING_PATTERNS)[keyof typeof BILLING_PATTERNS];

export type EntitlementsChangedEvent = {
  pattern: typeof BILLING_PATTERNS.entitlementsChanged;
  /**
   * Whose entitlements changed. **Required, and never a wildcard.**
   *
   * A test asserts the neighbouring tenant's cache survives: a
   * global flush on every webhook is a thundering herd, and webhooks arrive in
   * bursts at exactly the moment the system is least able to absorb one.
   */
  organizationId: string;
  /** ISO 8601, from the PUBLISHER's clock — the rule every contract here follows. */
  occurredAt: string;
};
