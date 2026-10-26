import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { leaveFor } from '@/lib/leave';
import { keepTwoStepWarning, readTwoStepWarning } from '@/lib/two-step-warning';
import { fail, ok, stubApi, type Reply } from '@/test/api';
import { AppHeader } from './app-header';
import { AppShell } from './app-shell';

const push = jest.fn();
let pathname = '/tickets/t-1';
jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push }),
}));

jest.mock('@/lib/leave', () => ({ leaveFor: jest.fn() }));

// No socket in these tests: the provider only passes its children through.
jest.mock('@/components/realtime/realtime-provider', () => ({
  RealtimeProvider: ({ children }: { children: ReactNode }) => children,
  useRealtimeEvent: () => undefined,
}));

/** A viewport that is phone-sized or not, and can change while mounted. */
let phone = false;
const viewport = new Set<() => void>();
function resize(toPhone: boolean) {
  phone = toPhone;
  act(() => viewport.forEach((listener) => listener()));
}
beforeAll(() => {
  window.matchMedia = (media: string) =>
    ({
      get matches() {
        return media.includes('max-width') ? phone : false;
      },
      media,
      addEventListener: (_: string, listener: () => void) =>
        viewport.add(listener),
      removeEventListener: (_: string, listener: () => void) =>
        viewport.delete(listener),
      addListener: () => undefined,
      removeListener: () => undefined,
    }) as unknown as MediaQueryList;
});

afterEach(() => {
  phone = false;
  pathname = '/tickets/t-1';
  sessionStorage.clear();
  push.mockReset();
  jest.mocked(leaveFor).mockClear();
  jest.restoreAllMocks();
});

const USER = { id: 'u-1', fullName: 'Priya Shah', email: 'priya@acme.test' };

function wrap(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <TooltipProvider>{ui}</TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

function shell(
  logout: Reply | (() => Reply) = ok(null),
  permissionCodes: string[] = [],
) {
  const calls = stubApi({
    'GET /api/v1/organizations/current': ok({ id: 'o-1', name: 'Acme Inc' }),
    'GET /api/v1/users/me': ok({
      user: USER,
      permissionCodes,
      departmentIds: [],
    }),
    'POST /api/v1/auth/logout': logout,
  });
  wrap(
    <AppShell>
      <p>The page</p>
    </AppShell>,
  );
  return { calls, user: userEvent.setup() };
}

describe('the app shell', () => {
  it('names the organization and, for an end user, marks My requests on a thread', async () => {
    shell();

    expect(await screen.findByText('Acme Inc')).toBeInTheDocument();
    expect(screen.getByText('SynapseDesk')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Skip to content' }),
    ).toHaveAttribute('href', '#main');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(nav).toHaveTextContent('Support');
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Ask', 'My requests', 'Knowledge']);
    expect(screen.getByRole('link', { name: 'My requests' })).toHaveAttribute(
      'data-active',
      'true',
    );
    expect(screen.getByText('The page')).toBeInTheDocument();
    // The page brings its own `main`; the shell adds none, or every page
    // would have two.
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
  });

  it('gives an agent Tickets, Knowledge and Ask, and marks none elsewhere', async () => {
    pathname = '/settings';
    shell(ok(null), ['ticket.read.all']);

    const nav = await screen.findByRole('navigation', { name: 'Main' });
    await waitFor(() =>
      expect(
        within(nav)
          .getAllByRole('link')
          .map((link) => link.textContent),
      ).toEqual(['Tickets', 'Knowledge', 'Ask']),
    );
    expect(screen.getByRole('link', { name: 'Tickets' })).toHaveAttribute(
      'data-active',
      'false',
    );
  });

  it('shows a low backup codes warning until it is dismissed', async () => {
    keepTwoStepWarning('You have 2 backup code(s) left.');
    const { user } = shell();

    expect(screen.getByText('Backup codes running low')).toBeInTheDocument();
    expect(
      screen.getByText('You have 2 backup code(s) left.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Backup codes running low')).toBeNull();
    expect(readTwoStepWarning()).toBeNull();
  });

  it('shows no warning when sign-in left none', () => {
    shell();
    expect(screen.queryByText('Backup codes running low')).toBeNull();
  });
});

describe('the account menu', () => {
  it('shows who is signed in and switches the theme', async () => {
    const { user } = shell();
    const account = screen.getByRole('button', { name: 'Account' });
    await waitFor(() => expect(account).toHaveTextContent('Priya Shah'));
    expect(account).toHaveTextContent('priya@acme.test');

    await user.click(account);
    const menu = await screen.findByRole('menu');
    expect(menu).toHaveTextContent('Priya Shah');
    expect(screen.getByRole('menuitemradio', { name: 'System' })).toBeChecked();

    await user.click(screen.getByRole('menuitemradio', { name: 'Dark' }));
    await user.click(account);
    expect(
      await screen.findByRole('menuitemradio', { name: 'Dark' }),
    ).toBeChecked();
  });

  it('signs out and goes to the sign-in page', async () => {
    const { calls, user } = shell();

    await user.click(screen.getByRole('button', { name: 'Account' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));

    await waitFor(() =>
      expect(leaveFor).toHaveBeenCalledWith('/login?signed-out'),
    );
    expect(calls.map(({ method, url }) => `${method} ${url}`)).toContain(
      'POST /api/v1/auth/logout',
    );
  });

  it('says so when signing out fails, and offers to try again', async () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="announcer-assertive"></div>',
    );
    const error = jest.spyOn(toast, 'error');
    let failing = true;
    const { user } = shell(() =>
      failing ? fail(503, 'Service unavailable') : ok(null),
    );

    await user.click(screen.getByRole('button', { name: 'Account' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith('Couldn’t sign out', {
        description: 'Check your connection and try again.',
        action: { label: 'Try again', onClick: expect.any(Function) },
        duration: Infinity,
      }),
    );
    const region = document.getElementById('announcer-assertive')!;
    await waitFor(() =>
      expect(region).toHaveTextContent(
        'Couldn’t sign out. Check your connection and try again.',
      ),
    );
    expect(leaveFor).not.toHaveBeenCalled();

    failing = false;
    const retry = error.mock.calls[0][1]?.action as unknown as {
      onClick: () => void;
    };
    act(() => retry.onClick());
    await waitFor(() =>
      expect(leaveFor).toHaveBeenCalledWith('/login?signed-out'),
    );
    region.remove();
  });
});

describe('the page header', () => {
  const header = () => {
    stubApi({});
    wrap(
      <SidebarProvider>
        <AppHeader
          crumbs={[
            { label: 'Tickets', href: '/tickets' },
            { label: 'Ticket 1042' },
          ]}
        />
      </SidebarProvider>,
    );
  };

  it('links back up the trail and names the current page', () => {
    header();

    expect(screen.getByRole('link', { name: 'Tickets' })).toHaveAttribute(
      'href',
      '/tickets',
    );
    expect(screen.getByText('Ticket 1042')).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.getByRole('button', { name: 'Toggle sidebar' }),
    ).toBeInTheDocument();
  });

  it('calls the trigger a menu on a phone', () => {
    header();

    resize(true);
    expect(
      screen.getByRole('button', { name: 'Open menu' }),
    ).toBeInTheDocument();
  });
});
