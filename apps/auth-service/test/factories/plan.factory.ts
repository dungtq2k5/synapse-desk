import type { PrismaClient } from '../../src/generated/prisma/client';

const GIB = 1024n * 1024n * 1024n;
const MIB = 1024n * 1024n;

/**
 * The catalogue, as rows.
 *
 * These are the entitlements `DEFAULT_PLAN_CATALOG` used to hardcode. They live
 * here now because the catalogue is a TABLE — a constant in `libs/common` could
 * only ever be right for the environment it was compiled for, and the Stripe
 * price ids differ between test and live modes.
 *
 * The price ids are deliberately readable rather than real `price_1Ox…`
 * strings: nothing in these tests talks to Stripe, and a fixture id that says
 * what it is beats one that has to be looked up.
 */
export const PLAN_FIXTURES = [
  {
    name: 'Starter',
    stripeProductId: 'prod_starter',
    maxAgentSeats: 5,
    maxStorageBytes: 5n * GIB,
    monthlyAiTokenBudget: 1_000_000n,
    aiModelTier: 'FAST',
    // Starter NARROWS both file-size grants. The other two sit at the platform
    // ceiling, so a test that wants to see the plan layer bite has to use this
    // one — at the ceiling, `min()` is indistinguishable from no plan at all.
    maxDocumentBytes: 25n * MIB,
    maxAttachmentBytes: 5n * MIB,
    prices: [{ stripePriceId: 'price_starter_monthly', interval: 'month' }],
  },
  {
    name: 'Pro',
    stripeProductId: 'prod_pro',
    maxAgentSeats: 25,
    maxStorageBytes: 50n * GIB,
    monthlyAiTokenBudget: 10_000_000n,
    aiModelTier: 'QUALITY',
    maxDocumentBytes: 100n * MIB,
    maxAttachmentBytes: 10n * MIB,
    prices: [
      { stripePriceId: 'price_pro_monthly', interval: 'month' },
      // A SECOND price on one plan, which is the shape the product keying
      // exists for: monthly and annual must resolve to the same entitlements.
      { stripePriceId: 'price_pro_annual', interval: 'year' },
    ],
  },
  {
    name: 'Enterprise',
    stripeProductId: 'prod_enterprise',
    maxAgentSeats: 200,
    maxStorageBytes: 500n * GIB,
    monthlyAiTokenBudget: 100_000_000n,
    aiModelTier: 'QUALITY',
    maxDocumentBytes: 100n * MIB,
    maxAttachmentBytes: 10n * MIB,
    prices: [{ stripePriceId: 'price_enterprise_monthly', interval: 'month' }],
  },
] as const;

/** Writes the catalogue. Call after a reset; every test needs it. */
export async function seedPlans(prisma: PrismaClient): Promise<void> {
  for (const plan of PLAN_FIXTURES) {
    const { prices, ...fields } = plan;
    const row = await prisma.subscriptionPlan.create({ data: { ...fields } });

    for (const price of prices) {
      await prisma.subscriptionPlanPrice.create({
        data: { ...price, planId: row.id },
      });
    }
  }
}

/** The fixture for a price id, so an assertion can name what it expects. */
export function planForPrice(priceId: string) {
  const plan = PLAN_FIXTURES.find((candidate) =>
    candidate.prices.some((price) => price.stripePriceId === priceId),
  );

  if (!plan) throw new Error(`No plan fixture maps '${priceId}'`);

  return plan;
}
