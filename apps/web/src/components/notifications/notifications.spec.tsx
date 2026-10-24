import type { NotificationResponseDto } from '@synapsedesk/api-client';
import { REALTIME_EVENTS } from '@synapsedesk/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { toast, Toaster } from 'sonner';
import { RealtimeProvider } from '@/components/realtime/realtime-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { fail, ok, stubApi, type Reply } from '@/test/api';
import { lastSocket } from '@/test/socket';
import { NotificationBell } from './bell';
import { MAX_SELECTION, NotificationFeed } from './feed';
import { NotificationPreferences } from './preferences';
import { newer, NotificationsLive } from './store';

jest.mock('socket.io-client', () => jest.requireActual('@/test/socket'));
let pathname = '/tickets';
const push = jest.fn();
jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push }),
}));

const NOW = Date.now();
const notification = (
  over: Partial<NotificationResponseDto> = {},
): NotificationResponseDto => ({
  id: 'n1',
  organizationId: 'o1',
  type: 'ticket.assigned',
  priority: 'HIGH',
  title: 'Jordan Lee assigned #1051 to you',
  body: 'Does the allowance reset in January?',
  data: { ticketId: 't1051', ticketNumber: 1051 },
  actionUrl: '/tickets/1051',
  actorId: 'jordan',
  resourceType: 'TICKET',
  resourceId: 't1051',
  groupKey: null,
  groupCount: 1,
  readAt: null,
  archivedAt: null,
  createdAt: new Date(NOW - 5 * 60_000).toISOString(),
  ...over,
});

const ME = (codes: string[], user: object = {}) =>
  ok({
    user: {
      id: 'maya',
      fullName: 'Maya Chen',
      email: 'maya@acme.test',
      isPhoneVerified: true,
      ...user,
    },
    permissionCodes: codes,
    departmentIds: [],
  });

