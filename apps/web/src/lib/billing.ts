import type {
  OverLimit,
  SubscriptionResponseDto,
  TenantPlanPriceResponseDto,
  TenantPlanResponseDto,
} from '@synapsedesk/api-client';

/**
 * Billing's words and numbers (design 09): prices in the reader's locale, a
 * plan's grants in the deck's order, how two plans compare, and the button a
 * plan card offers. Pure, so each rule has its own row.
 */

export type Interval = 'month' | 'year';

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

/** A plan's grants, as Free has them too (four) or a sold plan does (seven). */
export type Grants = {
  name: string;
  maxAgentSeats: number;
  maxStorageBytes: number;
  monthlyAiTokenBudget: number;
  aiModelTier: string | null;
  /** Absent on Free: it isn't sold, so its document limits aren't drawn. */
  maxDocumentBytes?: number;
  maxAttachmentBytes?: number;
  maxDocumentUploads?: number;
  maxAnalyticsRangeDays?: number;
};

/**
 * An amount in a currency's smallest unit, formatted for the reader's locale.
 *
 * @example money(9_900, 'usd', 'en-US') // '$99.00'
 */
export function money(amount: number, currency: string, locale?: string) {
  const format = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.toUpperCase(),
  });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(amount / 10 ** digits);
}

/**
 * The AI allowance: money a month in millionths of a dollar, not tokens.
 *
 * @example aiMoney(10_000_000) // '$10.00'
 */
export function aiMoney(micros: number, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
  }).format(micros / 1_000_000);
}

const count = (n: number, locale?: string) => n.toLocaleString(locale);
const gb = (bytes: number) => `${Number((bytes / GIB).toFixed(1))} GB`;
const mb = (bytes: number) => `${Number((bytes / MIB).toFixed(1))} MB`;

/** "per month" / "per year". */
export function per(interval: string): string {
  return interval === 'year' ? 'per year' : 'per month';
}

/** A price in words: "$99.00 per month"; null when Stripe gave no amount. */
export function priceText(
  price: Pick<
    TenantPlanPriceResponseDto,
    'unitAmount' | 'currency' | 'interval'
  >,
  locale?: string,
): string | null {
  if (price.unitAmount === null || !price.currency) return null;
  return `${money(price.unitAmount, price.currency, locale)} ${per(price.interval)}`;
}

/** A plan's price at an interval, if it has one. */
export function priceAt(
  plan: TenantPlanResponseDto,
  interval: Interval,
): TenantPlanPriceResponseDto | undefined {
  return plan.prices.find((price) => price.interval === interval);
}

/** The deck's grant lines, in its order. Free's are the first four. */
export function grantLines(grants: Grants, locale?: string): string[] {
  const lines = [
    `${count(grants.maxAgentSeats, locale)} seats`,
    `${gb(grants.maxStorageBytes)} of document storage`,
    `${aiMoney(grants.monthlyAiTokenBudget, locale)} of AI use a month`,
    grants.aiModelTier === 'QUALITY' ? 'Quality AI model' : 'Fast AI model',
  ];
  if (
    grants.maxDocumentBytes === undefined ||
    grants.maxAttachmentBytes === undefined ||
    grants.maxDocumentUploads === undefined ||
    grants.maxAnalyticsRangeDays === undefined
  ) {
    return lines;
  }
  return [
    ...lines,
    `Documents up to ${mb(grants.maxDocumentBytes)}, attachments up to ${mb(grants.maxAttachmentBytes)}`,
    `${count(grants.maxDocumentUploads, locale)} documents`,
    `Analytics ranges up to ${grants.maxAnalyticsRangeDays} days`,
  ];
}

/** Which way a grant moves against the plan held now. */
export type Direction = 'more' | 'less' | 'same';

const MODEL_RANK: Record<string, number> = { FAST: 0, QUALITY: 1 };

/**
 * Each grant's direction against the current plan, line for line with
 * {@link grantLines}. A grant the current plan doesn't state (Free's document
 * limits) reads "same": there's nothing to compare it with.
 */
