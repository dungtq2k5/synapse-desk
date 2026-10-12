import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { REALTIME_EVENTS } from '@synapsedesk/contracts';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ok, fail, stubApi, type Call, type Reply } from '@/test/api';
import { TicketList } from './ticket-list';

// The socket is replaced by the handlers the list registers, called by hand.
const handlers = new Map<string, (frame: unknown) => void>();
jest.mock('@/components/realtime/realtime-provider', () => ({
  useRealtimeEvent: (event: string, handler: (frame: unknown) => void) => {
    handlers.set(event, handler);
  },
}));

// Radix Select measures and captures the pointer; jsdom has neither.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
  handlers.clear();
  jest.restoreAllMocks();
});

const UPDATED = new Date(Date.now() - 5 * 60_000).toISOString();

const me = (permissionCodes: string[]) =>
  ok({
    user: { id: 'u-1', fullName: 'Priya Shah', email: 'priya@acme.test' },
    permissionCodes,
    departmentIds: [],
  });

const AGENT = ['ticket.read.all', 'user.read', 'department.read'];

const ticket = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `t-${n}`,
  ticketNumber: n,
  organizationId: 'o-1',
  authorId: 'u-9',
  source: 'WEB',
  status: 'OPEN',
  priority: 'HIGH',
  title: `Printer jam ${n}`,
  description: '',
  currentAssigneeId: null,
  currentDepartmentId: null,
  escalatedAt: null,
  resolvedAt: null,
  unreadCount: 0,
  createdAt: UPDATED,
  updatedAt: UPDATED,
  deletedAt: null,
  deletedById: null,
  author: null,
  assignee: null,
  department: null,
  ...extra,
});

const page = (
  items: unknown[],
  meta: Partial<Record<string, number>> = {},
): Reply =>
  ok({
    items,
    meta: {
      totalItems: items.length,
      itemCount: items.length,
      itemsPerPage: 10,
      totalPages: 1,
      currentPage: 1,
      ...meta,
    },
  });

const THREE = [
  ticket(1042, { unreadCount: 2 }),
  ticket(1043, {
    unreadCount: 1,
    status: 'ESCALATED',
    priority: 'URGENT',
    source: 'EMAIL',
    currentAssigneeId: 'u-2',
    assignee: { id: 'u-2', fullName: 'Dana Lee', avatarUrl: null },
    currentDepartmentId: 'd-1',
    department: { id: 'd-1', name: 'Billing' },
  }),
  ticket(1044, {
    status: null,
    priority: null,
    source: null,
    currentAssigneeId: 'u-3',
    currentDepartmentId: 'd-2',
  }),
];

function show(routes: Parameters<typeof stubApi>[0]) {
  const calls = stubApi(routes);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <TicketList />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { calls, user: userEvent.setup() };
}

const listCalls = (calls: Call[]) =>
  calls
    .filter(({ url }) => url.startsWith('/api/v1/tickets?'))
    .map(({ url }) => new URL(url, 'http://web').searchParams);

/** The query of the request being answered: a route reads it while replying. */
const asked = () =>
  new URL(jest.mocked(fetch).mock.lastCall![0] as string, 'http://web')
    .searchParams;

const table = () => screen.getByRole('table');

