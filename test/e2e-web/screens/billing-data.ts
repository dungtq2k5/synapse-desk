import type {
  InvoiceResponseDto,
  OrganizationUsageResponseDto,
  SubscriptionResponseDto,
  TenantPlanResponseDto,
} from '@synapsedesk/api-client';

/**
 * Billing as design 09 draws it: Northwind Health on Pro, paid monthly,
 * renewing on 1 Nov 2026, with the seeded plans at the handoff's sample
 * prices and six invoices.
 */

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

const plan = (
  name: string,
  seats: number,
  storageGb: number,
  aiDollars: number,
  tier: 'FAST' | 'QUALITY',
  documentMb: number,
  attachmentMb: number,
  documents: number,
  days: number,
  month: number,
): TenantPlanResponseDto => ({
  id: `plan-${name.toLowerCase()}`,
  name,
  maxAgentSeats: seats,
  maxStorageBytes: storageGb * GIB,
  monthlyAiTokenBudget: aiDollars * 1_000_000,
  aiModelTier: tier,
  maxDocumentBytes: documentMb * MIB,
  maxAttachmentBytes: attachmentMb * MIB,
  maxDocumentUploads: documents,
  maxAnalyticsRangeDays: days,
  prices: [
    {
      stripePriceId: `price_${name.toLowerCase()}_monthly`,
      interval: 'month',
      unitAmount: month,
      currency: 'usd',
    },
    {
      stripePriceId: `price_${name.toLowerCase()}_yearly`,
      interval: 'year',
      unitAmount: month * 10,
      currency: 'usd',
    },
  ],
});

export const PLANS: TenantPlanResponseDto[] = [
  plan('Starter', 5, 5, 1, 'FAST', 5, 2, 1_000, 30, 2_900),
  plan('Pro', 25, 50, 10, 'QUALITY', 25, 5, 10_000, 180, 9_900),
  plan('Enterprise', 200, 500, 100, 'QUALITY', 100, 10, 100_000, 400, 49_900),
];

export const SUBSCRIPTION: SubscriptionResponseDto = {
  stripeCustomerId: 'cus_northwind',
  stripeSubscriptionId: 'sub_northwind',
  planName: 'Pro',
  maxAgentSeats: 25,
  maxStorageBytes: 50 * GIB,
  monthlyAiTokenBudget: 10_000_000,
  aiModelTier: 'QUALITY',
  billingCycleStart: '2026-10-01T00:00:00.000Z',
  status: 'ACTIVE',
  currentPeriodEnd: '2026-11-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  priceId: 'price_pro_monthly',
  interval: 'month',
  negotiated: false,
};

export const FREE: SubscriptionResponseDto = {
  ...SUBSCRIPTION,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  planName: 'Free',
  maxAgentSeats: 10,
  maxStorageBytes: 5 * GIB,
  monthlyAiTokenBudget: 1_000_000,
  aiModelTier: 'FAST',
  currentPeriodEnd: null,
  priceId: null,
  interval: null,
};

const meter = (used: number, limit: number) => ({
  available: true,
  used,
  limit,
  unavailableReason: null,
});

export const BILLING_USAGE: OrganizationUsageResponseDto = {
  seats: meter(18, 25),
  storage: meter(Math.round(3.9 * GIB), 50 * GIB),
  aiTokens: meter(6_200_000, 10_000_000),
  billingCycleStart: '2026-10-01T00:00:00.000Z',
  aiModelTier: 'QUALITY',
  planName: 'Pro',
  currentPeriodEnd: '2026-11-01T00:00:00.000Z',
};

export const FREE_USAGE: OrganizationUsageResponseDto = {
  seats: meter(4, 10),
  storage: meter(Math.round(1.2 * GIB), 5 * GIB),
  aiTokens: meter(400_000, 1_000_000),
  billingCycleStart: '2026-10-01T00:00:00.000Z',
  aiModelTier: 'FAST',
  planName: 'Free',
  currentPeriodEnd: null,
};

/** The documents' own count, for a plan that's too small. */
export const STORAGE = {
  usedBytes: Math.round(3.9 * GIB),
  limitBytes: 50 * GIB,
  documentCount: 1_240,
};

export const invoice = (
  sequence: number,
  month: number,
  amountDue: number,
  status = 'paid',
): InvoiceResponseDto => ({
  id: `in_${sequence}`,
  number: `8F3A21C7-${String(sequence).padStart(4, '0')}`,
  amountDue,
  currency: 'usd',
  status,
  created: new Date(Date.UTC(2026, month - 1, 1)).toISOString(),
  hostedInvoiceUrl: `https://invoice.stripe.com/i/acct_northwind/${sequence}`,
});

export const INVOICES: InvoiceResponseDto[] = [
  invoice(12, 10, 9_900),
  invoice(11, 9, 9_900),
  invoice(10, 8, 9_900),
  invoice(9, 7, 9_900),
  invoice(8, 6, 2_900),
  invoice(7, 5, 2_900),
];
