import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  request as newRequest,
  type APIRequestContext,
} from '@playwright/test';
import { PrismaClient as TicketPrisma } from '../../services/ticket-service/src/generated/prisma/client';
import { expect, test, type Page } from './coverage';
import { WEB_URL } from './ingress';
import { REPO_ROOT } from '../system/services';
import {
  databaseUrl,
  documentFlag,
  knowledgeDocument,
  sessionAs,
  setAnalyticsRange,
  signInAs,
  tenant,
  type Tenant,
} from './screens/tenant';
import { api, clearThrottles } from './support';

/**
 * Analytics end to end: the journey's own organization, its rollups
 * backfilled by the Super Admin for that organization only, read back on the
 * pages. Two of its tickets are moved 40 days back, so the overview has a
 * previous period to compare with.
 */
test.beforeEach(clearThrottles);
test.describe.configure({ mode: 'serial' });

const DAY = 86_400_000;
const iso = (offset: number) =>
  new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const longDay = (day: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
    .format(new Date(`${day}T00:00:00Z`))
    .replace('Sep ', 'Sept ');

let t: Tenant;
let organizationId: string;
/** What the rows hold, read from ticket-service's database. */
let created: { now: number; before: number };
let feedbackTicket: { id: string; number: bigint };

/** The Super Admin from auth-service's own `.env`: the suite's first use. */
async function superAdmin(): Promise<APIRequestContext> {
  const env = readFileSync(
    join(REPO_ROOT, 'services/auth-service/.env'),
    'utf8',
  );
  const read = (key: string) =>
    new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm').exec(env)?.[1]?.trim();
  const session = await newRequest.newContext({ baseURL: WEB_URL });
  await api(session, 'POST', '/auth/login', {
    email: read('SUPER_ADMIN_EMAIL'),
    password: read('SUPER_ADMIN_PASSWORD'),
  });
  return session;
}

test.beforeAll(async () => {
  t = await tenant('analytics-journey');
  const maya = await sessionAs(t.maya);
  organizationId = (
    await api<{ id: string }>(maya, 'GET', '/organizations/current')
  ).id;
  await maya.dispose();

  const prisma = new TicketPrisma({
    adapter: new PrismaPg({ connectionString: databaseUrl('ticket-service') }),
  });
  try {
    // The previous period: two tickets, 40 days back.
    for (const id of [t.tickets.printer, t.tickets.billing]) {
      await prisma.ticket.update({
        where: { id },
        data: { createdAt: new Date(Date.now() - 40 * DAY) },
      });
    }
    const since = new Date(`${iso(-29)}T00:00:00Z`);
    const window = new Date(`${iso(-59)}T00:00:00Z`);
    created = {
      now: await prisma.ticket.count({
        where: { organizationId, createdAt: { gte: since } },
      }),
      before: await prisma.ticket.count({
        where: { organizationId, createdAt: { gte: window, lt: since } },
      }),
    };
    const answer = await prisma.ticketMessage.findFirstOrThrow({
      where: { ticketId: t.tickets.desk, answerStatus: 'DOC_ANSWER' },
      select: { id: true, ticket: { select: { ticketNumber: true } } },
    });
    feedbackTicket = { id: t.tickets.desk, number: answer.ticket.ticketNumber };
    const priya = await sessionAs(t.priya);
    await api(priya, 'POST', `/messages/${answer.id}/feedback`, {
      rating: -1,
      feedbackText: 'The allowance figure is out of date.',
      citationAccurate: false,
    });
    await priya.dispose();
  } finally {
    await prisma.$disconnect();
  }

  // A document nobody's question finds, flagged as the writer would.
  const document = await knowledgeDocument(t.maya, organizationId, {
    title: 'Parking permits.pdf',
    passages: [{ page: 1, text: 'Permits are issued by Facilities.' }],
  });
  await documentFlag(organizationId, document.id, {
    flagType: 'UNRETRIEVED',
    severity: 'INFO',
    detail: 'No question has found this document yet.',
  });

  const admin = await superAdmin();
  for (const job of ['analytics-daily', 'ledger-daily']) {
    await api(admin, 'POST', `/platform/jobs/${job}/backfill`, {
      from: iso(-70),
      to: iso(0),
      reason: 'Analytics journey',
      organizationId,
    });
  }
  await admin.dispose();
});

async function open(page: Page, path = '/analytics') {
  await signInAs(page, t.maya);
  await page.goto(path);
}

test('an Org Admin reads the overview: its tiles, the change, and Data through', async ({
  page,
}) => {
  await open(page);
  const tickets = page.locator('dl > div').filter({
    has: page.getByText('Tickets created', { exact: true }),
  });
  await expect(tickets).toContainText(String(created.now));
  const moved = Math.round(
    ((created.now - created.before) / created.before) * 100,
  );
  await expect(tickets).toContainText(
    `${moved > 0 ? '+' : '−'}${Math.abs(moved)}% vs the previous 30 days`,
  );
  await expect(page.getByText(`Data through ${longDay(iso(0))}`)).toBeVisible();
});

test('the filters change the charts and stay in the address across pages', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('combobox', { name: 'Department' }).click();
  await page.getByRole('option', { name: 'Workplace' }).click();
  await expect(page).toHaveURL(new RegExp(`department=${t.departmentId}`));
  await page.getByRole('radio', { name: 'Week' }).click();
  await expect(page).toHaveURL(/by=week/);
  await expect(
    page.getByText('Tickets created, resolved and escalated. Per week.'),
  ).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Analytics' })
    .getByRole('link', { name: 'Agents' })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/analytics/agents\\?.*department=${t.departmentId}.*by=week`),
  );
  await page
    .getByRole('navigation', { name: 'Analytics' })
    .getByRole('link', { name: 'AI usage' })
    .click();
  await expect(page).toHaveURL(/\/analytics\/ai-usage\?.*by=week/);
  await expect(page.getByRole('combobox', { name: 'Department' })).toHaveCount(
    0,
  );
  await expect(
    page.getByText('These numbers are for the whole organization.'),
  ).toBeVisible();
});

test('the picker stops at the plan’s limit, and an export past it is refused', async ({
  page,
}) => {
  // Its own organization, on 30 days from the start: the gateway holds an
  // organization it has read, as it would until the plan changes.
  const small = await tenant('analytics-limit');
  await setAnalyticsRange(small.maya, 30);
  await signInAs(page, small.maya);
  await page.goto('/analytics');
  await page
    .getByRole('button', { name: /30 days/ })
    .first()
    .click();
  await expect(
    page.getByRole('option', { name: 'Last 90 days' }),
  ).toHaveAttribute('aria-disabled', 'true');
  await expect(
    page.getByText('Your plan shows up to 30 days at a time.'),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  const maya = await sessionAs(small.maya);
  const refused = await maya.post('/api/v1/analytics/export', {
    data: { kind: 'TICKET_DAILY', from: iso(-59), to: iso(0) },
  });
  expect(refused.status()).toBe(400);
  expect(await refused.text()).toContain('the maximum is 30');
  await maya.dispose();
});

test('Knowledge: a flag opens its document, and every flag is one link away', async ({
  page,
}) => {
  await open(page, '/analytics/knowledge');
  await page
    .getByRole('region', { name: 'Open quality flags' })
    .getByRole('link', { name: 'Parking permits.pdf' })
    .click();
  await expect(page).toHaveURL(/\/knowledge\/documents\//);
  await page.goBack();
  await page.getByRole('link', { name: 'All quality flags' }).click();
  await expect(page).toHaveURL(/\/knowledge\/flags/);
});

test('Feedback: a rating appears, and its row opens the ticket', async ({
  page,
}) => {
  await open(page, '/analytics/feedback');
  await expect(
    page.getByText('The allowance figure is out of date.').first(),
  ).toBeVisible();
  await page
    .getByRole('link', { name: `Ticket #${feedbackTicket.number}` })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/tickets/${feedbackTicket.id}`));
});

