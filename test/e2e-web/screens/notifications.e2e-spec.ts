import {
  expect,
  test,
  type Page,
  type Route,
  type WebSocketRoute,
} from '../coverage';
import { REALTIME_EVENTS } from '@synapsedesk/contracts';
import { api } from '../support';
import { look } from './look';
import { sessionAs, setPhone, signInAs, tenant } from './tenant';

/**
 * The bell, its live toasts, all notifications and notification settings, in
 * every state, light and dark, at both widths. The people and tickets are the
 * tenant's (tenant.ts); the notifications are answered at the network with the
 * examples the designs draw, so every run draws the same feed. Live states play
 * the gateway's frames into the page's own socket.
 */

const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const DAY = 24 * 60;

type Item = {
  id: string;
  type: string;
  priority: string;
  title: string;
  body: string | null;
  actorId: string | null;
  groupCount?: number;
  minutes: number;
  read?: boolean;
  archived?: boolean;
  actionUrl?: string | null;
};

/**
 * The tenant's people by first name, so an item's actor is someone the page
 * knows and draws with their initials. Set before every row.
 */
let people: Record<string, string> = {};
test.beforeEach(async () => {
  const { maya, jordan, priya } = await tenant('bell');
  people = { maya: maya.id, jordan: jordan.id, priya: priya.id };
});

/** A notification row as the gateway returns it. */
const row = (item: Item) => ({
  id: item.id,
  organizationId: 'o1',
  type: item.type,
  priority: item.priority,
  title: item.title,
  body: item.body,
  data: {},
  actionUrl: item.actionUrl === undefined ? '/tickets/1042' : item.actionUrl,
  actorId: item.actorId && (people[item.actorId] ?? item.actorId),
  resourceType: item.type.startsWith('ticket.') ? 'TICKET' : 'ORGANIZATION',
  resourceId: null,
  groupKey: null,
  groupCount: item.groupCount ?? 1,
  readAt: item.read ? ago(item.minutes) : null,
  archivedAt: item.archived ? ago(item.minutes) : null,
  createdAt: ago(item.minutes),
});

/** The agent's feed, as design 06 draws it. */
const AGENT: Item[] = [
  {
    id: 'a1',
    type: 'ticket.message_created',
    priority: 'NORMAL',
    title: '3 new replies on #1042',
    body: 'Priya Shah: Thanks! Does the allowance reset in January or on my start date?',
    actorId: 'priya',
    groupCount: 3,
    minutes: 5,
  },
  {
    id: 'a2',
    type: 'ticket.assigned',
    priority: 'HIGH',
    title: 'Jordan Lee assigned #1051 to you',
    body: 'Does the allowance reset in January or on my start date?',
    actorId: 'jordan',
    minutes: 20,
  },
  {
    id: 'a3',
    type: 'quota.threshold',
    priority: 'NORMAL',
    title: 'You’ve used 95% of this month’s AI allowance',
    body: 'At 100%, every self-service question goes to your agents as a ticket.',
    actorId: null,
    minutes: 60,
    actionUrl: '/settings/billing',
  },
  {
    id: 'a4',
    type: 'billing.payment_failed',
    priority: 'CRITICAL',
    title: 'A payment failed',
    body: 'Update the card on file to keep Northwind Health active.',
    actorId: null,
    minutes: 120,
    actionUrl: '/settings/billing',
  },
  {
    id: 'a5',
    type: 'ticket.escalated',
    priority: 'HIGH',
    title: '#1042 was escalated',
    body: 'Priya Shah asked for a person.',
    actorId: 'priya',
    minutes: DAY + 30,
    read: true,
  },
  {
    id: 'a6',
    type: 'ticket.status_changed',
    priority: 'NORMAL',
    title: '#1019 was resolved',
    body: 'Sam Okafor resolved it.',
    actorId: 'sam',
    minutes: DAY + 60,
    read: true,
  },
  {
    id: 'a7',
    type: 'webhook.endpoint_disabled',
    priority: 'HIGH',
    title: 'A webhook was turned off',
    body: '“Slack alerts” failed 50 times in a row.',
    actorId: null,
    minutes: 4 * DAY,
    read: true,
    actionUrl: null,
  },
  {
    id: 'a8',
    type: 'limit.threshold',
    priority: 'NORMAL',
    title: 'Agent seats are at 80%',
    body: '16 of 20 seats used, counting pending invitations.',
    actorId: null,
    minutes: 4 * DAY + 60,
    read: true,
    actionUrl: '/settings/billing',
  },
  {
    id: 'a9',
    type: 'billing.plan_changed',
    priority: 'NORMAL',
    title: 'Your plan changed to Pro',
    body: null,
    actorId: null,
    minutes: 5 * DAY,
    read: true,
    actionUrl: '/settings/billing',
  },
  {
    id: 'a10',
    type: 'ticket.reassigned',
    priority: 'HIGH',
    title: '#1037 was reassigned to Sam Okafor',
    body: null,
    actorId: 'jordan',
    minutes: 5 * DAY + 60,
    read: true,
  },
];

