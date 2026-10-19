import { organizationsControllerUpdateV1 } from '@synapsedesk/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { leaveFor } from '@/lib/leave';
import { toastError } from '@/lib/toast';
import { fail, ok, stubApi, type Reply } from '@/test/api';
import { stubMatchMedia } from '@/test/settings';
import { AppHeader } from './app-header';
import { AppShell } from './app-shell';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  usePathname: () => '/tickets',
  useRouter: () => ({ push }),
}));
jest.mock('@/components/realtime/realtime-provider', () => ({
  RealtimeProvider: ({ children }: { children: ReactNode }) => children,
  useRealtimeEvent: () => undefined,
}));
jest.mock('@/lib/leave', () => ({ leaveFor: jest.fn() }));

beforeAll(stubMatchMedia);
afterEach(() => {
  push.mockReset();
  jest.mocked(leaveFor).mockClear();
});

const me = (organizationStatus: string, permissionCodes: string[] = []) =>
  ok({
    user: { id: 'u-1', fullName: 'Priya Shah', email: 'priya@acme.test' },
    permissionCodes,
    departmentIds: [],
    organizationStatus,
  });

function shell(routes: Record<string, Reply | (() => Reply)>) {
  const calls = stubApi({
    'GET /api/v1/organizations/current': ok({ id: 'o-1', name: 'Acme Inc' }),
    ...(routes as Record<string, Reply>),
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider attribute="class">
        <TooltipProvider>
          <AppShell supportEmail="support@synapsedesk.test">
            <AppHeader crumbs={[{ label: 'Tickets' }]} />
            <p>The page</p>
          </AppShell>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return calls;
}

describe('past due', () => {
  it('an admin sees the banner with Update payment, which opens the portal', async () => {
    const calls = shell({
      'GET /api/v1/users/me': me('SUSPENDED_PAST_DUE', ['organization.update']),
      'POST /api/v1/billing/portal-session': ok({ url: 'https://portal.test' }),
    });
    const banner = await screen.findByRole('status', {
      name: 'Payment overdue',
    });
    await waitFor(() =>
      expect(banner).toHaveTextContent(
        'A payment failed. Acme Inc is read-only until it’s settled.',
      ),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Update payment (opens Stripe)' }),
    );
    await waitFor(() =>
      expect(leaveFor).toHaveBeenCalledWith('https://portal.test'),
    );
    expect(calls.some((call) => call.url.endsWith('/portal-session'))).toBe(
      true,
    );
  });

  it('everyone else is asked to tell their admin, with no button', async () => {
    shell({ 'GET /api/v1/users/me': me('SUSPENDED_PAST_DUE') });
    const banner = await screen.findByRole('status', {
      name: 'Payment overdue',
    });
    expect(banner).toHaveTextContent('Ask your admin to update the payment.');
    expect(
      screen.queryByRole('button', { name: /Update payment/ }),
    ).not.toBeInTheDocument();
  });

  it('a refused write is said once, in the deck’s words, and the screen’s own toast is held back', async () => {
    let reads = 0;
    shell({
      'GET /api/v1/users/me': () => {
        reads += 1;
        return me('SUSPENDED_PAST_DUE');
      },
      'PATCH /api/v1/organizations/current': fail(
        403,
        'This workspace is suspended for non-payment!',
        undefined,
        { organizationStatus: 'SUSPENDED_PAST_DUE' },
      ),
    });
    await screen.findByText('Acme Inc');
    await waitFor(() => expect(reads).toBe(1));

    await organizationsControllerUpdateV1({ name: 'X' }).catch(() =>
      toastError('Couldn’t save the profile', 'Something went wrong!'),
    );

    expect(
      await screen.findByText('Acme Inc is read-only'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'A payment failed, so nothing can be created or changed until it’s settled. Ask your admin to update the payment.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Couldn’t save the profile'),
    ).not.toBeInTheDocument();
    // `/users/me` is read again, so the banner follows the status.
    await waitFor(() => expect(reads).toBe(2));
  });

  it('a no-status active organization shows no banner', async () => {
    shell({ 'GET /api/v1/users/me': me('ACTIVE') });
    expect(await screen.findByText('The page')).toBeInTheDocument();
    expect(
      screen.queryByRole('status', { name: 'Payment overdue' }),
    ).not.toBeInTheDocument();
  });
});

describe('frozen', () => {
  it('replaces the app with the frozen page: the address to write to and Sign out', async () => {
    shell({
      'GET /api/v1/users/me': me('FROZEN'),
      'POST /api/v1/auth/logout': ok(null),
    });
    const heading = await screen.findByRole('heading', {
      name: 'Acme Inc is frozen',
      level: 1,
    });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.queryByText('The page')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'support@synapsedesk.test' }),
    ).toHaveAttribute('href', 'mailto:support@synapsedesk.test');
    expect(
      screen.getByRole('link', { name: 'Contact support' }),
    ).toHaveAttribute('href', 'mailto:support@synapsedesk.test');
    expect(
      screen.getByText('Signed in as priya@acme.test'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login?signed-out'));
  });

  it('a frozen refusal while signed in re-reads `/users/me` and shows the page', async () => {
    let status = 'ACTIVE';
    shell({
      'GET /api/v1/users/me': () => me(status),
      'PATCH /api/v1/organizations/current': () => {
        status = 'FROZEN';
        return fail(403, 'This workspace is frozen!', undefined, {
          organizationStatus: 'FROZEN',
        });
      },
    });
    expect(await screen.findByText('The page')).toBeInTheDocument();

    await organizationsControllerUpdateV1({ name: 'X' }).catch(() => undefined);

    expect(
      await screen.findByRole('heading', { name: 'Acme Inc is frozen' }),
    ).toBeInTheDocument();
  });
});
