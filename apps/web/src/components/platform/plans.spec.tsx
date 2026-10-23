import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi } from '@/test/api';
import { renderSettings, stubMatchMedia } from '@/test/settings';
import { PlanApply } from './plan-apply';
import { PlanCreate, PlanEdit } from './plan-form';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: jest.fn() }),
  usePathname: () => '/platform/plans',
}));
jest.mock('@/components/shell/app-header', () => ({ AppHeader: () => null }));

beforeAll(stubMatchMedia);
beforeEach(() => push.mockClear());

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const PLAN = {
  id: 'plan-pro',
  name: 'Pro',
  stripeProductId: 'prod_pro',
  maxAgentSeats: 25,
  maxStorageBytes: 50 * GIB,
  monthlyAiTokenBudget: 10_000_000,
  aiModelTier: 'QUALITY',
  maxDocumentBytes: 25 * MIB,
  maxAttachmentBytes: 5 * MIB,
  maxDocumentUploads: 10_000,
  maxAnalyticsRangeDays: 180,
  isActive: true,
  prices: [
    {
      id: 'p1',
      stripePriceId: 'price_m',
      interval: 'month',
      unitAmount: 9900,
      currency: 'usd',
    },
  ],
  subscriberCount: 17,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-10-22T00:00:00Z',
  deletedAt: null,
};
const URL_PLAN = '/api/v1/platform/plans/plan-pro';

/** Every grant, as the form takes them. */
async function fillGrants(user: ReturnType<typeof userEvent.setup>) {
  for (const [label, value] of [
    ['Seats', '5'],
    ['Document storage (GB)', '10'],
    ['AI allowance a month (USD)', '5'],
    ['Largest document (MB)', '10'],
    ['Largest attachment (MB)', '5'],
    ['Documents', '1000'],
    ['Analytics ranges up to (days)', '90'],
  ]) {
    await user.type(screen.getByLabelText(label), value);
  }
  await user.click(screen.getByLabelText('AI model'));
  await user.click(await screen.findByRole('option', { name: 'Fast' }));
}