/** The end user's: replies and status changes on their own requests. */
const REQUESTER: Item[] = [
  {
    id: 'r1',
    type: 'ticket.message_created',
    priority: 'NORMAL',
    title: 'Maya Chen replied on #1042',
    body: 'Yes, desks are in scope this year. Send me the quote.',
    actorId: 'maya',
    minutes: 10,
  },
  {
    id: 'r2',
    type: 'ticket.status_changed',
    priority: 'NORMAL',
    title: '#1019 was resolved',
    body: 'Maya Chen resolved it.',
    actorId: 'maya',
    minutes: DAY + 60,
    read: true,
  },
];

type Answer = object | ((route: Route) => unknown) | 'hang';

/**
 * The notification endpoints, answered here: the count, the list (filtered
 * as the server would), and the writes. `state` can change mid-row.
 */
async function notifications(
  page: Page,
  state: { count: number; items: Item[]; list?: Answer },
) {
  const ok = (data: unknown) => ({
    json: { success: true, statusCode: 200, message: 'OK', data },
  });
  await page.route('**/api/v1/notifications/unread-count', (route) =>
    route.fulfill(ok({ count: state.count })),
  );
  await page.route('**/api/v1/notifications?*', async (route) => {
    if (state.list === 'hang') return;
    if (typeof state.list === 'function') return state.list(route);
    if (state.list) return route.fulfill(state.list);
    const query = new URL(route.request().url()).searchParams;
    const items = state.items
      .filter((item) => query.get('unreadOnly') !== 'true' || !item.read)
      .filter(
        (item) => query.get('includeArchived') === 'true' || !item.archived,
      )
      .filter((item) => !query.get('type') || item.type === query.get('type'));
    return route.fulfill(
      ok({ items: items.map(row), nextCursor: null, hasMore: false }),
    );
  });
  await page.route('**/api/v1/notifications/read', (route) => {
    state.items = state.items.map((item) => ({ ...item, read: true }));
    state.count = 0;
    return route.fulfill(ok({ updated: 1, unreadCount: 0 }));
  });
}

const failed = (status: number) => ({
  status,
  json: { success: false, statusCode: status, message: 'Failed' },
});

/**
 * The page's own socket, with frames played into it: only once the server has
 * said `connection:ready` on it, and on the latest such socket, since a page
 * can open a second one (a frame sent to the first would go nowhere).
 */
async function tap(page: Page) {
  let socket: WebSocketRoute | undefined;
  await page.routeWebSocket(/\/socket\.io\//, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((frame) => server.send(frame));
    server.onMessage((frame) => {
      ws.send(frame);
      if (String(frame).includes(REALTIME_EVENTS.connectionReady)) socket = ws;
    });
  });
  return async (event: string, data: unknown) => {
    await expect.poll(() => socket !== undefined).toBe(true);
    await page.waitForTimeout(500);
    // Notification frames come as the payload itself, with no envelope.
    socket!.send(`42/ws,${JSON.stringify([event, data])}`);
  };
}