describe('the ticket list for an agent', () => {
  it('shows every column, the assignee and department as they resolved', async () => {
    show({
      'GET /api/v1/users/me': me(AGENT),
      'GET /api/v1/tickets': page(THREE),
      'GET /api/v1/users': ok({ items: [], meta: {} }),
      'GET /api/v1/departments': ok({ items: [], meta: {} }),
    });

    expect(screen.getByRole('heading', { name: 'Tickets' })).toBeVisible();
    expect(await screen.findByText('3 tickets')).toBeInTheDocument();

    const head = within(table()).getAllByRole('columnheader');
    expect(head.map((cell) => cell.textContent)).toEqual([
      'Ticket',
      'Status',
      'Priority',
      'Source',
      'Assignee',
      'Department',
      'Updated',
    ]);

    const rows = within(table()).getAllByRole('row').slice(1);
    expect(
      within(rows[0]).getByRole('link', {
        name: '#1042 Printer jam 1042, 2 unread messages',
      }),
    ).toHaveAttribute('href', '/tickets/t-1042');
    expect(within(rows[0]).getByText('Open')).toBeInTheDocument();
    expect(within(rows[0]).getByText('High')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Web')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Unassigned')).toBeInTheDocument();
    expect(within(rows[0]).getByText('—')).toBeInTheDocument();
    expect(within(rows[0]).getByText('5 min ago')).toBeInTheDocument();

    expect(
      within(rows[1]).getByRole('link', {
        name: '#1043 Printer jam 1043, 1 unread message',
      }),
    ).toBeInTheDocument();
    expect(within(rows[1]).getByText('Escalated')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Urgent')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Email')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Dana Lee')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Billing')).toBeInTheDocument();

    expect(
      within(rows[2]).getByRole('link', { name: '#1044 Printer jam 1044' }),
    ).toBeInTheDocument();
    expect(within(rows[2]).getByText('Unknown user')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Unknown department')).toBeInTheDocument();

    // The phone layout says who holds each ticket in one line.
    const cards = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(cards[0]).toHaveTextContent('Unassigned · 5 min ago');
    expect(cards[1]).toHaveTextContent('Dana Lee · 5 min ago');
    expect(cards[2]).toHaveTextContent('Unknown user · 5 min ago');
  });

  it('has nothing in the queue yet', async () => {
    show({
      'GET /api/v1/users/me': me(['ticket.message.moderate']),
      'GET /api/v1/tickets': page([]),
    });

    expect(
      await screen.findByRole('heading', { name: 'No tickets yet' }),
    ).toBeInTheDocument();
    expect(screen.getByText('0 tickets')).toBeInTheDocument();
  });

  it('sorts by a column, newest first, then flips it', async () => {
    const { calls, user } = show({
      'GET /api/v1/users/me': me(['ticket.read.all']),
      'GET /api/v1/tickets': page(THREE),
    });
    await screen.findByText('3 tickets');

    const ticketHead = () => within(table()).getAllByRole('columnheader')[0];
    expect(ticketHead()).toHaveAttribute('aria-sort', 'none');
    expect(within(table()).getAllByRole('columnheader')[6]).toHaveAttribute(
      'aria-sort',
      'descending',
    );

    await user.click(within(ticketHead()).getByRole('button'));
    await waitFor(() =>
      expect(ticketHead()).toHaveAttribute('aria-sort', 'descending'),
    );
    await user.click(within(ticketHead()).getByRole('button'));
    await waitFor(() =>
      expect(ticketHead()).toHaveAttribute('aria-sort', 'ascending'),
    );

    const sorts = listCalls(calls).map(
      (params) => `${params.get('sortBy')} ${params.get('sortOrder')}`,
    );
    expect(sorts).toEqual([
      'updatedAt DESC',
      'ticketNumber DESC',
      'ticketNumber ASC',
    ]);
  });

  it('pages through the queue and changes the page size', async () => {
    const { calls, user } = show({
      'GET /api/v1/users/me': me(['ticket.read.all']),
      'GET /api/v1/tickets': () => {
        const current = Number(asked().get('page'));
        const limit = Number(asked().get('limit'));
        return page(THREE, {
          totalItems: 25,
          itemsPerPage: limit,
          itemCount: 3,
          currentPage: current,
          totalPages: Math.ceil(25 / limit),
        });
      },
    });

    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByText('Showing 1–3 of 25')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Previous page' }),
    ).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
    expect(screen.getByText('Showing 11–13 of 25')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Rows per page' }));
    await user.click(await screen.findByRole('option', { name: '20' }));
    expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument();
    expect(listCalls(calls).at(-1)!.get('limit')).toBe('20');
  });

  it('searches once typing pauses, and says when nothing matches', async () => {
    const { calls, user } = show({
      'GET /api/v1/users/me': me(['ticket.read.all']),
      'GET /api/v1/tickets': () =>
        asked().has('searchTerm') ? page([]) : page(THREE),
    });
    await screen.findByText('3 tickets');

    await user.type(
      screen.getByRole('searchbox', { name: 'Search tickets' }),
      '  toner ',
    );
    expect(
      await screen.findByRole('heading', { name: 'No tickets match' }),
    ).toBeInTheDocument();
    expect(screen.getByText('0 tickets match')).toBeInTheDocument();
    expect(listCalls(calls).at(-1)!.get('searchTerm')).toBe('toner');

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('3 tickets')).toBeInTheDocument();
  });

  it('filters by status, priority, source, assignee and department, and resets', async () => {
    const { calls, user } = show({
      'GET /api/v1/users/me': me(AGENT),
      'GET /api/v1/tickets': page(THREE),
      'GET /api/v1/users': ok({
        items: [{ user: { id: 'u-2', fullName: 'Dana Lee' } }],
        meta: {},
      }),
      'GET /api/v1/departments': ok({
        items: [{ id: 'd-1', name: 'Billing' }],
        meta: {},
      }),
    });
    await screen.findByText('3 tickets');

    const pick = async (filter: string, option: string) => {
      await user.click(screen.getByRole('combobox', { name: filter }));
      await user.click(await screen.findByRole('option', { name: option }));
    };
    await pick('Status', 'Escalated');
    await pick('Priority', 'Urgent');
    await pick('Source', 'Email');
    await pick('Assignee', 'Dana Lee');
    await pick('Department', 'Billing');
    await waitFor(() =>
      expect(Object.fromEntries(listCalls(calls).at(-1)!)).toMatchObject({
        status: 'ESCALATED',
        priority: 'URGENT',
        source: 'EMAIL',
        assigneeId: 'u-2',
        departmentId: 'd-1',
      }),
    );
    expect(await screen.findByText('3 tickets match')).toBeInTheDocument();

    await pick('Status', 'All');
    await waitFor(() =>
      expect(listCalls(calls).at(-1)!.has('status')).toBe(false),
    );

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(await screen.findByText('3 tickets')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
  });

  it('shows the agent their own tickets with "Assigned to me"', async () => {
    const { calls, user } = show({
      'GET /api/v1/users/me': me(['ticket.read.all']),
      'GET /api/v1/tickets': page(THREE),
    });
    await screen.findByText('3 tickets');

    const mine = screen.getByRole('button', { name: 'Assigned to me' });
    expect(mine).toHaveAttribute('aria-pressed', 'false');
    // No Assignee or Department filter without the permission to list them.
    expect(screen.queryByRole('combobox', { name: 'Assignee' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Department' })).toBeNull();

    await user.click(mine);
    await waitFor(() => expect(mine).toHaveAttribute('aria-pressed', 'true'));
    expect(listCalls(calls).at(-1)!.get('assigneeId')).toBe('u-1');

    await user.click(mine);
    await waitFor(() => expect(mine).toHaveAttribute('aria-pressed', 'false'));
    expect(listCalls(calls).at(-1)!.has('assigneeId')).toBe(false);
  });

  it('highlights a ticket that arrives live and announces it', async () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="announcer-polite"></div>',
    );
    show({
      'GET /api/v1/users/me': me(['ticket.read.all']),
      'GET /api/v1/tickets': page(THREE),
    });
    await screen.findByText('3 tickets');

    jest.useFakeTimers();
    try {
      act(() =>
        handlers.get(REALTIME_EVENTS.ticketCreated)!({
          ticketId: 't-1042',
          ticketNumber: 1042,
          title: 'Printer jam 1042',
        }),
      );
      const row = () => within(table()).getAllByRole('row')[1];
      expect(row()).toHaveClass('bg-accent');

      act(() => jest.advanceTimersByTime(50));
      expect(document.getElementById('announcer-polite')).toHaveTextContent(
        'New ticket #1042: Printer jam 1042',
      );

      act(() => jest.advanceTimersByTime(2000));
      expect(row()).not.toHaveClass('bg-accent');
    } finally {
      jest.useRealTimers();
      document.getElementById('announcer-polite')!.remove();
    }
  });

  it('says who now owns a ticket taken from the viewer', async () => {
    const info = jest.spyOn(toast, 'info');
    const { calls } = show({
      'GET /api/v1/users/me': me(['ticket.read.all']),
      'GET /api/v1/tickets': page(THREE),
      'GET /api/v1/tickets/t-1': ok(
        ticket(1, { assignee: { id: 'u-2', fullName: 'Dana Lee' } }),
      ),
      'GET /api/v1/tickets/t-2': ok(ticket(2)),
      'GET /api/v1/tickets/t-3': fail(404, 'Ticket not found'),
    });
    await screen.findByText('3 tickets');
    const updated = handlers.get(REALTIME_EVENTS.ticketUpdated)!;

    const reassigned = (ticketId: string, fromAssigneeId: string | null) =>
      act(() =>
        updated({
          pattern: 'ticket.reassigned',
          ticketId,
          ticketNumber: Number(ticketId.slice(2)),
          fromAssigneeId,
        }),
      );

    // Not the viewer's ticket, or not a reassignment: nothing to say.
    reassigned('t-9', 'u-2');
    act(() => updated({ pattern: 'ticket.status_changed', ticketId: 't-9' }));
    expect(calls.some(({ url }) => url.endsWith('/t-9'))).toBe(false);

    reassigned('t-1', 'u-1');
    await waitFor(() =>
      expect(info).toHaveBeenCalledWith('Ticket #1 reassigned', {
        description: 'Dana Lee now owns this ticket.',
      }),
    );

    reassigned('t-2', 'u-1');
    await waitFor(() =>
      expect(info).toHaveBeenCalledWith('Ticket #2 reassigned', {
        description: 'Someone else now owns this ticket.',
      }),
    );

    // A ticket the viewer can no longer read: no toast, and no error.
    reassigned('t-3', 'u-1');
    await waitFor(() =>
      expect(calls.some(({ url }) => url.endsWith('/t-3'))).toBe(true),
    );
    expect(info).toHaveBeenCalledTimes(2);
  });
});