describe('a new plan', () => {
  it('needs every grant, then sends them in the API’s units with its prices', async () => {
    const calls = stubApi({
      'POST /api/v1/platform/plans': ok({ ...PLAN, id: 'plan-team' }, 201),
    });
    renderSettings(<PlanCreate />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Name'), 'Team');
    await user.click(screen.getByRole('button', { name: 'Create plan' }));
    expect(screen.getByText('Fill in every grant')).toBeInTheDocument();
    expect(calls).toHaveLength(0);

    await fillGrants(user);
    await user.click(screen.getByRole('button', { name: 'Add a price' }));
    await user.type(screen.getByLabelText('Stripe price 1'), 'price_team');
    await user.click(screen.getByRole('button', { name: 'Add a price' }));
    await user.click(screen.getByRole('button', { name: 'Remove price 2' }));
    await user.click(screen.getByRole('button', { name: 'Create plan' }));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/platform/plans/plan-team'),
    );
    expect(calls[0].body).toEqual({
      name: 'Team',
      isActive: true,
      maxAgentSeats: 5,
      maxStorageBytes: 10 * GIB,
      monthlyAiTokenBudget: 5_000_000,
      maxDocumentBytes: 10 * MIB,
      maxAttachmentBytes: 5 * MIB,
      maxDocumentUploads: 1000,
      maxAnalyticsRangeDays: 90,
      aiModelTier: 'FAST',
      prices: [{ stripePriceId: 'price_team', interval: 'month' }],
    });
  });

  it('says when Stripe doesn’t know a price, or doesn’t answer', async () => {
    let answer = fail(400, 'Stripe has no price price_nope!');
    stubApi({ 'POST /api/v1/platform/plans': () => answer });
    renderSettings(<PlanCreate />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Name'), 'Team');
    await fillGrants(user);
    await user.click(screen.getByRole('button', { name: 'Create plan' }));
    expect(
      await screen.findByText(
        'Stripe has no price price_nope, or it has no single amount. Check its id in Stripe.',
      ),
    ).toBeInTheDocument();

    answer = fail(
      503,
      'Stripe could not be reached just now. Try again shortly!',
    );
    await user.click(screen.getByRole('button', { name: 'Create plan' }));
    expect(await screen.findByText('Stripe didn’t answer')).toBeInTheDocument();
  });

  it('refuses a grant past the platform’s ceiling', async () => {
    stubApi({});
    renderSettings(<PlanCreate />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Name'), 'Huge');
    await fillGrants(user);
    await user.clear(screen.getByLabelText('Analytics ranges up to (days)'));
    await user.type(
      screen.getByLabelText('Analytics ranges up to (days)'),
      '999',
    );
    await user.click(screen.getByRole('button', { name: 'Create plan' }));
    expect(
      screen.getByText('Required. Up to 400 days, the platform’s ceiling.'),
    ).toBeInTheDocument();
  });
});

describe('a plan’s page', () => {
  it('saves the catalog row, and clears the Stripe product when it’s emptied', async () => {
    const calls = stubApi({
      [`GET ${URL_PLAN}`]: ok(PLAN),
      [`PATCH ${URL_PLAN}`]: ok(PLAN),
    });
    renderSettings(<PlanEdit planId="plan-pro" />);
    const user = userEvent.setup();

    expect(
      await screen.findByText('Saving changes the catalog only'),
    ).toBeInTheDocument();
    expect(screen.getByText('$99.00')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Stripe product (optional)'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Pro is saved')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'PATCH')?.body).toMatchObject({
      name: 'Pro',
      clearStripeProductId: true,
      maxAgentSeats: 25,
    });
  });

  it('can’t retire a plan with subscribers: it deactivates it instead', async () => {
    const calls = stubApi({
      [`GET ${URL_PLAN}`]: ok(PLAN),
      [`PATCH ${URL_PLAN}`]: ok(PLAN),
    });
    renderSettings(<PlanEdit planId="plan-pro" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Retire' }));
    expect(screen.getByText('Pro can’t be retired')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Deactivate Pro' }));
    expect(
      await screen.findByText('Pro is no longer offered'),
    ).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      isActive: false,
    });
  });

  it('a plan nobody is on: a late 409 turns into the refusal', async () => {
    const answer = fail(409, '1 organization(s) are on this plan!');
    stubApi({
      [`GET ${URL_PLAN}`]: ok({ ...PLAN, subscriberCount: 0 }),
      [`DELETE ${URL_PLAN}`]: () => answer,
    });
    renderSettings(<PlanEdit planId="plan-pro" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Retire' }));
    await user.click(screen.getByRole('button', { name: 'Retire Pro' }));
    expect(await screen.findByText('Pro can’t be retired')).toBeInTheDocument();
  });

  it.each([
    [
      1,
      'Pro’s 1 subscriber keeps what it has until you apply it.',
      '1 organization is on it.',
    ],
    [
      2,
      'Pro’s 2 subscribers keep what they have until you apply it.',
      '2 organizations are on it.',
    ],
  ])('%i subscriber(s): the words agree', async (n, kept, onIt) => {
    stubApi({ [`GET ${URL_PLAN}`]: ok({ ...PLAN, subscriberCount: n }) });
    renderSettings(<PlanEdit planId="plan-pro" />);
    const user = userEvent.setup();
    expect(await screen.findByText(kept, { exact: false })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retire' }));
    expect(screen.getByText(onIt, { exact: false })).toBeInTheDocument();
  });

  it('says a plan that isn’t there isn’t available', async () => {
    stubApi({ [`GET ${URL_PLAN}`]: fail(404, 'Not found!') });
    renderSettings(<PlanEdit planId="plan-pro" />);
    expect(
      await screen.findByText('This page isn’t available'),
    ).toBeInTheDocument();
  });
});

describe('applying a plan', () => {
  const projection = (dryRun: boolean) => ({
    subscribers: [
      {
        organizationId: 'org-1',
        organizationName: 'Lumen Schools',
        changes: { maxAgentSeats: '30 -> 25' },
        after: { maxAgentSeats: 25 },
        overLimit: [],
        overLimitItems: [{ dimension: 'SEATS', inUse: 31, allowed: 25 }],
        skippedPinned: false,
        budgetDeferred: false,
      },
      {
        organizationId: 'org-2',
        organizationName: 'Iris Health',
        changes: {},
        after: {},
        overLimit: [],
        overLimitItems: [],
        skippedPinned: true,
        budgetDeferred: false,
      },
    ],
    dryRun,
    changedCount: 1,
    skippedPinnedCount: 1,
    overLimitCount: 1,
    evaluatedDimensions: ['seats'],
  });

  it('previews first, names who’d be over, then applies on confirmation', async () => {
    const calls = stubApi({
      [`GET ${URL_PLAN}`]: ok(PLAN),
      [`POST ${URL_PLAN}/apply`]: (_body, url) =>
        ok(projection(!url.includes('dryRun=false'))),
    });
    renderSettings(<PlanApply planId="plan-pro" />);
    const user = userEvent.setup();

    expect(
      await screen.findByText('Nothing has changed yet'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Checked: seats only; storage and documents couldn’t be read\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('1 organization will be over a limit after this'),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Apply Pro to 1 organization' }),
    );
    await user.click(
      screen
        .getAllByRole('button', { name: 'Apply Pro to 1 organization' })
        .at(-1)!,
    );

    expect(await screen.findByText('Pro is applied')).toBeInTheDocument();
    expect(screen.getAllByText('Changed, over a limit').length).toBeGreaterThan(
      0,
    );
    expect(calls.at(-1)?.url).toContain('dryRun=false');
  });

  it('a preview that can’t be read says so', async () => {
    stubApi({
      [`GET ${URL_PLAN}`]: ok(PLAN),
      [`POST ${URL_PLAN}/apply`]: fail(500, 'Broken!'),
    });
    renderSettings(<PlanApply planId="plan-pro" />);
    expect(
      await screen.findByText('Couldn’t load the preview'),
    ).toBeInTheDocument();
  });
});
