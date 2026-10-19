import type { TenantPlanResponseDto } from '@synapsedesk/api-client';
import {
  aiMoney,
  comparison,
  directions,
  fixFor,
  grantLabel,
  grantLines,
  money,
  overLimitSentence,
  planAction,
  priceText,
  tooSmall,
  type Grants,
} from './billing';

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

const plan = (
  name: string,
  seats: number,
  over: Partial<TenantPlanResponseDto> = {},
): TenantPlanResponseDto => ({
  id: name.toLowerCase(),
  name,
  maxAgentSeats: seats,
  maxStorageBytes: seats * 2 * GIB,
  monthlyAiTokenBudget: seats * 400_000,
  aiModelTier: seats > 5 ? 'QUALITY' : 'FAST',
  maxDocumentBytes: 25 * MIB,
  maxAttachmentBytes: 5 * MIB,
  maxDocumentUploads: 10_000,
  maxAnalyticsRangeDays: 180,
  prices: [
    {
      stripePriceId: `price_${name}_m`,
      interval: 'month',
      unitAmount: seats * 400,
      currency: 'usd',
    },
    {
      stripePriceId: `price_${name}_y`,
      interval: 'year',
      unitAmount: seats * 4_000,
      currency: 'usd',
    },
  ],
  ...over,
});

const FREE: Grants = {
  name: 'Free',
  maxAgentSeats: 10,
  maxStorageBytes: 5 * GIB,
  monthlyAiTokenBudget: 1_000_000,
  aiModelTier: 'FAST',
};

describe('money', () => {
  it('reads the smallest unit by the currency’s own digits', () => {
    expect(money(9_900, 'usd', 'en-US')).toBe('$99.00');
    expect(money(9_900, 'jpy', 'en-US')).toBe('¥9,900');
    expect(aiMoney(10_000_000, 'en-US')).toBe('$10.00');
  });

  it('says a price with its interval, or nothing without an amount', () => {
    expect(
      priceText(
        { unitAmount: 99_000, currency: 'usd', interval: 'year' },
        'en-US',
      ),
    ).toBe('$990.00 per year');
    expect(
      priceText({ unitAmount: null, currency: null, interval: 'month' }),
    ).toBeNull();
  });
});

describe('grants', () => {
  it('lists seven for a sold plan and four for Free, in the deck’s order', () => {
    expect(grantLines(plan('Pro', 25), 'en-US')).toEqual([
      '25 seats',
      '50 GB of document storage',
      '$10.00 of AI use a month',
      'Quality AI model',
      'Documents up to 25 MB, attachments up to 5 MB',
      '10,000 documents',
      'Analytics for the last 180 days',
    ]);
    expect(grantLines(FREE, 'en-US')).toHaveLength(4);
  });

  it('compares each grant with the plan held, and says it in words', () => {
    const pro = plan('Pro', 25);
    const starter = plan('Starter', 5, { maxAnalyticsRangeDays: 30 });
    expect(directions(starter, pro)).toEqual([
      'less',
      'less',
      'less',
      'less',
      'same',
      'same',
      'less',
    ]);
    expect(directions(pro, FREE).slice(0, 4)).toEqual([
      'more',
      'more',
      'more',
      'more',
    ]);
    expect(grantLabel('5 seats', 'less', 'Pro')).toBe(
      '5 seats, fewer than Pro',
    );
    expect(grantLabel('Quality AI model', 'more', 'Free', true)).toBe(
      'Quality AI model, better than Free',
    );
    expect(grantLabel('25 seats', 'same', 'Pro')).toBe(
      '25 seats, the same as Pro',
    );
  });
});

describe('the comparison', () => {
  it('compares only the rows both plans have: Free against Pro is five', () => {
    const rows = comparison(
      { ...FREE, price: 'Free' },
      { ...plan('Pro', 25), price: '$99.00 per month' },
      'en-US',
    );
    expect(
      rows.map((row) => [row.label, row.from, row.to, row.direction]),
    ).toEqual([
      ['Price', 'Free', '$99.00 per month', null],
      ['Seats', '10', '25', 'more'],
      ['Storage', '5 GB', '50 GB', 'more'],
      ['AI use a month', '$1.00', '$10.00', 'more'],
      ['AI model', 'Fast', 'Quality', 'more'],
    ]);
  });

  it('has all eight between sold plans, the same value once', () => {
    const rows = comparison(
      { ...plan('Pro', 25), price: 'a' },
      { ...plan('Big', 200), price: 'b' },
      'en-US',
    );
    expect(rows.map((row) => row.label)).toEqual([
      'Price',
      'Seats',
      'Storage',
      'AI use a month',
      'AI model',
      'Largest document',
      'Documents',
      'Analytics history',
    ]);
    expect(rows[4]).toMatchObject({
      from: 'Quality',
      to: 'Quality',
      direction: 'same',
    });
  });
});

describe('the plan button', () => {
  const pro = plan('Pro', 25);
  const held = { stripeSubscriptionId: 'sub', priceId: 'price_Pro_m' };

  it('is Choose on Free, Current plan or Switch on the plan held, Upgrade or Change otherwise', () => {
    expect(
      planAction(
        pro,
        'month',
        { stripeSubscriptionId: null, priceId: null },
        FREE,
      ),
    ).toEqual({ kind: 'choose' });
    expect(planAction(pro, 'month', held, pro)).toEqual({ kind: 'current' });
    expect(planAction(pro, 'year', held, pro)).toEqual({
      kind: 'switch',
      to: 'year',
    });
    expect(planAction(plan('Big', 200), 'month', held, pro)).toEqual({
      kind: 'upgrade',
    });
    expect(planAction(plan('Starter', 5), 'month', held, pro)).toEqual({
      kind: 'change',
    });
  });
});

describe('too small', () => {
  it('names each limit the organization is over, from what the page knows', () => {
    const starter = plan('Starter', 5, { maxDocumentUploads: 1_000 });
    expect(
      tooSmall(starter, { people: 18, storageBytes: 1, documents: 1_240 }),
    ).toEqual([
      { dimension: 'SEATS', inUse: 18, allowed: 5 },
      { dimension: 'DOCUMENTS', inUse: 1_240, allowed: 1_000 },
    ]);
    expect(
      tooSmall(FREE, { people: null, storageBytes: 6 * GIB, documents: 99 }),
    ).toEqual([{ dimension: 'STORAGE', inUse: 6 * GIB, allowed: 5 * GIB }]);
  });

  it('says each in the deck’s words, with the fix on a refusal', () => {
    expect(
      overLimitSentence(
        { dimension: 'SEATS', inUse: 18, allowed: 5 },
        'Starter',
        true,
        'en-US',
      ),
    ).toBe(
      'You have 18 people; Starter allows 5. Remove 13, or choose another plan.',
    );
    expect(
      overLimitSentence(
        { dimension: 'DOCUMENTS', inUse: 1_240, allowed: 1_000 },
        'Starter',
        false,
        'en-US',
      ),
    ).toBe('You have 1,240 documents; Starter allows 1,000.');
    expect(
      overLimitSentence(
        { dimension: 'STORAGE', inUse: 7.5 * GIB, allowed: 5 * GIB },
        'Starter',
        true,
      ),
    ).toBe(
      'You use 7.5 GB of storage; Starter allows 5 GB. Free up 2.5 GB, or choose another plan.',
    );
    expect(fixFor({ dimension: 'SEATS', inUse: 1, allowed: 0 }).href).toBe(
      '/settings/people',
    );
    expect(fixFor({ dimension: 'STORAGE', inUse: 1, allowed: 0 }).label).toBe(
      'Go to Documents',
    );
  });
});