export function directions(plan: Grants, current: Grants): Direction[] {
  const compare = (a?: number, b?: number): Direction =>
    a === undefined || b === undefined || a === b
      ? 'same'
      : a > b
        ? 'more'
        : 'less';
  const lines: Direction[] = [
    compare(plan.maxAgentSeats, current.maxAgentSeats),
    compare(plan.maxStorageBytes, current.maxStorageBytes),
    compare(plan.monthlyAiTokenBudget, current.monthlyAiTokenBudget),
    compare(
      MODEL_RANK[plan.aiModelTier ?? 'FAST'],
      MODEL_RANK[current.aiModelTier ?? 'FAST'],
    ),
  ];
  if (plan.maxDocumentBytes === undefined) return lines;
  return [
    ...lines,
    compare(plan.maxDocumentBytes, current.maxDocumentBytes),
    compare(plan.maxDocumentUploads, current.maxDocumentUploads),
    compare(plan.maxAnalyticsRangeDays, current.maxAnalyticsRangeDays),
  ];
}

/**
 * A grant line's accessible name against the current plan: the difference in
 * words, since the arrow is hidden.
 *
 * @example grantLabel('200 seats', 'more', 'Pro') // '200 seats, more than Pro'
 */
export function grantLabel(
  line: string,
  direction: Direction,
  current: string,
  isModel = false,
): string {
  if (direction === 'same') return `${line}, the same as ${current}`;
  if (isModel) {
    return `${line}, ${direction === 'more' ? 'better than' : 'simpler than'} ${current}`;
  }
  return `${line}, ${direction === 'more' ? 'more' : 'fewer'} than ${current}`;
}

/** One row of the comparison in a confirmation: "Seats 25 → 200". */
export type ComparisonRow = {
  label: string;
  from: string;
  to: string;
  /** No arrow on Price, and none when the value doesn't change. */
  direction: Direction | null;
};

/**
 * The comparison a confirmation shows: only rows both plans have, so Free
 * against a sold plan compares five (price and its four grants).
 */
export function comparison(
  from: Grants & { price: string },
  to: Grants & { price: string },
  locale?: string,
): ComparisonRow[] {
  const rows: ComparisonRow[] = [
    { label: 'Price', from: from.price, to: to.price, direction: null },
  ];
  const add = (
    label: string,
    a: number | undefined,
    b: number | undefined,
    show: (n: number) => string,
  ) => {
    if (a === undefined || b === undefined) return;
    rows.push({
      label,
      from: show(a),
      to: show(b),
      direction: a === b ? 'same' : b > a ? 'more' : 'less',
    });
  };
  add('Seats', from.maxAgentSeats, to.maxAgentSeats, (n) => count(n, locale));
  add('Storage', from.maxStorageBytes, to.maxStorageBytes, gb);
  add(
    'AI use a month',
    from.monthlyAiTokenBudget,
    to.monthlyAiTokenBudget,
    (n) => aiMoney(n, locale),
  );
  add(
    'AI model',
    MODEL_RANK[from.aiModelTier ?? 'FAST'],
    MODEL_RANK[to.aiModelTier ?? 'FAST'],
    (n) => (n === 1 ? 'Quality' : 'Fast'),
  );
  add('Largest document', from.maxDocumentBytes, to.maxDocumentBytes, mb);
  add('Documents', from.maxDocumentUploads, to.maxDocumentUploads, (n) =>
    count(n, locale),
  );
  add(
    'Analytics range',
    from.maxAnalyticsRangeDays,
    to.maxAnalyticsRangeDays,
    (n) => `${n} days`,
  );
  return rows;
}

/** What a plan card's button offers, or null for none. */
export type PlanAction =
  | { kind: 'current' }
  | { kind: 'switch'; to: Interval }
  | { kind: 'upgrade' }
  | { kind: 'change' }
  | { kind: 'choose' };

