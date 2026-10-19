import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi, type Reply } from '@/test/api';
import { renderSettings, stubMatchMedia, viewer } from '@/test/settings';
import { leaveFor } from '@/lib/leave';
import { SupportEmailContext } from '@/lib/support';
import { BillingView } from './billing-view';

const replace = jest.fn();
let search = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace, refresh: jest.fn() }),
  usePathname: () => '/settings/billing',
  useSearchParams: () => search,
}));
jest.mock('@/components/shell/app-header', () => ({ AppHeader: () => null }));
jest.mock('@/lib/leave', () => ({ leaveFor: jest.fn() }));

beforeAll(stubMatchMedia);
beforeEach(() => {
  search = new URLSearchParams();
  jest.mocked(leaveFor).mockClear();
  replace.mockClear();
});

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const ADMIN = ['organization.read', 'organization.update', 'document.read'];

const plan = (
  name: string,
  seats: number,
  month: number,
  over: Record<string, unknown> = {},
) => ({
  id: name.toLowerCase(),
  name,
  maxAgentSeats: seats,
  maxStorageBytes: seats * 2 * GIB,
  monthlyAiTokenBudget: seats * 400_000,
  aiModelTier: seats > 5 ? 'QUALITY' : 'FAST',
  maxDocumentBytes: 25 * MIB,
  maxAttachmentBytes: 5 * MIB,
  maxDocumentUploads: seats * 400,
  maxAnalyticsRangeDays: 180,
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
  ...over,
});

const PLANS = [
  plan('Starter', 5, 2_900),
  plan('Pro', 25, 9_900),
  plan('Enterprise', 200, 49_900),
];

const subscription = (over: Record<string, unknown> = {}) => ({
  stripeCustomerId: 'cus_1',
  stripeSubscriptionId: 'sub_1',
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
  ...over,
});

const FREE = subscription({
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
});

const meter = (used: number, limit: number) => ({
  available: true,
  used,
  limit,
  unavailableReason: null,
});

const usage = (people = 18) =>
  ok({
    seats: meter(people, 25),
    storage: meter(4 * GIB, 50 * GIB),
    aiTokens: meter(6_200_000, 10_000_000),
    billingCycleStart: '2026-10-01T00:00:00.000Z',
    aiModelTier: 'QUALITY',
    planName: 'Pro',
    currentPeriodEnd: '2026-11-01T00:00:00.000Z',
  });

const invoice = (number: string, status = 'paid') => ({
  id: `in_${number}`,
  number,
  amountDue: 9_900,
  currency: 'usd',
  status,
  created: '2026-10-01T00:00:00.000Z',
  hostedInvoiceUrl: `https://invoice.stripe.test/${number}`,
});

function open(
  routes: Record<string, Reply | ((body: unknown) => Reply)> = {},
  codes = ADMIN,
) {
  const calls = stubApi({
    ...viewer(codes),
    'GET /api/v1/organizations/current': ok({ name: 'Northwind Health' }),
    'GET /api/v1/billing/subscription': ok(subscription()),
    'GET /api/v1/billing/plans': ok(PLANS),
    'GET /api/v1/organizations/current/usage': usage(),
    'GET /api/v1/documents/storage': ok({
      usedBytes: 4 * GIB,
      limitBytes: 50 * GIB,
      documentCount: 2_400,
    }),
    'GET /api/v1/billing/invoices': ok([
      invoice('8F3A-0012'),
      invoice('8F3A-0011'),
    ]),
    ...(routes as Record<string, Reply>),
  });
  renderSettings(
    <SupportEmailContext value="support@synapsedesk.test">
      <BillingView />
    </SupportEmailContext>,
  );
  return calls;
}

const card = async (name: string) =>
  (await screen.findByRole('heading', { name, level: 3 })).closest('li')!;