/** A live payload, as notification-service publishes it. */
const live = (over: object) => ({
  organizationId: 'o1',
  recipientId: 'maya',
  notificationId: 'n-live',
  type: 'ticket.assigned',
  priority: 'HIGH',
  title: 'Jordan Lee assigned #1052 to you',
  body: 'Laptop won’t connect to the office Wi-Fi',
  data: { ticketId: 't-other', ticketNumber: 1052 },
  actionUrl: '/tickets/1052',
  groupKey: null,
  groupCount: 1,
  occurredAt: new Date().toISOString(),
  ...over,
});

const bell = (page: Page) =>
  page.getByRole('button', { name: /^Notifications/ });
const panel = (page: Page) =>
  page.getByRole('dialog', { name: 'Notifications' });
/**
 * Day headings older than yesterday read a date, which moves every day. By tag
 * rather than role: an open menu hides the rest of the page from the
 * accessibility tree, and the date with it.
 */
const datedHeadings = (page: Page) =>
  page.locator('h2').filter({ hasText: /^\d{1,2} [A-Z][a-z]{2}$/ });
/** The page's own alert: Next.js's route announcer is an `alert` too. */
const alert = (page: Page) => page.getByRole('main').getByRole('alert');
/** Radix's modal menus hide the page and trap focus; axe sees only the hiding. */
const MENU = ['aria-hidden-focus'];