/**
 * The button a plan card shows: Choose on Free, Current plan or Switch on the
 * plan held, Upgrade to a bigger one and Change to a smaller. "Bigger" is by
 * seats, then storage, as the server orders the plans.
 */
export function planAction(
  plan: TenantPlanResponseDto,
  interval: Interval,
  subscription: Pick<
    SubscriptionResponseDto,
    'stripeSubscriptionId' | 'priceId'
  >,
  current: Grants,
): PlanAction {
  if (!subscription.stripeSubscriptionId) return { kind: 'choose' };
  const isCurrent = plan.prices.some(
    (price) => price.stripePriceId === subscription.priceId,
  );
  if (isCurrent) {
    const held = plan.prices.find(
      (price) => price.stripePriceId === subscription.priceId,
    );
    return held?.interval === interval
      ? { kind: 'current' }
      : { kind: 'switch', to: interval };
  }
  const bigger =
    plan.maxAgentSeats !== current.maxAgentSeats
      ? plan.maxAgentSeats > current.maxAgentSeats
      : plan.maxStorageBytes > current.maxStorageBytes;
  return { kind: bigger ? 'upgrade' : 'change' };
}

/** What the organization uses today, as far as the page can tell. */
export type InUse = {
  people: number | null;
  storageBytes: number | null;
  documents: number | null;
};

/**
 * The limits a plan is too small for, from what the page knows; the server's
 * refusal has the last word.
 */
export function tooSmall(plan: Grants, inUse: InUse): OverLimit[] {
  const items: OverLimit[] = [];
  if (inUse.people !== null && inUse.people > plan.maxAgentSeats) {
    items.push({
      dimension: 'SEATS',
      inUse: inUse.people,
      allowed: plan.maxAgentSeats,
    });
  }
  if (
    inUse.storageBytes !== null &&
    inUse.storageBytes > plan.maxStorageBytes
  ) {
    items.push({
      dimension: 'STORAGE',
      inUse: inUse.storageBytes,
      allowed: plan.maxStorageBytes,
    });
  }
  if (
    inUse.documents !== null &&
    plan.maxDocumentUploads !== undefined &&
    inUse.documents > plan.maxDocumentUploads
  ) {
    items.push({
      dimension: 'DOCUMENTS',
      inUse: inUse.documents,
      allowed: plan.maxDocumentUploads,
    });
  }
  return items;
}

/**
 * One broken limit as the deck says it, in the card (short) or in the
 * server's refusal (with what to do).
 *
 * @example overLimitSentence({ dimension: 'SEATS', inUse: 18, allowed: 5 }, 'Starter', true)
 * // 'You have 18 people; Starter allows 5. Remove 13, or choose another plan.'
 */
export function overLimitSentence(
  item: OverLimit,
  plan: string,
  withFix = false,
  locale?: string,
): string {
  const over = item.inUse - item.allowed;
  switch (item.dimension) {
    case 'SEATS':
      return `You have ${count(item.inUse, locale)} people; ${plan} allows ${count(item.allowed, locale)}.${withFix ? ` Remove ${count(over, locale)}, or choose another plan.` : ''}`;
    case 'DOCUMENTS':
      return `You have ${count(item.inUse, locale)} documents; ${plan} allows ${count(item.allowed, locale)}.${withFix ? ` Delete ${count(over, locale)}, or choose another plan.` : ''}`;
    case 'STORAGE':
      return `You use ${gbNumber(item.inUse)} GB of storage; ${plan} allows ${gbNumber(item.allowed)} GB.${withFix ? ` Free up ${gbNumber(over)} GB, or choose another plan.` : ''}`;
  }
}

/** Gigabytes to one decimal, without the unit. */
function gbNumber(bytes: number): string {
  return String(Number((bytes / GIB).toFixed(1)));
}

/** Where an over-limit item is fixed. */
export function fixFor(item: OverLimit): { label: string; href: string } {
  return item.dimension === 'SEATS'
    ? { label: 'Go to People', href: '/settings/people' }
    : { label: 'Go to Documents', href: '/knowledge/documents' };
}
