import { FREE_PLAN_SEED } from '@synapsedesk/contracts';

/**
 * A negotiated plan the platform assigns: one with no Stripe product, and not
 * Free. An organization on one is "assigned": its grants are that plan's row,
 * checkout and plan changes refuse it, and only the platform releases it.
 *
 * Free is told apart by name, the identity the seeder keys it on.
 *
 * @example isAssignedPlan({ name: 'Quarry agreement', stripeProductId: null }) // true
 */
export function isAssignedPlan(
  plan: { name: string; stripeProductId: string | null } | null | undefined,
): boolean {
  return (
    !!plan && plan.stripeProductId === null && plan.name !== FREE_PLAN_SEED.name
  );
}