test.describe('the bell', () => {
  test.beforeEach(async ({ page }) => {
    const { maya } = await tenant('bell');
    await signInAs(page, maya);
  });

  test('the badge: the server’s count', async ({ page }) => {
    await notifications(page, { count: 4, items: AGENT });
    await page.goto('/tickets');
    await expect(bell(page)).toHaveAccessibleName('Notifications, 4 unread');
    await look(page, 'bell-badge', { viewportOnly: true });
  });

  test('open: the latest', async ({ page }) => {
    await notifications(page, { count: 4, items: AGENT.slice(0, 6) });
    await page.goto('/tickets');
    await bell(page).click();
    await expect(
      panel(page).getByRole('link', { name: /3 new replies on #1042/ }),
    ).toBeVisible();
    await look(page, 'bell-open', { viewportOnly: true, disabled: MENU });
  });

  test('Unread only', async ({ page }) => {
    await notifications(page, { count: 4, items: AGENT.slice(0, 6) });
    await page.goto('/tickets');
    await bell(page).click();
    await panel(page).getByRole('tab', { name: 'Unread' }).click();
    await expect(
      panel(page).getByRole('link', { name: /#1042 was escalated/ }),
    ).toHaveCount(0);
    await look(page, 'bell-unread', { viewportOnly: true, disabled: MENU });
  });

  test('an item’s actions', async ({ page }) => {
    await notifications(page, { count: 4, items: AGENT.slice(0, 6) });
    await page.goto('/tickets');
    await bell(page).click();
    await panel(page)
      .getByRole('button', {
        name: 'Actions for Jordan Lee assigned #1051 to you',
      })
      .click();
    await expect(page.getByRole('menuitem', { name: 'Archive' })).toBeVisible();
    await look(page, 'bell-item-actions', {
      viewportOnly: true,
      disabled: MENU,
    });
  });

  test('all caught up', async ({ page }) => {
    await notifications(page, { count: 0, items: [] });
    await page.goto('/tickets');
    await expect(bell(page)).toHaveAccessibleName('Notifications');
    await bell(page).click();
    await expect(panel(page).getByText('You’re all caught up')).toBeVisible();
    await look(page, 'bell-caught-up', { viewportOnly: true, disabled: MENU });
  });

  test('loading', async ({ page }) => {
    await notifications(page, { count: 4, items: [], list: 'hang' });
    await page.goto('/tickets');
    await bell(page).click();
    await expect(panel(page).getByText('Loading notifications')).toBeAttached();
    await look(page, 'bell-loading', { viewportOnly: true, disabled: MENU });
  });

  test('error', async ({ page }) => {
    await notifications(page, { count: 4, items: [], list: failed(500) });
    await page.goto('/tickets');
    await bell(page).click();
    await expect(
      panel(page).getByText('Couldn’t load notifications'),
    ).toBeVisible();
    await look(page, 'bell-error', { viewportOnly: true, disabled: MENU });
  });
});

test('the bell, for an end user: replies and status changes', async ({
  page,
}) => {
  const { priya } = await tenant('bell');
  await signInAs(page, priya);
  await notifications(page, { count: 1, items: REQUESTER });
  await page.goto('/requests');
  await bell(page).click();
  await expect(
    panel(page).getByRole('link', { name: /Maya Chen replied on #1042/ }),
  ).toBeVisible();
  await look(page, 'bell-requester', { viewportOnly: true, disabled: MENU });
});

test.describe('live', () => {
  test.beforeEach(async ({ page }) => {
    const { maya } = await tenant('bell');
    await signInAs(page, maya);
  });

  test('a new one: a toast, and the badge from the server', async ({
    page,
  }) => {
    const state = { count: 4, items: AGENT.slice(0, 6) };
    await notifications(page, state);
    const play = await tap(page);
    await page.goto('/tickets');
    await expect(bell(page)).toHaveAccessibleName('Notifications, 4 unread');
    state.count = 5;
    await play(REALTIME_EVENTS.notificationNew, live({}));
    await expect(
      page.getByText('Jordan Lee assigned #1052 to you'),
    ).toBeVisible();
    await expect(bell(page)).toHaveAccessibleName('Notifications, 5 unread');
    await look(page, 'live-toast', { viewportOnly: true });
  });

  test('a group, still unread, updates its toast in place', async ({
    page,
  }) => {
    await notifications(page, { count: 4, items: AGENT.slice(0, 6) });
    const play = await tap(page);
    await page.goto('/tickets');
    const reply = (n: number) =>
      live({
        notificationId: 'a1',
        type: 'ticket.message_created',
        priority: 'NORMAL',
        groupKey: 'ticket:1042:replies',
        title: `${n} new replies on #1042`,
        body: 'Priya Shah: And is a chair covered too?',
        data: { ticketId: 't-1042', ticketNumber: 1042 },
        actionUrl: '/tickets/1042',
      });
    await play(REALTIME_EVENTS.notificationNew, reply(3));
    await expect(page.getByText('3 new replies on #1042')).toBeVisible();
    await play(REALTIME_EVENTS.notificationUpdated, reply(4));
    await expect(page.getByText('4 new replies on #1042')).toBeVisible();
    // Counted once: the old title must be gone now, not after a fade.
    expect(await page.getByText('3 new replies on #1042').count()).toBe(0);
    await look(page, 'live-group-update', { viewportOnly: true });
  });

  test('HIGH and CRITICAL stay until dismissed', async ({ page }) => {
    await notifications(page, { count: 6, items: AGENT.slice(0, 6) });
    const play = await tap(page);
    await page.goto('/tickets');
    await play(REALTIME_EVENTS.notificationNew, live({}));
    await play(
      REALTIME_EVENTS.notificationNew,
      live({
        notificationId: 'n-pay',
        type: 'billing.payment_failed',
        priority: 'CRITICAL',
        title: 'A payment failed',
        body: 'Update the card on file to keep Northwind Health active.',
        data: {},
        actionUrl: '/settings/billing',
      }),
    );
    await expect(page.getByText('A payment failed')).toBeVisible();
    // Past a NORMAL toast's six seconds, both are still there.
    await page.waitForTimeout(7_000);
    await expect(
      page.getByText('Jordan Lee assigned #1052 to you'),
    ).toBeVisible();
    await look(page, 'live-lasting', { viewportOnly: true });
  });

  test('no toast for the ticket on screen', async ({ page }) => {
    const { tickets } = await tenant('bell');
    await notifications(page, { count: 4, items: AGENT.slice(0, 6) });
    const play = await tap(page);
    await page.goto(`/tickets/${tickets.desk}`);
    await expect(page.getByRole('log', { name: 'Conversation' })).toBeVisible();
    // News about this ticket: nothing.
    await play(
      REALTIME_EVENTS.notificationNew,
      live({
        notificationId: 'n-this',
        type: 'ticket.message_created',
        priority: 'NORMAL',
        title: 'Priya Shah replied on #1042',
        data: { ticketId: tickets.desk, ticketNumber: 1042 },
      }),
    );
    await page.waitForTimeout(1_500);
    // Counted once, not retried: a retrying "none" would wait out a NORMAL
    // toast's six seconds and pass anyway.
    expect(await page.locator('[data-sonner-toast]').count()).toBe(0);
    // Then news about another: it toasts, so the frame before it arrived too
    // (one socket, in order).
    await play(
      REALTIME_EVENTS.notificationNew,
      live({ notificationId: 'n-other' }),
    );
    await expect(
      page.getByText('Jordan Lee assigned #1052 to you'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
    await look(page, 'live-open-ticket', { viewportOnly: true });
  });

  test('read on another device', async ({ page }) => {
    const state = { count: 4, items: AGENT.slice(0, 6) };
    await notifications(page, state);
    const play = await tap(page);
    await page.goto('/tickets');
    await expect(bell(page)).toHaveAccessibleName('Notifications, 4 unread');
    state.items = state.items.map((item) =>
      item.id === 'a3' ? item : { ...item, read: true },
    );
    await play(REALTIME_EVENTS.notificationRead, {
      recipientId: 'maya',
      notificationIds: ['a1', 'a2', 'a4'],
      change: 'read',
      unreadCount: 1,
    });
    await expect(bell(page)).toHaveAccessibleName('Notifications, 1 unread');
    await bell(page).click();
    await expect(
      panel(page).getByRole('link', { name: /^Unread\., You’ve used 95%/ }),
    ).toBeVisible();
    await look(page, 'live-read-elsewhere', {
      viewportOnly: true,
      disabled: MENU,
    });
  });
});

test.describe('where a notification leads', () => {
  test('a ticket number opens the ticket', async ({ page }) => {
    const { maya, tickets } = await tenant('bell');
    await signInAs(page, maya);
    const mayas = await sessionAs(maya);
    const { ticketNumber } = await api<{ ticketNumber: number }>(
      mayas,
      'GET',
      `/tickets/${tickets.desk}`,
    );
    await mayas.dispose();
    await page.goto(`/tickets/${ticketNumber}?from=notification`);
    await expect(page).toHaveURL(
      new RegExp(`/tickets/${tickets.desk}\\?from=notification$`),
    );
    await expect(
      page.getByRole('heading', { name: 'Allowance for a standing desk' }),
    ).toBeVisible();
  });

  test('a number the person can’t see: not found, with the way back', async ({
    page,
  }) => {
    const { maya } = await tenant('bell');
    await signInAs(page, maya);
    await page.goto('/tickets/999999999?from=notification');
    await expect(
      page.getByRole('heading', { name: 'We can’t find that ticket' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Back to notifications' }),
    ).toHaveAttribute('href', '/notifications');
    await look(page, 'notification-not-found');
  });
});

test.describe('all notifications', () => {
  test.beforeEach(async ({ page }) => {
    const { maya } = await tenant('bell');
    await signInAs(page, maya);
  });

  const open = async (page: Page) => {
    await page.goto('/notifications');
    await expect(
      page.getByRole('heading', { name: 'Notifications', level: 1 }),
    ).toBeVisible();
  };
  const shot = (page: Page, name: string, extra: object = {}) =>
    look(page, name, { mask: [datedHeadings(page)], ...extra });

  test('the feed by day, with Load more', async ({ page }) => {
    let first = true;
    await notifications(page, {
      count: 4,
      items: AGENT,
      list: (route: Route) => {
        const answer = {
          json: {
            success: true,
            statusCode: 200,
            message: 'OK',
            data: {
              items: AGENT.map(row),
              nextCursor: first ? 'c2' : null,
              hasMore: first,
            },
          },
        };
        return route.fulfill(answer);
      },
    });
    await open(page);
    await expect(page.getByRole('button', { name: 'Load more' })).toBeVisible();
    await shot(page, 'feed');
    first = false;
  });

  test('selection', async ({ page }) => {
    await notifications(page, { count: 4, items: AGENT });
    await open(page);
    await page
      .getByRole('checkbox', { name: 'Select 3 new replies on #1042' })
      .check();
    await page
      .getByRole('checkbox', {
        name: 'Select Jordan Lee assigned #1051 to you',
      })
      .check();
    await expect(page.getByRole('toolbar')).toContainText('2 selected');
    await shot(page, 'feed-selection');
  });

  test('the type filter, open', async ({ page }) => {
    await notifications(page, { count: 4, items: AGENT });
    await open(page);
    await page.getByRole('combobox', { name: 'Type' }).click();
    await expect(
      page.getByRole('option', { name: 'Payment failed' }),
    ).toBeVisible();
    await shot(page, 'feed-type-filter', {
      viewportOnly: true,
      disabled: MENU,
    });
  });

  test('show archived', async ({ page }) => {
    await notifications(page, {
      count: 4,
      items: [
        ...AGENT.slice(0, 4),
        { ...AGENT[5], archived: true },
        { ...AGENT[7], archived: true },
      ],
    });
    await open(page);
    await page.getByRole('button', { name: 'Show archived' }).click();
    await expect(page.getByText('Archived').first()).toBeVisible();
    await shot(page, 'feed-archived');
  });

  test('the end of the feed', async ({ page }) => {
    await notifications(page, { count: 0, items: AGENT.slice(4) });
    await open(page);
    await expect(page.getByText('That’s everything.')).toBeVisible();
    await shot(page, 'feed-end');
  });

  test('empty', async ({ page }) => {
    await notifications(page, { count: 0, items: [] });
    await open(page);
    await expect(
      page.getByRole('heading', { name: 'No notifications yet' }),
    ).toBeVisible();
    await shot(page, 'feed-empty');
  });

  test('empty under a filter', async ({ page }) => {
    await notifications(page, {
      count: 0,
      items: AGENT.map((item) => ({ ...item, read: true })),
    });
    await open(page);
    await page.getByRole('button', { name: 'Unread only' }).click();
    await expect(
      page.getByRole('heading', { name: 'No notifications match' }),
    ).toBeVisible();
    await shot(page, 'feed-empty-filter');
  });

  test('loading', async ({ page }) => {
    await notifications(page, { count: 4, items: [], list: 'hang' });
    await open(page);
    await expect(
      page.getByText('Loading notifications').first(),
    ).toBeAttached();
    await shot(page, 'feed-loading');
  });

  test('error', async ({ page }) => {
    await notifications(page, { count: 4, items: [], list: failed(500) });
    await open(page);
    await expect(alert(page)).toContainText('Couldn’t load notifications');
    await shot(page, 'feed-error');
  });
});

/** The settings the design draws: email on for all, a few set by hand. */
function preferences(page: Page, types: string[]) {
  const explicit = new Set([
    '*|EMAIL',
    'ticket.escalated|SMS',
    'ticket.status_changed|EMAIL',
    'ticket.message_created|EMAIL',
  ]);
  const items = ['*', ...types].flatMap((type) =>
    ['IN_APP', 'EMAIL', 'SMS', 'PUSH'].map((channel) => {
      const key = `${type}|${channel}`;
      return {
        type,
        channel,
        isEnabled:
          channel === 'SMS'
            ? key === 'ticket.escalated|SMS'
            : key !== 'ticket.status_changed|EMAIL',
        digest: key === 'ticket.message_created|EMAIL' ? 'HOURLY' : 'IMMEDIATE',
        source: explicit.has(key)
          ? 'EXPLICIT'
          : channel === 'EMAIL' && type !== '*'
            ? 'WILDCARD'
            : 'DEFAULT',
      };
    }),
  );
  return page.route('**/api/v1/notifications/preferences', (route) =>
    route.fulfill({
      json: { success: true, statusCode: 200, message: 'OK', data: items },
    }),
  );
}
const EVERY_TYPE = AGENT.map((item) => item.type);

test.describe('notification settings', () => {
  const open = async (page: Page) => {
    await page.goto('/notifications/settings');
    await expect(
      page.getByRole('heading', { name: 'Notification settings', level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole('switch').first()).toBeVisible();
  };

  test('an administrator with a verified phone', async ({ page }) => {
    const { maya } = await tenant('settings-phone');
    await setPhone(maya, '+15555550123');
    await signInAs(page, maya);
    await notifications(page, { count: 4, items: [] });
    await preferences(page, EVERY_TYPE);
    await open(page);
    await look(page, 'settings-admin');
  });

  test('email’s how-often, open', async ({ page }) => {
    const { maya } = await tenant('settings-phone');
    await setPhone(maya, '+15555550123');
    await signInAs(page, maya);
    await notifications(page, { count: 4, items: [] });
    await preferences(page, EVERY_TYPE);
    await open(page);
    await page
      .getByRole('combobox', { name: 'New messages, Email, how often' })
      .first()
      .click();
    await expect(page.getByRole('option', { name: 'Daily' })).toBeVisible();
    await look(page, 'settings-digest', { viewportOnly: true, disabled: MENU });
  });

  test('without a verified phone: SMS waits', async ({ page }) => {
    const { maya } = await tenant('bell');
    await signInAs(page, maya);
    await notifications(page, { count: 4, items: [] });
    await preferences(page, EVERY_TYPE);
    await open(page);
    await expect(
      page.getByRole('switch', { name: 'Assigned to you, SMS' }).first(),
    ).toBeDisabled();
    await look(page, 'settings-no-phone');
  });

  test('a member: ticket types, and the note', async ({ page }) => {
    const { priya } = await tenant('bell');
    await signInAs(page, priya);
    await notifications(page, { count: 1, items: [] });
    await preferences(page, EVERY_TYPE);
    await open(page);
    await expect(
      page.getByText('Some notifications are for administrators'),
    ).toBeVisible();
    await look(page, 'settings-member');
  });

  test('a save that failed', async ({ page }) => {
    const { maya } = await tenant('settings-phone');
    await setPhone(maya, '+15555550123');
    await signInAs(page, maya);
    await notifications(page, { count: 4, items: [] });
    await preferences(page, EVERY_TYPE);
    await page.route('**/api/v1/notifications/preferences', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill(failed(500))
        : route.fallback(),
    );
    await open(page);
    const inApp = page
      .getByRole('switch', { name: 'Escalated, In-app' })
      .first();
    await inApp.click();
    await expect(page.getByText('Couldn’t save that change')).toBeVisible();
    await expect(inApp).toBeChecked();
    await look(page, 'settings-save-failed', { viewportOnly: true });
  });

  test('the account menu', async ({ page }) => {
    const { maya, tickets } = await tenant('bell');
    // The list behind the menu draws the desk ticket read, whichever rows ran.
    const mayas = await sessionAs(maya);
    await api(mayas, 'POST', `/tickets/${tickets.desk}/read`);
    await mayas.dispose();
    await signInAs(page, maya);
    await notifications(page, { count: 4, items: [] });
    await page.goto('/tickets');
    await page.getByRole('button', { name: 'Account' }).click();
    await expect(
      page.getByRole('menuitem', { name: 'Notification settings' }),
    ).toBeVisible();
    await look(page, 'account-menu-notifications', {
      viewportOnly: true,
      widths: ['desktop'],
      disabled: MENU,
    });
  });
});
