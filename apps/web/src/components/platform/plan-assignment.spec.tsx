import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi } from '@/test/api';
import { renderSettings, stubMatchMedia } from '@/test/settings';
import { planLabel } from './organization-view';
import { AssignPlanDialog, ReleasePlanDialog } from './plan-assignment-dialogs';

beforeAll(stubMatchMedia);

const ORG = 'org-1';
const SUBJECT = { id: ORG, name: 'Quarry Labs' };
const URL_PLAN = `/api/v1/platform/organizations/${ORG}/plan`;
const plan = (id: string, name: string, extra: object = {}) => ({
  id,
  name,
  stripeProductId: null,
  isActive: true,
  ...extra,
});
const PLANS = ok({
  items: [
    plan('plan-free', 'Free'),
    plan('plan-pro', 'Pro', { stripeProductId: 'prod_pro' }),
    plan('plan-river', 'Riverside agreement'),
    plan('plan-old', 'Old agreement', { isActive: false }),
  ],
  meta: {
    currentPage: 1,
    itemsPerPage: 100,
    totalItems: 4,
    totalPages: 1,
    itemCount: 4,
  },
});
const projection = (overLimit: boolean) =>
  ok({
    subscribers: [
      {
        organizationId: ORG,
        organizationName: 'Quarry Labs',
        changes: { maxAgentSeats: '30 -> 25' },
        after: { maxAgentSeats: 25 },
        overLimit: [],
        overLimitItems: overLimit
          ? [{ dimension: 'SEATS', inUse: 31, allowed: 25 }]
          : [],
        skippedPinned: false,
        budgetDeferred: false,
      },
    ],
  });

describe('assigning a plan', () => {
  it('offers only negotiated plans, previews, needs a reason, then assigns', async () => {
    const calls = stubApi({
      'GET /api/v1/platform/plans': PLANS,
      [`POST ${URL_PLAN}`]: (_body, url) => projection(url.includes('dryRun')),
    });
    const onAssigned = jest.fn();
    renderSettings(
      <AssignPlanDialog
        organization={SUBJECT}
        open
        onOpenChange={() => undefined}
        onAssigned={onAssigned}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('combobox', { name: 'Plan' }));
    expect(
      await screen.findByRole('option', {
        name: 'Old agreement (not offered)',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Free' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Pro' })).toBeNull();
    await user.click(
      screen.getByRole('option', { name: 'Riverside agreement' }),
    );

    expect(await screen.findByText('Seats 30 → 25')).toBeInTheDocument();
    expect(
      screen.getByText('Quarry Labs will be over a limit after this'),
    ).toBeInTheDocument();

    const assign = screen.getByRole('button', {
      name: 'Assign Riverside agreement',
    });
    await user.click(assign);
    expect(
      await screen.findByText('A reason is required.'),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText('Reason'), 'Signed agreement');
    await user.click(assign);
    await waitFor(() => expect(onAssigned).toHaveBeenCalled());
    const sent = calls.filter(
      (call) => call.method === 'POST' && !call.url.includes('dryRun'),
    );
    expect(sent.map((call) => call.body)).toEqual([
      { planId: 'plan-river', reason: 'Signed agreement' },
    ]);
  });

  it('shows a refused preview in the server’s words', async () => {
    stubApi({
      'GET /api/v1/platform/plans': PLANS,
      [`POST ${URL_PLAN}`]: fail(
        409,
        'Cancel its Stripe subscription first; it would keep charging for its old plan!',
      ),
    });
    renderSettings(
      <AssignPlanDialog
        organization={SUBJECT}
        open
        onOpenChange={() => undefined}
        onAssigned={jest.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Plan' }));
    await user.click(
      await screen.findByRole('option', { name: 'Riverside agreement' }),
    );
    expect(
      await screen.findByText(
        'Cancel its Stripe subscription first; it would keep charging for its old plan.',
      ),
    ).toBeInTheDocument();
  });
});

describe('releasing to self-service', () => {
  it('previews the free tier, needs a reason, and shows a refusal', async () => {
    let answer = fail(409, 'It isn’t on an assigned plan!');
    const calls = stubApi({
      [`DELETE ${URL_PLAN}`]: (_body, url) =>
        url.includes('dryRun') ? projection(false) : answer,
    });
    const onReleased = jest.fn();
    renderSettings(
      <ReleasePlanDialog
        organization={SUBJECT}
        planName="Riverside agreement"
        open
        onOpenChange={() => undefined}
        onReleased={onReleased}
      />,
    );
    const user = userEvent.setup();

    expect(await screen.findByText('Seats 30 → 25')).toBeInTheDocument();
    const release = screen.getByRole('button', { name: 'Release Quarry Labs' });
    await user.click(release);
    expect(
      await screen.findByText('A reason is required.'),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText('Reason'), 'Agreement ended');
    await user.click(release);
    expect(
      await screen.findByText('It isn’t on an assigned plan.'),
    ).toBeInTheDocument();

    answer = projection(false);
    await user.click(release);
    await waitFor(() => expect(onReleased).toHaveBeenCalled());
    expect(calls.at(-1)?.body).toEqual({ reason: 'Agreement ended' });
  });
});

describe('planLabel', () => {
  it.each([
    [
      { planName: null, billedThroughStripe: false, planAssigned: false },
      'Free',
    ],
    [
      { planName: 'Pro', billedThroughStripe: true, planAssigned: false },
      'Pro (Stripe)',
    ],
    [
      { planName: 'Riverside', billedThroughStripe: false, planAssigned: true },
      'Riverside (assigned)',
    ],
    [
      { planName: 'Free', billedThroughStripe: false, planAssigned: false },
      'Free',
    ],
  ])('%j reads %s', (data, label) => {
    expect(planLabel(data)).toBe(label);
  });
});