function show(ui: ReactNode, routes: Parameters<typeof stubApi>[0]) {
  const calls = stubApi({
    'GET /api/v1/users/me': ME(['ticket.read.all']),
    'GET /api/v1/users': ok({ items: [], meta: {} }),
    ...routes,
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RealtimeProvider>
        <TooltipProvider>
          <NotificationsLive />
          {ui}
          <Toaster />
        </TooltipProvider>
      </RealtimeProvider>
    </QueryClientProvider>,
  );
  const socket = lastSocket();
  act(() => socket.receive(REALTIME_EVENTS.connectionReady));
  return { calls, socket, user: userEvent.setup() };
}

const posts = (calls: ReturnType<typeof stubApi>, path: string) =>
  calls.filter(({ method, url }) => method === 'POST' && url.endsWith(path));

beforeAll(() => {
  window.matchMedia = ((media: string) => ({
    matches: false,
    media,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  pathname = '/tickets';
  push.mockReset();
  // Sonner's toasts are global, and a HIGH one never times out.
  act(() => {
    toast.dismiss();
  });
});

describe('the bell', () => {
  const bell = () => screen.getByRole('button', { name: /^Notifications/ });

  it('wears the server’s count: “99+” past 99, nothing at 0', async () => {
    let count = 120;
    show(<NotificationBell />, {
      'GET /api/v1/notifications/unread-count': () => ok({ count }),
    });
    await waitFor(() =>
      expect(bell()).toHaveAccessibleName('Notifications, 120 unread'),
    );
    expect(bell()).toHaveTextContent('99+');
    count = 0;
  });

  it('follows the socket’s count, and refetches it on a new one, never counting itself', async () => {
    let count = 4;
    const { socket } = show(<NotificationBell />, {
      'GET /api/v1/notifications/unread-count': () => ok({ count }),
      'GET /api/v1/notifications': ok({
        items: [],
        nextCursor: null,
        hasMore: false,
      }),
    });
    await waitFor(() =>
      expect(bell()).toHaveAccessibleName('Notifications, 4 unread'),
    );

    act(() =>
      socket.receive(REALTIME_EVENTS.notificationUnreadCount, { count: 1 }),
    );
    await waitFor(() =>
      expect(bell()).toHaveAccessibleName('Notifications, 1 unread'),
    );

    // A new one doesn't add one here: the count is fetched again.
    count = 7;
    act(() =>
      socket.receive(REALTIME_EVENTS.notificationNew, {
        ...payload(),
        priority: 'NORMAL',
      }),
    );
    await waitFor(() =>
      expect(bell()).toHaveAccessibleName('Notifications, 7 unread'),
    );

    act(() =>
      socket.receive(REALTIME_EVENTS.notificationUnreadCount, { count: 0 }),
    );
    await waitFor(() => expect(bell()).toHaveAccessibleName('Notifications'));
    expect(bell()).not.toHaveTextContent(/\d/);
  });

  it('keeps the newest count, whichever way it arrives', async () => {
    // A refetch, an answer and a push travel separately, so an older count
    // can arrive after a newer one: the server's time of counting decides.
    const T1 = '2026-10-24T10:00:00.000001Z';
    const T2 = '2026-10-24T10:00:00.000002Z';
    const T3 = '2026-10-24T10:00:00.000003Z';
    let answer = { count: 4, countedAt: T2 };
    const { socket, calls } = show(<NotificationBell />, {
      'GET /api/v1/notifications/unread-count': () => ok(answer),
      'GET /api/v1/notifications': ok({
        items: [],
        nextCursor: null,
        hasMore: false,
      }),
    });
    await waitFor(() =>
      expect(bell()).toHaveAccessibleName('Notifications, 4 unread'),
    );

    // Older than what's held: dropped. The cache tells the bell on a
    // scheduled tick, so give it one before saying it stayed.
    act(() =>
      socket.receive(REALTIME_EVENTS.notificationUnreadCount, {
        count: 1,
        countedAt: T1,
      }),
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(bell()).toHaveAccessibleName('Notifications, 4 unread');

    // Newer: taken.
    act(() =>
      socket.receive(REALTIME_EVENTS.notificationUnreadCount, {
        count: 1,
        countedAt: T3,
      }),
    );
    await waitFor(() =>
      expect(bell()).toHaveAccessibleName('Notifications, 1 unread'),
    );

    // A refetch that counted before that push: dropped too.
    answer = { count: 2, countedAt: T2 };
    const fetched = () =>
      calls.filter(({ url }) => url.endsWith('/notifications/unread-count'))
        .length;
    const before = fetched();
    act(() =>
      socket.receive(REALTIME_EVENTS.notificationNew, {
        ...payload(),
        priority: 'NORMAL',
      }),
    );
    await waitFor(() => expect(fetched()).toBeGreaterThan(before));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(bell()).toHaveAccessibleName('Notifications, 1 unread');
  });

  it.each([
    [undefined, 'b', true],
    ['b', undefined, true],
    ['2026-10-24T10:00:00.000001Z', '2026-10-24T10:00:00.000002Z', true],
    ['2026-10-24T10:00:00.000002Z', '2026-10-24T10:00:00.000001Z', false],
    ['2026-10-24T10:00:00.000002Z', '2026-10-24T10:00:00.000002Z', false],
  ])('newer(%s, %s) is %s', (held, incoming, expected) => {
    expect(newer(held, incoming)).toBe(expected);
  });

  it('opens the latest; opening one marks it read, and the badge takes the server’s answer', async () => {
    const { calls, user } = show(<NotificationBell />, {
      'GET /api/v1/notifications/unread-count': ok({ count: 2 }),
      'GET /api/v1/notifications': ok({
        items: [
          notification(),
          notification({
            id: 'n2',
            type: 'billing.payment_failed',
            priority: 'CRITICAL',
            title: 'A payment failed',
            actorId: null,
            actionUrl: 'https://evil.example/pay',
          }),
        ],
        nextCursor: null,
        hasMore: false,
      }),
      'POST /api/v1/notifications/n1/read': ok({ updated: 1, unreadCount: 1 }),
      'POST /api/v1/notifications/read': ok({ updated: 2, unreadCount: 0 }),
    });
    await user.click(
      await screen.findByRole('button', { name: /^Notifications/ }),
    );

    // Opening lands on the panel's heading, before the list.
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Notifications', level: 2 }),
      ).toHaveFocus(),
    );
    const item = await screen.findByRole('link', {
      name: /^Unread\., Jordan Lee assigned #1051 to you, .*High priority$/,
    });
    // A ticket by number, marked as coming from a notification.
    expect(item).toHaveAttribute('href', '/tickets/1051?from=notification');
    // An off-site actionUrl opens nothing.
    expect(
      screen.getByRole('button', { name: /^Unread\., A payment failed/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();

    await user.click(item);
    await waitFor(() =>
      expect(bell()).toHaveAccessibleName('Notifications, 1 unread'),
    );

    await user.click(screen.getByRole('button', { name: /^Notifications/ }));
    await user.click(
      await screen.findByRole('button', { name: 'Mark all as read' }),
    );
    await waitFor(() =>
      expect(posts(calls, '/notifications/read')[0]?.body).toEqual({
        ids: ['n1', 'n2'],
      }),
    );
    await waitFor(() => expect(bell()).toHaveAccessibleName('Notifications'));
  });
});

function payload(over: object = {}) {
  return {
    organizationId: 'o1',
    recipientId: 'maya',
    notificationId: 'n9',
    type: 'ticket.assigned',
    priority: 'HIGH',
    title: 'Jordan Lee assigned #1052 to you',
    body: 'Laptop won’t connect to the office Wi-Fi',
    data: { ticketId: 't1052', ticketNumber: 1052 },
    actionUrl: '/tickets/1052',
    groupKey: null,
    groupCount: 1,
    occurredAt: new Date().toISOString(),
    ...over,
  };
}

describe('live', () => {
  const routes = {
    'GET /api/v1/notifications/unread-count': ok({ count: 1 }),
  };

  it('toasts a new one, with Open; one toast per group, updated in place', async () => {
    const { socket } = show(null, routes);
    act(() => socket.receive(REALTIME_EVENTS.notificationNew, payload()));
    expect(
      await screen.findByText('Jordan Lee assigned #1052 to you'),
    ).toBeInTheDocument();
    expect(screen.getByText('High priority')).toBeInTheDocument();

    const reply = (count: number) =>
      payload({
        type: 'ticket.message_created',
        priority: 'NORMAL',
        notificationId: 'g1',
        groupKey: 'ticket:t1042:replies',
        title: `${count} new replies on #1042`,
      });
    act(() => socket.receive(REALTIME_EVENTS.notificationNew, reply(3)));
    expect(
      await screen.findByText('3 new replies on #1042'),
    ).toBeInTheDocument();
    act(() => socket.receive(REALTIME_EVENTS.notificationUpdated, reply(4)));
    expect(
      await screen.findByText('4 new replies on #1042'),
    ).toBeInTheDocument();
    expect(screen.queryByText('3 new replies on #1042')).toBeNull();
  });

  it('says nothing about the ticket on screen', async () => {
    pathname = '/tickets/00000000-0000-0000-0000-000000001052';
    const { socket } = show(null, routes);
    act(() =>
      socket.receive(
        REALTIME_EVENTS.notificationNew,
        payload({
          data: {
            ticketId: '00000000-0000-0000-0000-000000001052',
            ticketNumber: 1052,
          },
        }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('Jordan Lee assigned #1052 to you')).toBeNull();
  });

  it('a group that grew after its toast went shows none', async () => {
    const { socket } = show(null, routes);
    act(() =>
      socket.receive(
        REALTIME_EVENTS.notificationUpdated,
        payload({ groupKey: 'g', title: '5 new replies on #1042' }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('5 new replies on #1042')).toBeNull();
  });
});

describe('all notifications', () => {
  const page = (items: NotificationResponseDto[], nextCursor: string | null) =>
    ok({ items, nextCursor, hasMore: nextCursor !== null });

  it('by day, with Load more by cursor, and bulk read and archive', async () => {
    const { calls, user } = show(<NotificationFeed />, {
      'GET /api/v1/notifications/unread-count': ok({ count: 2 }),
      'GET /api/v1/notifications': (_, url) =>
        url.includes('cursor=c2')
          ? page(
              [
                notification({
                  id: 'n3',
                  title: '#1037 was reassigned to Sam Okafor',
                  createdAt: '2026-10-11T09:00:00Z',
                }),
              ],
              null,
            )
          : page(
              [
                notification(),
                notification({
                  id: 'n2',
                  title: '#1042 was escalated',
                  createdAt: new Date(NOW - 26 * 3_600_000).toISOString(),
                }),
              ],
              'c2',
            ),
      'POST /api/v1/notifications/read': ok({ updated: 2, unreadCount: 0 }),
      'POST /api/v1/notifications/n1/archive': ok({
        updated: 1,
        unreadCount: 0,
      }),
      'POST /api/v1/notifications/n2/archive': ok({
        updated: 1,
        unreadCount: 0,
      }),
    });

    expect(
      await screen.findByRole('heading', { name: 'Today' }),
    ).toBeInTheDocument();
    expect(screen.getByText('2 unread')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(
      await screen.findByText('#1037 was reassigned to Sam Okafor'),
    ).toBeInTheDocument();
    expect(screen.getByText('That’s everything.')).toBeInTheDocument();

    await user.click(
      screen.getByRole('checkbox', {
        name: 'Select Jordan Lee assigned #1051 to you',
      }),
    );
    await user.click(
      screen.getByRole('checkbox', { name: 'Select #1042 was escalated' }),
    );
    const toolbar = screen.getByRole('toolbar');
    expect(toolbar).toHaveTextContent('2 selected');
    await user.click(within(toolbar).getByRole('button', { name: 'Archive' }));
    // No bulk archive route: one request per item.
    await waitFor(() => {
      expect(posts(calls, '/n1/archive')).toHaveLength(1);
      expect(posts(calls, '/n2/archive')).toHaveLength(1);
    });
    await waitFor(() => expect(screen.queryByRole('toolbar')).toBeNull());
    expect(MAX_SELECTION).toBe(50);
  });

  it('empty, and empty under a filter', async () => {
    const { user } = show(<NotificationFeed />, {
      'GET /api/v1/notifications/unread-count': ok({ count: 0 }),
      'GET /api/v1/notifications': page([], null),
    });
    expect(
      await screen.findByRole('heading', { name: 'No notifications yet' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Unread only' }));
    expect(
      await screen.findByRole('heading', { name: 'No notifications match' }),
    ).toBeInTheDocument();
  });
});

describe('notification settings', () => {
  const prefs = (types: string[]) =>
    ok(
      ['*', ...types].flatMap((type) =>
        ['IN_APP', 'EMAIL', 'SMS', 'PUSH'].map((channel) => ({
          type,
          channel,
          isEnabled: channel !== 'SMS',
          digest: 'IMMEDIATE',
          source: type === '*' && channel === 'EMAIL' ? 'EXPLICIT' : 'DEFAULT',
        })),
      ),
    );
  const ALL = [
    'ticket.assigned',
    'ticket.reassigned',
    'ticket.escalated',
    'ticket.status_changed',
    'ticket.message_created',
    'quota.threshold',
    'limit.threshold',
    'billing.payment_failed',
    'billing.plan_changed',
    'webhook.endpoint_disabled',
  ];

  function settings(
    codes: string[],
    user: object,
    patch: Reply | (() => Reply),
  ) {
    return show(<NotificationPreferences />, {
      'GET /api/v1/users/me': ME(codes, user),
      'GET /api/v1/notifications/unread-count': ok({ count: 0 }),
      'GET /api/v1/notifications/preferences': prefs(ALL),
      'PATCH /api/v1/notifications/preferences': patch,
    });
  }

  it('in-app, email and SMS, never push; saves a change as it’s made', async () => {
    const { calls, user } = settings(
      ['organization.update'],
      {},
      ok({ type: 'ticket.message_created', channel: 'EMAIL' }),
    );
    const table = await screen.findByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Type', 'In-app', 'Email', 'SMS']);
    expect(
      within(table).getByRole('rowheader', { name: /Payment failed/ }),
    ).toBeInTheDocument();
    const email = within(table).getByRole('switch', {
      name: 'New messages, Email',
    });
    expect(email).toHaveAccessibleDescription('Default');

    await user.click(email);
    await waitFor(() =>
      expect(calls.find(({ method }) => method === 'PATCH')?.body).toEqual({
        type: 'ticket.message_created',
        channel: 'EMAIL',
        isEnabled: false,
      }),
    );
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('a member sees the ticket types and the note; SMS waits for a verified phone', async () => {
    settings([], { isPhoneVerified: false }, ok({}));
    const table = await screen.findByRole('table');
    expect(
      screen.getByText('Some notifications are for administrators'),
    ).toBeInTheDocument();
    expect(
      within(table).queryByRole('rowheader', { name: /Payment failed/ }),
    ).toBeNull();
    const sms = within(table).getByRole('switch', {
      name: 'Assigned to you, SMS',
    });
    expect(sms).toBeDisabled();
    expect(sms).toHaveAccessibleDescription(
      'Verify a phone number to get texts.',
    );
  });

  it('a failed save puts the switch back, says so, and keeps focus', async () => {
    const { user } = settings(['organization.update'], {}, fail(500, 'Down'));
    const table = await screen.findByRole('table');
    const inApp = within(table).getByRole('switch', {
      name: 'Escalated, In-app',
    });
    expect(inApp).toBeChecked();

    await user.click(inApp);
    expect(
      await screen.findByText('Couldn’t save that change'),
    ).toBeInTheDocument();
    await waitFor(() => expect(inApp).toBeChecked());
    expect(inApp).toHaveFocus();
  });
});