test('Export: tickets per day, preparing then ready, and the file downloads', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Export' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export analytics' });
  await dialog.getByRole('radio', { name: 'Tickets per day' }).click();
  await dialog.getByRole('button', { name: 'Export' }).click();
  await expect(
    page
      .getByRole('main')
      .getByText(/Preparing your export|Your export is ready/),
  ).toBeVisible();
  const download = page.getByRole('button', { name: 'Download CSV' });
  await expect(download).toBeVisible({ timeout: 90_000 });
  const fetched = page
    .context()
    .waitForEvent('request', (request) => /\.csv(\?|$)/.test(request.url()));
  await download.click();
  const csv = await page.request.get((await fetched).url());
  expect(csv.ok()).toBe(true);
  expect(await csv.text()).toContain('tickets_created');
});

test('a Support Agent has no Analytics entry', async ({ page }) => {
  await signInAs(page, t.jordan);
  await page.goto('/tickets');
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', {
      name: 'Tickets',
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', {
      name: 'Analytics',
    }),
  ).toHaveCount(0);
});

test('a Knowledge Manager reads everything here, the department filter included', async ({
  page,
}) => {
  const maya = await sessionAs(t.maya);
  const { items: roles } = await api<{ items: { id: string; name: string }[] }>(
    maya,
    'GET',
    '/roles?limit=50&includeSystem=true',
  );
  const manager = roles.find((role) => role.name === 'Knowledge Manager');
  await api(maya, 'PUT', `/users/${t.jordan.id}/roles`, {
    roleIds: [manager!.id],
  });
  await maya.dispose();

  await signInAs(page, t.jordan);
  await page.goto('/analytics');
  await expect(
    page.getByText('Tickets created', { exact: true }),
  ).toBeVisible();
  await page.getByRole('combobox', { name: 'Department' }).click();
  await expect(page.getByRole('option', { name: 'Workplace' })).toBeVisible();
  await page.keyboard.press('Escape');
  for (const section of ['Agents', 'Knowledge', 'AI usage', 'Feedback']) {
    await page
      .getByRole('navigation', { name: 'Analytics' })
      .getByRole('link', { name: section })
      .click();
    await expect(
      page.getByRole('heading', { level: 1, name: section }),
    ).toBeVisible();
    await expect(page.getByText('This page isn’t available')).toHaveCount(0);
  }
});