describe('the ticket list for an end user', () => {
  it('shows their own tickets with three columns', async () => {
    show({
      'GET /api/v1/users/me': me([]),
      'GET /api/v1/tickets': page([ticket(7, { status: 'RESOLVED' })]),
    });

    expect(await screen.findByText('1 ticket')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'My tickets' }),
    ).toBeInTheDocument();
    expect(
      within(table())
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Ticket', 'Status', 'Last update']);
    expect(within(table()).getByText('Resolved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assigned to me' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Priority' })).toBeNull();
    expect(
      screen.getByRole('combobox', { name: 'Status' }),
    ).toBeInTheDocument();
  });

  it('has raised none yet', async () => {
    show({
      'GET /api/v1/users/me': me([]),
      'GET /api/v1/tickets': page([]),
    });

    expect(
      await screen.findByRole('heading', {
        name: 'You haven’t raised any tickets',
      }),
    ).toBeInTheDocument();
  });

  it('shows the skeleton while the first page loads', () => {
    show({
      'GET /api/v1/users/me': me([]),
      'GET /api/v1/tickets': page([]),
    });

    expect(screen.getByRole('status')).toHaveTextContent('Loading tickets');
    // The viewer is still loading, so the title is the neutral one.
    expect(screen.getByRole('heading', { name: 'Tickets' })).toBeVisible();
  });

  it('offers to try again when the list fails to load', async () => {
    let failing = true;
    const { user } = show({
      'GET /api/v1/users/me': me([]),
      'GET /api/v1/tickets': () =>
        failing ? fail(500, 'Internal server error') : page([ticket(7)]),
    });

    expect(
      await screen.findByRole('heading', { name: 'Couldn’t load tickets' }),
    ).toBeInTheDocument();

    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('1 ticket')).toBeInTheDocument();
  });
});
