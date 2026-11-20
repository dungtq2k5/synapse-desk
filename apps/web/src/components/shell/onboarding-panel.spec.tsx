import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { fail, ok, stubApi } from '@/test/api';
import '@/test/dom';
import { OnboardingPanel } from './onboarding-panel';

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

const ONBOARDING = 'GET /api/v1/organizations/current/onboarding';
const COMPLETE = 'POST /api/v1/organizations/current/onboarding/complete';

const me = (verified = true, codes = ['organization.read']) =>
  ok({
    user: { id: 'u1', fullName: 'Maya Chen', isEmailVerified: verified },
    permissionCodes: codes,
    departmentIds: [],
    hasPassword: true,
  });

const steps = (...complete: boolean[]) =>
  ok({
    steps: [
      { key: 'verify_email', label: 'Verify an administrator email address' },
      { key: 'create_department', label: 'Create your first department' },
      { key: 'invite_team', label: 'Invite a colleague' },
    ].map((step, index) => ({ ...step, complete: complete[index] })),
    canComplete: complete.every(Boolean),
    status: 'PENDING_ONBOARDING',
  });

function wrap(routes: Parameters<typeof stubApi>[0]) {
  const calls = stubApi({
    'GET /api/v1/users/me': me(),
    'GET /api/v1/organizations/current': ok({ name: 'Northwind Health' }),
    ...routes,
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <main id="main">
        <h1>Tickets</h1>
        <OnboardingPanel />
      </main>
    </QueryClientProvider>,
  );
  return { calls, user: userEvent.setup() };
}

describe('the onboarding panel', () => {
  it('lists the steps with their state, and why setup can’t finish yet', async () => {
    wrap({ [ONBOARDING]: steps(true, false, false) });

    expect(
      await screen.findByRole('heading', { name: 'Set up Northwind Health' }),
    ).toBeInTheDocument();
    expect(screen.getByText('1 of 3 steps done')).toBeInTheDocument();
    expect(
      screen.getByRole('listitem', {
        name: 'Verify an administrator email address, done',
      }),
    ).toBeInTheDocument();
    const finish = screen.getByRole('button', { name: 'Finish setup' });
    expect(finish).toBeDisabled();
    expect(finish).toHaveAccessibleDescription(
      'Finish every step to complete setup.',
    );
    expect(
      screen.getByRole('button', { name: /Go to Departments/ }),
    ).toHaveAccessibleDescription('Not available yet');
  });

  it('inviting waits for a verified email, and says so', async () => {
    wrap({
      'GET /api/v1/users/me': me(false),
      [ONBOARDING]: steps(false, true, false),
    });

    expect(
      await screen.findByRole('button', { name: /Go to Invitations/ }),
    ).toHaveAccessibleDescription('Verify your email first');
    expect(screen.getByRole('link', { name: /Verify email/ })).toHaveAttribute(
      'href',
      '/verify-email?next=%2Ftickets',
    );
  });

  it('isn’t asked for without organization.read, and shows nothing', async () => {
    const { calls } = wrap({ 'GET /api/v1/users/me': me(true, []) });

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls.some((call) => call.url.includes('onboarding'))).toBe(false);
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });

  it('shows nothing on a 403 or once the organization is active', async () => {
    wrap({ [ONBOARDING]: fail(403, 'Forbidden') });
    await waitFor(() =>
      expect(screen.queryByRole('heading', { level: 2 })).toBeNull(),
    );
  });

  it('finishes setup, then hands focus to the page heading', async () => {
    let done = false;
    const { user } = wrap({
      [ONBOARDING]: () =>
        done ? ok({ status: 'ACTIVE', steps: [] }) : steps(true, true, true),
      [COMPLETE]: () => {
        done = true;
        return ok({ status: 'ACTIVE' });
      },
    });

    await user.click(
      await screen.findByRole('button', { name: 'Finish setup' }),
    );

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Finish setup' })).toBeNull(),
    );
    expect(toast.success).toHaveBeenCalledWith('Setup complete', {
      description: 'Northwind Health is ready.',
    });
    expect(screen.getByRole('heading', { name: 'Tickets' })).toHaveFocus();
  });

  it('someone else finished first: says so, and goes', async () => {
    let done = false;
    const { user } = wrap({
      [ONBOARDING]: () =>
        done ? ok({ status: 'ACTIVE', steps: [] }) : steps(true, true, true),
      [COMPLETE]: () => {
        done = true;
        return fail(409, 'This workspace is ACTIVE, not pending onboarding');
      },
    });

    await user.click(
      await screen.findByRole('button', { name: 'Finish setup' }),
    );

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Finish setup' })).toBeNull(),
    );
    expect(toast.info).toHaveBeenCalledWith('Setup is already finished', {
      description: 'Northwind Health is ready to use.',
    });
  });
});
