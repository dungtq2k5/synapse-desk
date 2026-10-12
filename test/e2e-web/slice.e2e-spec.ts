import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import {
  api,
  clearThrottles,
  DEMO_PASSWORD,
  seededActors,
  signIn,
} from './support';

test.beforeEach(clearThrottles);

/** A browser of its own, signed in: a second person, or a second tab. */
async function personAt(
  browser: Browser,
  email: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email, DEMO_PASSWORD);
  await expect(page).toHaveURL(/\/tickets$/);
  return { context, page };
}

/**
 * One of the requester's own tickets, as their list shows it: a seeded member
 * has no `ticket.create`, so the rows use what the demo seed gave them.
 */
async function ownTicket(page: Page): Promise<string> {
  const tickets = await api<{ items: { id: string }[] }>(
    page.request,
    'GET',
    '/tickets?limit=1&sortBy=updatedAt&sortOrder=DESC',
  );
  const [ticket] = tickets.items;
  expect(ticket, 'the seeded requester has no ticket').toBeDefined();
  return ticket.id;
}

test('a reply arrives live in the requester’s browser, and a note never does', async ({
  browser,
}) => {
  const { admin, colleague } = await seededActors();
  const requester = await personAt(browser, colleague.email);
  const agent = await personAt(browser, admin.email);
  const stamp = Date.now();
  const ticketId = await ownTicket(requester.page);
  // Only the author or the assignee posts, so the agent takes it first; a
  // re-run finds it already theirs (409).
  // A department is required, and ticket-service only checks it exists: the
  // seeded admin belongs to none, and a seeded ticket may have none.
  const departments = await api<{ items: { id: string }[] }>(
    agent.page.request,
    'GET',
    '/departments?limit=1',
  );
  const [department] = departments.items;
  expect(department, 'the seeded tenant has no department').toBeDefined();
  const taken = await agent.page.request.post(
    `/api/v1/tickets/${ticketId}/assign/self`,
    { data: { departmentId: department.id } },
  );
  expect([200, 201, 409], await taken.text()).toContain(taken.status());

  await requester.page.goto(`/tickets/${ticketId}`);
  await agent.page.goto(`/tickets/${ticketId}`);
  const conversation = (page: Page) =>
    page.getByRole('log', { name: 'Conversation' });
  await expect(conversation(requester.page)).toBeVisible();
  await expect(conversation(agent.page)).toBeVisible();

  // Typing first, then the reply, both without a reload.
  const composer = agent.page.getByRole('textbox');
  await expect(async () => {
    await composer.fill('');
    await composer.pressSequentially('Looking', { delay: 50 });
    await expect(requester.page.getByText(/is typing…/)).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });
  await composer.fill(`Reply ${stamp}`);
  await agent.page.getByRole('button', { name: 'Send reply' }).click();
  await expect(
    conversation(requester.page).getByText(`Reply ${stamp}`),
  ).toBeVisible();

  // A note: the agent sees it at once; the requester's page never does.
  await agent.page.getByRole('radio', { name: 'Internal note' }).click();
  await composer.fill(`Note ${stamp}`);
  await agent.page.getByRole('button', { name: 'Add internal note' }).click();
  await expect(
    conversation(agent.page).getByText(`Note ${stamp}`),
  ).toBeVisible();
  await requester.page.reload();
  await expect(
    conversation(requester.page).getByText(`Reply ${stamp}`),
  ).toBeVisible();
  await expect(
    conversation(requester.page).getByText(`Note ${stamp}`),
  ).toHaveCount(0);

  await requester.context.close();
  await agent.context.close();
});

test('an expired access cookie: the page renders, refreshes once, shows the data', async ({
  browser,
}) => {
  const { colleague } = await seededActors();
  const { context, page } = await personAt(browser, colleague.email);
  const ticketId = await ownTicket(page);

  await context.clearCookies({ name: 'access_token' });
  const refreshes: string[] = [];
  page.on('request', (sent) => {
    if (sent.url().endsWith('/api/v1/auth/refresh')) refreshes.push(sent.url());
  });
  await page.goto(`/tickets/${ticketId}`);

  await expect(page.getByRole('log', { name: 'Conversation' })).toBeVisible();
  // The description is the thread's first entry: the data, after a refresh.
  await expect(page.getByRole('article').first()).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/tickets/${ticketId}$`));
  expect(refreshes).toHaveLength(1);

  await context.close();
});

test('sign-out, then a protected page goes to sign-in', async ({ browser }) => {
  const { colleague } = await seededActors();
  const { context, page } = await personAt(browser, colleague.email);

  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByText('You’ve signed out')).toBeVisible();

  await page.goto('/tickets');
  await expect(page).toHaveURL(/\/login\?next=%2Ftickets$/);
  await expect(page.getByText('Your session ended')).toBeVisible();

  await context.close();
});

test('the built app’s security headers, and its scripts carry the nonce', async ({
  request,
  page,
}) => {
  const response = await request.get('/login');
  const headers = response.headers();
  const policy = headers['content-security-policy'] ?? '';
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];

  expect(nonce).toBeDefined();
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).not.toContain("'unsafe-eval'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['x-frame-options']).toBe('DENY');

  // Every script the page ships is allowed by that request's nonce.
  const html = await response.text();
  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map(([tag]) => tag);
  expect(scripts.length).toBeGreaterThan(0);
  expect(scripts.filter((tag) => !tag.includes(`nonce="${nonce}"`))).toEqual(
    [],
  );

  // And the browser, enforcing it, runs the page: no violation reported.
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) {
      violations.push(message.text());
    }
  });
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  expect(violations).toEqual([]);
});
