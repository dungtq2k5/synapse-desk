import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi } from '@/test/api';
import { renderSettings, stubMatchMedia } from '@/test/settings';
import { OrganizationCreate } from './organization-create';
import {
  OffboardDialog,
  ResetCycleDialog,
  RestoreDialog,
  StatusDialog,
} from './organization-dialogs';
import { OrganizationEdit } from './organization-edit';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: jest.fn() }),
  usePathname: () => '/platform/organizations',
}));
jest.mock('@/components/shell/app-header', () => ({ AppHeader: () => null }));

beforeAll(stubMatchMedia);
beforeEach(() => push.mockClear());

const GIB = 1024 ** 3;
const ORG = 'org-1';
const DETAIL = {
  organization: {
    id: ORG,
    name: 'Northwind Health',
    slug: 'northwind-health',
    domain: 'northwind.health',
    status: 'ACTIVE',
    enforceTwoFactor: false,
    allowedEmailDomains: [],
    maxAgentSeats: 25,
    maxStorageBytes: 50 * GIB,
    monthlyAiTokenBudget: 10_000_000,
    billingCycleStart: '2026-10-01T00:00:00Z',
    analyticsRangeDays: 180,
    createdAt: '2026-03-02T00:00:00Z',
    updatedAt: '2026-03-02T00:00:00Z',
  },
  userCount: 18,
  pendingInvitationCount: 2,
  departmentCount: 6,
  deletedAt: null,
  planName: 'Pro',
  billedThroughStripe: true,
  entitlementsPinned: false,
  planAssigned: false,
  statusChangedAt: null,
  usage: {},
};
const PRO = {
  id: 'plan-pro',
  name: 'Pro',
  maxAgentSeats: 25,
  maxStorageBytes: 50 * GIB,
  monthlyAiTokenBudget: 10_000_000,
};
const SUBJECT = { id: ORG, name: 'Northwind Health', people: 18 };