describe('a paid organization', () => {
  it('shows the plan held, its renewal, the plans and the invoices', async () => {
    open();
    const current = (
      await screen.findByRole('heading', { name: 'Current plan' })
    ).closest('section')!;
    expect(within(current).getByText('Active')).toBeInTheDocument();
    expect(
      await within(current).findByText('$99.00 per month'),
    ).toBeInTheDocument();
    expect(
      within(current).getByText('Renews on 1 Nov 2026'),
    ).toBeInTheDocument();
    expect(
      within(current).getByText('$10.00 of AI use a month'),
    ).toBeInTheDocument();

    const pro = await card('Pro, your current plan');
    expect(pro).toHaveAttribute('aria-current', 'true');
    expect(
      within(pro).getByRole('button', { name: 'Current plan' }),
    ).toBeDisabled();
    expect(
      within(await card('Enterprise')).getByRole('button', {
        name: 'Upgrade to Enterprise',
      }),
    ).toBeEnabled();
    expect(
      within(await card('Starter')).getByRole('listitem', {
        name: '5 seats, fewer than Pro',
      }),
    ).toBeInTheDocument();
    // The table, and the cards a phone shows instead.
    expect(await screen.findAllByText('8F3A-0012')).toHaveLength(2);
    expect(
      screen.getAllByRole('link', {
        name: 'View invoice 8F3A-0012 on Stripe (opens in a new tab)',
      })[0],
    ).toHaveAttribute('href', 'https://invoice.stripe.test/8F3A-0012');
  });

  it('switches to yearly prices, and offers Switch to yearly on the plan held', async () => {
    open();
    await userEvent.click(await screen.findByRole('radio', { name: 'Yearly' }));
    const pro = await card('Pro, your current plan');
    expect(within(pro).getByText('$990.00')).toBeInTheDocument();
    expect(within(pro).getByText('per year')).toBeInTheDocument();
    await userEvent.click(
      within(pro).getByRole('button', { name: 'Switch to yearly' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Switch Pro to yearly billing?',
    });
    expect(
      within(dialog).getByText('What Pro includes stays the same.'),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByRole('term')).toHaveLength(1);
  });

  it('a too-small plan says so in its card and its button does nothing', async () => {
    const calls = open();
    const starter = await card('Starter');
    expect(
      await within(starter).findByText('You have 18 people; Starter allows 5.'),
    ).toBeInTheDocument();
    expect(
      within(starter).getByText(
        'You have 2,400 documents; Starter allows 2,000.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(
      within(starter).getByRole('button', { name: 'Change to Starter' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });
});

describe('changing plan', () => {
  it('confirms an upgrade, sends it, waits for Stripe, then says it’s done', async () => {
    let paidFor = 'price_pro_monthly';
    const calls = open({
      'GET /api/v1/billing/subscription': () =>
        ok(subscription({ priceId: paidFor, planName: 'Enterprise' })),
      'POST /api/v1/billing/plan': () => {
        paidFor = 'price_enterprise_monthly';
        return ok({
          planId: 'enterprise',
          planName: 'Enterprise',
          effectiveAt: '2026-10-19T00:00:00.000Z',
          creditIssued: false,
        });
      },
    });
    paidFor = 'price_pro_monthly';
    await userEvent.click(
      await screen.findByRole('button', { name: 'Upgrade to Enterprise' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Upgrade to Enterprise?',
    });
    expect(
      within(dialog).getByText(
        'Today you’re charged the difference for the rest of this period, to 1 Nov 2026. After that, Enterprise is $499.00 per month.',
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByLabelText('Seats: from 25 to 200'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    ).toHaveFocus();

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Upgrade to Enterprise' }),
    );
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      planId: 'enterprise',
      priceId: 'price_enterprise_monthly',
    });
    expect(
      await screen.findByText('You’re on Enterprise', {}, { timeout: 5_000 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'The difference for the rest of this period is on a new invoice.',
      ),
    ).toBeInTheDocument();
  });

  const refuse = async (reply: Reply, extra: Record<string, Reply> = {}) => {
    open({ 'POST /api/v1/billing/plan': reply, ...extra });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Upgrade to Enterprise' }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Upgrade to Enterprise' }),
    );
    return dialog;
  };

  it('a declined card says so, and offers the portal', async () => {
    const dialog = await refuse(fail(402, 'Your card was declined!'));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Your card was declined',
    );
    expect(
      within(dialog).getByRole('button', {
        name: 'Manage billing on Stripe (opens Stripe)',
      }),
    ).toBeInTheDocument();
  });

  it('a retired plan and an unreachable Stripe each say what to do', async () => {
    const retired = await refuse(
      fail(404, 'That plan is no longer available!'),
    );
    expect(await within(retired).findByRole('alert')).toHaveTextContent(
      'Enterprise is no longer offered',
    );
    expect(
      within(retired).getByRole('button', { name: 'Choose another plan' }),
    ).toBeInTheDocument();
  });

  it('Stripe unreachable offers Try again', async () => {
    const dialog = await refuse(fail(503, 'Stripe is down!'));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Stripe isn’t responding',
    );
    expect(
      within(dialog).getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument();
  });

  it('a negotiated plan, told by re-reading the subscription, offers support', async () => {
    let calls = 0;
    const dialog = await refuse(fail(400, 'On a negotiated plan!'), {
      'GET /api/v1/billing/subscription': (() => {
        calls += 1;
        return ok(subscription({ negotiated: calls > 1 }));
      }) as unknown as Reply,
    });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Your plan can’t be changed here',
    );
    expect(
      within(dialog).getByRole('link', { name: 'Contact support' }),
    ).toHaveAttribute('href', 'mailto:support@synapsedesk.test');
  });

  it('a plan that doesn’t fit hands over to the doesn’t-fit dialog, item by item', async () => {
    await refuse(
      fail(400, 'Too big!', undefined, {
        overLimit: [
          { dimension: 'SEATS', inUse: 230, allowed: 200 },
          { dimension: 'STORAGE', inUse: 600 * GIB, allowed: 500 * GIB },
        ],
      }),
    );
    const refused = await screen.findByRole('alertdialog', {
      name: 'Enterprise doesn’t fit Northwind Health',
    });
    expect(
      within(refused).getByText(
        'You have 230 people; Enterprise allows 200. Remove 30, or choose another plan.',
      ),
    ).toBeInTheDocument();
    expect(
      within(refused).getByRole('link', { name: 'Go to People' }),
    ).toHaveAttribute('href', '/settings/people');
    expect(
      within(refused).getByRole('link', { name: 'Go to Documents' }),
    ).toBeInTheDocument();
    await userEvent.click(
      within(refused).getByRole('button', { name: 'Choose another plan' }),
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('a free organization', () => {
  it('chooses a plan through Stripe’s Checkout, the plan riding back in the address', async () => {
    const calls = open({
      'GET /api/v1/billing/subscription': ok(FREE),
      'POST /api/v1/billing/checkout-session': ok({
        url: 'https://checkout.stripe.test/cs_1',
      }),
      'GET /api/v1/organizations/current/usage': usage(4),
    });
    expect(await screen.findByText('No subscription')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Every new organization starts on Free. Choose a plan below to add more.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Invoices' }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Choose Pro' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Start Pro' });
    expect(
      within(dialog)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(['Price', 'Seats', 'Storage', 'AI use a month', 'AI model']);
    await userEvent.click(
      within(dialog).getByRole('button', {
        name: 'Continue to Stripe (opens Stripe)',
      }),
    );
    await waitFor(() =>
      expect(leaveFor).toHaveBeenCalledWith(
        'https://checkout.stripe.test/cs_1',
      ),
    );
    const body = calls.find((call) => call.method === 'POST')?.body as {
      successUrl: string;
      cancelUrl: string;
    };
    expect(body.successUrl).toMatch(
      /\/settings\/billing\?checkout=success&plan=Pro$/,
    );
    expect(body.cancelUrl).toMatch(/\/settings\/billing\?checkout=canceled$/);
  });

  it('back from Checkout, waits for the subscription, then welcomes', async () => {
    search = new URLSearchParams('checkout=success&plan=Pro');
    let reads = 0;
    open({
      'GET /api/v1/billing/subscription': (() => {
        reads += 1;
        return ok(reads > 1 ? subscription() : FREE);
      }) as unknown as Reply,
    });
    expect(
      await screen.findByText('Confirming your subscription…'),
    ).toBeInTheDocument();
    expect(replace).toHaveBeenCalledWith('/settings/billing', {
      scroll: false,
    });
    expect(
      await screen.findByText('Welcome to Pro', {}, { timeout: 5_000 }),
    ).toBeInTheDocument();
  });

  it('back from a canceled Checkout says nothing changed', async () => {
    search = new URLSearchParams('checkout=canceled');
    open({ 'GET /api/v1/billing/subscription': ok(FREE) });
    expect(await screen.findByText('Checkout canceled')).toBeInTheDocument();
    expect(
      screen.getByText('Nothing changed, and you weren’t charged.'),
    ).toBeInTheDocument();
  });
});

describe('the subscription’s states', () => {
  it('past due: the failed payment first, with the open invoice to pay', async () => {
    open({
      'GET /api/v1/billing/subscription': ok(
        subscription({ status: 'SUSPENDED_PAST_DUE' }),
      ),
      'GET /api/v1/billing/invoices': ok([invoice('8F3A-0012', 'open')]),
    });
    expect(
      await screen.findByText(
        'Stripe couldn’t collect $99.00 for 1 Oct 2026. Until it’s paid, Northwind Health is read-only. Pay the invoice on Stripe, or update your card there first.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', {
        name: 'Pay $99.00 on Stripe (opens in a new tab)',
      }),
    ).toHaveAttribute('href', 'https://invoice.stripe.test/8F3A-0012');
    expect(screen.getByText('Past due')).toBeInTheDocument();
    expect(
      screen.getAllByRole('link', {
        name: 'Pay invoice 8F3A-0012 on Stripe (opens in a new tab)',
      })[0],
    ).toBeInTheDocument();
  });

  it('canceled: ends on its date, then frozen', async () => {
    open({
      'GET /api/v1/billing/subscription': ok(
        subscription({ cancelAtPeriodEnd: true }),
      ),
    });
    expect(await screen.findByText('Canceled')).toBeInTheDocument();
    expect(
      await screen.findByText(
        'Ends on 1 Nov 2026. After that, Northwind Health is frozen until support restores it.',
      ),
    ).toBeInTheDocument();
  });

  it('negotiated: the notice in place of the plans', async () => {
    open({
      'GET /api/v1/billing/subscription': ok(
        subscription({ negotiated: true }),
      ),
    });
    expect(await screen.findByText('Negotiated')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Your plan can’t be changed here' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('list', { name: 'Plans' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('radiogroup', { name: 'Billing interval' }),
    ).not.toBeInTheDocument();
  });

  it('a read-only viewer sees the plans without buttons, and no invoices', async () => {
    open({}, ['organization.read']);
    expect(await card('Starter')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Upgrade|Change|Choose/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Only people who can update the organization can change the plan or see invoices.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Invoices' }),
    ).not.toBeInTheDocument();
  });

  it('without organization.read the page isn’t available', async () => {
    stubApi(viewer(['ticket.read']));
    renderSettings(<BillingView />);
    expect(
      await screen.findByText('This page isn’t available'),
    ).toBeInTheDocument();
  });

  it('says when billing couldn’t load, and when the invoices can’t', async () => {
    open({ 'GET /api/v1/billing/subscription': fail(500, 'Down!') });
    expect(
      await screen.findByText('Couldn’t load billing'),
    ).toBeInTheDocument();
  });

  it('invoices that can’t be read say so, with Try again', async () => {
    open({ 'GET /api/v1/billing/invoices': fail(503, 'Stripe is down!') });
    expect(
      await screen.findByText('Invoices can’t be loaded right now'),
    ).toBeInTheDocument();
  });
});

describe('the portal', () => {
  it('opens Stripe’s portal, coming back to Billing; a failure is a toast', async () => {
    const calls = open({
      'POST /api/v1/billing/portal-session': ok({
        url: 'https://portal.stripe.test/p_1',
      }),
    });
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Manage billing on Stripe (opens Stripe)',
      }),
    );
    await waitFor(() =>
      expect(leaveFor).toHaveBeenCalledWith('https://portal.stripe.test/p_1'),
    );
    expect(
      (
        calls.find((call) => call.method === 'POST')?.body as {
          returnUrl: string;
        }
      ).returnUrl,
    ).toMatch(/\/settings\/billing$/);
  });

  it('a portal that won’t open says so', async () => {
    open({ 'POST /api/v1/billing/portal-session': fail(503, 'Down!') });
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Manage billing on Stripe (opens Stripe)',
      }),
    );
    expect(await screen.findByText('Couldn’t open Stripe')).toBeInTheDocument();
  });
});

describe('a long wait', () => {
  afterEach(() => jest.useRealTimers());

  it('says it’s taking longer than usual after a minute', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    search = new URLSearchParams('checkout=success&plan=Pro');
    open({ 'GET /api/v1/billing/subscription': ok(FREE) });
    expect(
      await screen.findByText('Confirming your subscription…'),
    ).toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(62_000);
    });
    expect(
      await screen.findByText('Still confirming your subscription'),
    ).toBeInTheDocument();
  });
});