describe('editing an organization', () => {
  const routes = (patch = ok(DETAIL)) => ({
    [`GET /api/v1/platform/organizations/${ORG}`]: ok(DETAIL),
    'GET /api/v1/platform/plans': ok({
      items: [PRO],
      meta: {
        currentPage: 1,
        itemsPerPage: 100,
        totalItems: 1,
        totalPages: 1,
        itemCount: 1,
      },
    }),
    [`PATCH /api/v1/platform/organizations/${ORG}`]: patch,
  });

  it('says what the plan grants, and sends only what changed', async () => {
    const calls = stubApi(routes());
    renderSettings(<OrganizationEdit organizationId={ORG} />);
    const user = userEvent.setup();

    expect(await screen.findByText('Pro grants 25.')).toBeInTheDocument();
    expect(screen.getByText('Stripe sets these')).toBeInTheDocument();
    const seats = screen.getByLabelText('Seats');
    await user.clear(seats);
    await user.type(seats, '30');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/platform/organizations/${ORG}`),
    );
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      maxAgentSeats: 30,
    });
  });

  it('pins the limits only when the switch changed', async () => {
    const calls = stubApi(routes());
    renderSettings(<OrganizationEdit organizationId={ORG} />);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole('switch', {
        name: 'Keep these limits when Stripe’s events arrive',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      entitlementsPinned: true,
    });
  });

  it('marks a taken domain under its field', async () => {
    stubApi(
      routes(fail(409, 'That domain is already used by another organization!')),
    );
    renderSettings(<OrganizationEdit organizationId={ORG} />);
    const user = userEvent.setup();

    const domain = await screen.findByLabelText('Domain');
    await user.clear(domain);
    await user.type(domain, 'taken.example');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(
      await screen.findByText(
        'That domain is already used by another organization.',
      ),
    ).toBeInTheDocument();
  });

  it('refuses a seat count that isn’t a whole number, and goes back when nothing changed', async () => {
    const calls = stubApi(routes());
    renderSettings(<OrganizationEdit organizationId={ORG} />);
    const user = userEvent.setup();

    const seats = await screen.findByLabelText('Seats');
    await user.clear(seats);
    await user.type(seats, '2.5');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('Enter a whole number.'),
    ).toBeInTheDocument();

    await user.clear(seats);
    await user.type(seats, '25');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('says an organization that isn’t there isn’t available', async () => {
    stubApi({
      [`GET /api/v1/platform/organizations/${ORG}`]: fail(404, 'Not found!'),
    });
    renderSettings(<OrganizationEdit organizationId={ORG} />);
    expect(
      await screen.findByText('This page isn’t available'),
    ).toBeInTheDocument();
  });
});

describe('the organization’s dialogs', () => {
  it('a status change asks for a reason, then says how many were signed out', async () => {
    const calls = stubApi({
      [`POST /api/v1/platform/organizations/${ORG}/status`]: ok({
        ...DETAIL,
        revokedSessionCount: 4,
      }),
    });
    const onChanged = jest.fn();
    renderSettings(
      <StatusDialog
        organization={SUBJECT}
        status="ACTIVE"
        open
        onOpenChange={() => undefined}
        onChanged={onChanged}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Frozen'));
    await user.click(
      screen.getByRole('button', { name: 'Freeze Northwind Health' }),
    );
    expect(
      await screen.findByText('A reason is required.'),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText('Reason'), 'Chargeback');
    await user.click(
      screen.getByRole('button', { name: 'Freeze Northwind Health' }),
    );

    expect(
      await screen.findByText('4 sessions were signed out.'),
    ).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
    expect(calls[0].body).toEqual({ status: 'FROZEN', reason: 'Chargeback' });
  });

  it('a move the server refuses says it isn’t possible', async () => {
    stubApi({
      [`POST /api/v1/platform/organizations/${ORG}/status`]: fail(
        400,
        'Cannot move a workspace from FROZEN to ACTIVE!',
      ),
    });
    renderSettings(
      <StatusDialog
        organization={SUBJECT}
        status="FROZEN"
        open
        onOpenChange={() => undefined}
        onChanged={() => undefined}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Reason'), 'Resolved');
    await user.click(
      screen.getByRole('button', { name: 'Make Northwind Health Active' }),
    );
    expect(
      await screen.findByText('That status change isn’t possible from Frozen.'),
    ).toBeInTheDocument();
  });

  it('resetting the cycle takes a reason, and a refusal is shown in words', async () => {
    let answer = fail(500, 'Something broke!');
    stubApi({
      [`POST /api/v1/platform/organizations/${ORG}/billing-cycle/reset`]: () =>
        answer,
    });
    const onReset = jest.fn();
    renderSettings(
      <ResetCycleDialog
        organization={SUBJECT}
        allowance="$10.00"
        open
        onOpenChange={() => undefined}
        onReset={onReset}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Reset the cycle' }));
    expect(
      await screen.findByText('A reason is required.'),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText('Reason'), 'Blocked today');
    await user.click(screen.getByRole('button', { name: 'Reset the cycle' }));
    expect(await screen.findByText('Something broke.')).toBeInTheDocument();

    answer = ok(DETAIL);
    await user.click(screen.getByRole('button', { name: 'Reset the cycle' }));
    await waitFor(() => expect(onReset).toHaveBeenCalled());
  });

  it('offboarding needs a reason and the name typed', async () => {
    const calls = stubApi({
      [`DELETE /api/v1/platform/organizations/${ORG}`]: ok({
        revokedSessionCount: 23,
      }),
    });
    const onOffboarded = jest.fn();
    renderSettings(
      <OffboardDialog
        organization={SUBJECT}
        open
        onOpenChange={() => undefined}
        onOffboarded={onOffboarded}
      />,
    );
    const user = userEvent.setup();
    const confirm = screen.getByRole('button', {
      name: 'Offboard Northwind Health',
    });

    await user.click(confirm);
    expect(
      await screen.findByText('A reason is required.'),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Reason'), 'Contract ended');
    await user.click(confirm);
    expect(calls).toHaveLength(0);

    await user.type(
      screen.getByLabelText('Type Northwind Health to confirm'),
      'Northwind Health',
    );
    await user.click(confirm);
    expect(
      await screen.findByText('23 sessions were signed out.'),
    ).toBeInTheDocument();
    expect(onOffboarded).toHaveBeenCalled();
    expect(calls[0].body).toEqual({ reason: 'Contract ended' });
  });

  it('restoring brings it back, and a refusal stays in the dialog', async () => {
    let answer = fail(500, 'Not now!');
    stubApi({
      [`POST /api/v1/platform/organizations/${ORG}/restore`]: () => answer,
    });
    const onRestored = jest.fn();
    renderSettings(
      <RestoreDialog
        organization={SUBJECT}
        open
        onOpenChange={() => undefined}
        onRestored={onRestored}
      />,
    );
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: 'Restore Northwind Health' }),
    );
    expect(await screen.findByText('Not now.')).toBeInTheDocument();
    answer = ok(DETAIL);
    await user.click(
      screen.getByRole('button', { name: 'Restore Northwind Health' }),
    );
    await waitFor(() => expect(onRestored).toHaveBeenCalled());
  });
});

describe('creating an organization', () => {
  const fill = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByLabelText('Name'), 'Cedar Clinic');
    await user.type(screen.getByLabelText('Address'), 'cedar-clinic');
    await user.type(screen.getByLabelText('Full name'), 'Dana Ortiz');
    await user.type(screen.getByLabelText('Email'), 'dana@cedar.test');
  };

  it('checks each field before sending', async () => {
    const calls = stubApi({});
    renderSettings(<OrganizationCreate />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Address'), 'Not An Address');
    await user.type(screen.getByLabelText('Document storage'), 'lots');
    await user.click(
      screen.getByRole('button', { name: 'Create organization' }),
    );

    expect(
      screen.getByText('Lowercase letters, digits and hyphens only.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Enter a number of GB.')).toBeInTheDocument();
    expect(screen.getAllByText('Required.')).toHaveLength(2);
    expect(calls).toHaveLength(0);
  });

  it('marks a taken domain, and an address the server refuses', async () => {
    let answer = fail(
      409,
      'That domain is already used by another organization!',
    );
    stubApi({ 'POST /api/v1/platform/organizations': () => answer });
    renderSettings(<OrganizationCreate />);
    const user = userEvent.setup();
    await fill(user);
    await user.click(
      screen.getByRole('button', { name: 'Create organization' }),
    );
    expect(
      await screen.findByText(
        'That domain is already used by another organization.',
      ),
    ).toBeInTheDocument();

    answer = fail(400, 'slug must match the pattern!');
    await user.click(
      screen.getByRole('button', { name: 'Create organization' }),
    );
    expect(
      await screen.findByText('Lowercase letters, digits and hyphens only.'),
    ).toBeInTheDocument();
  });

  it('sends the limits in the API’s units, and offers another', async () => {
    const calls = stubApi({
      'POST /api/v1/platform/organizations': ok(
        {
          organization: DETAIL,
          admin: { id: 'u', fullName: 'Dana Ortiz', email: 'dana@cedar.test' },
        },
        201,
      ),
    });
    renderSettings(<OrganizationCreate />);
    const user = userEvent.setup();
    await fill(user);
    await user.type(
      screen.getByLabelText('Allowed email domains (optional)'),
      'cedar.test, cedar.example',
    );
    await user.type(screen.getByLabelText('Seats'), '12');
    await user.type(screen.getByLabelText('Document storage'), '5');
    await user.type(screen.getByLabelText('AI allowance a month'), '1.50');
    await user.click(
      screen.getByRole('button', { name: 'Create organization' }),
    );

    expect(
      await screen.findByText(
        'We emailed Dana Ortiz a link to set a password.',
      ),
    ).toBeInTheDocument();
    expect(calls[0].body).toMatchObject({
      allowedEmailDomains: ['cedar.test', 'cedar.example'],
      maxAgentSeats: 12,
      maxStorageBytes: 5 * GIB,
      monthlyAiTokenBudget: 1_500_000,
    });

    await user.click(
      screen.getByRole('button', { name: 'Open Northwind Health' }),
    );
    expect(push).toHaveBeenCalledWith(`/platform/organizations/${ORG}`);
    await user.click(screen.getByRole('button', { name: 'Create another' }));
    expect(
      screen.getByRole('button', { name: 'Create organization' }),
    ).toBeInTheDocument();
  });
});
