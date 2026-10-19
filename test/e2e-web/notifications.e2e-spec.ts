import { expect, test, type Browser, type Page } from './coverage';
import { sessionAs, setPhone, signInAs, tenant } from './screens/tenant';
import { api, clearThrottles } from './support';

/**
 * Notifications end to end, through the real services: a person's action on
 * a ticket reaches notification-service, which notifies the people it's for,
 * and the gateway relays it to their open tabs. Each journey on a tenant of
 * its own (screens/tenant.ts).
 */
test.beforeEach(clearThrottles);

const bell = (page: Page) =>
  page.getByRole('button', { name: /^Notifications/ });
const unread = async (page: Page) => {
  const name = (await bell(page).getAttribute('aria-label')) ?? '';
  return Number(/(\d+) unread/.exec(name)?.[1] ?? 0);
};

/** Opens `path` and waits for the bell to hold the server's first count. */
async function openWithCount(page: Page, path: string): Promise<number> {
  const counted = page.waitForResponse((response) =>
    response.url().endsWith('/api/v1/notifications/unread-count'),
  );
  await page.goto(path);
  const { data } = (await (await counted).json()) as {
    data: { count: number };
  };
  await expect.poll(() => unread(page)).toBe(data.count);
  return data.count;
}

async function second(
  browser: Browser,
  person: Parameters<typeof signInAs>[1],
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAs(page, person);
  return { context, page };
}

test('an agent is assigned a ticket: the badge rises, the toast opens it by number, the badge falls', async ({
  page,
}) => {
  const { maya, jordan, departmentId, tickets } = await tenant('j-n-assign');
  await signInAs(page, maya);
  const before = await openWithCount(page, '/tickets');

  const jordans = await sessionAs(jordan);
  await api(jordans, 'POST', `/tickets/${tickets.mobile}/assign`, {
    assigneeId: maya.id,
    departmentId,
  });
  await jordans.dispose();

  const toast = page.getByText(/^Ticket #\d+ assigned to you$/);
  await expect(toast).toBeVisible();
  await expect.poll(() => unread(page)).toBe(before + 1);

  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/tickets/${tickets.mobile}\\?from=notification$`),
  );
  await expect(
    page.getByRole('heading', { name: 'Can’t sign in on mobile' }),
  ).toBeVisible();
  await expect.poll(() => unread(page)).toBe(before);
});

test('three replies on one ticket while unread: one item, count 3, one toast', async ({
  page,
}) => {
  // The laptop ticket is Jordan's, with no replies yet, so the first reply
  // starts the group.
  const { jordan, priya, tickets } = await tenant('j-n-group');
  await signInAs(page, jordan);
  const before = await openWithCount(page, '/tickets');

  const priyas = await sessionAs(priya);
  for (const content of ['Here’s the photo.', 'And the model.', 'Thanks!']) {
    await api(priyas, 'POST', `/tickets/${tickets.laptop}/messages`, {
      content,
      isInternalNote: false,
      invokeAi: false,
    });
  }
  await priyas.dispose();

  // One toast for the group, updated in place: never a second.
  await expect(page.getByText(/^New reply on ticket #\d+$/)).toHaveCount(1);
  await expect.poll(() => unread(page)).toBe(before + 1);

  await bell(page).click();
  await expect(
    page
      .getByRole('dialog', { name: 'Notifications' })
      .getByRole('link', { name: /New reply on ticket #\d+, .*3 updates/ }),
  ).toBeVisible();
  await expect(page.getByText(/^New reply on ticket #\d+$/)).toHaveCount(2);
});

test('read on a second browser: the first one’s badge and item follow', async ({
  page,
  browser,
}) => {
  const { maya, jordan, departmentId, tickets } = await tenant('j-n-read');
  await signInAs(page, maya);
  await page.goto('/tickets');
  await expect(bell(page)).toBeVisible();

  const jordans = await sessionAs(jordan);
  await api(jordans, 'POST', `/tickets/${tickets.mobile}/assign`, {
    assigneeId: maya.id,
    departmentId,
  });
  await jordans.dispose();
  await expect.poll(() => unread(page)).toBeGreaterThan(0);

  const other = await second(browser, maya);
  await other.page.goto('/notifications');
  await other.page.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(
    other.page.getByRole('button', { name: 'Mark all as read' }),
  ).toHaveCount(0);

  await expect.poll(() => unread(page)).toBe(0);
  await bell(page).click();
  await expect(
    page
      .getByRole('dialog', { name: 'Notifications' })
      .getByRole('link', { name: /^Unread\./ }),
  ).toHaveCount(0);
  await other.context.close();
});

test('the requester: a reply and a status change notify them, an escalation doesn’t', async ({
  page,
}) => {
  const { maya, priya, tickets } = await tenant('j-n-requester');
  await signInAs(page, priya);
  await page.goto('/requests');
  await expect(bell(page)).toBeVisible();

  const priyas = await sessionAs(priya);
  await api(priyas, 'POST', `/tickets/${tickets.mobile}/escalate`, {
    reason: 'Asked for a person',
  });
  await priyas.dispose();
  const mayas = await sessionAs(maya);
  await api(mayas, 'POST', `/tickets/${tickets.desk}/messages`, {
    content: 'Desks are in scope. Send me the quote.',
    isInternalNote: false,
    invokeAi: false,
  });
  await api(mayas, 'POST', `/tickets/${tickets.desk}/resolve`, {
    reason: 'Answered',
  });
  const { ticketNumber: desk } = await api<{ ticketNumber: number }>(
    mayas,
    'GET',
    `/tickets/${tickets.desk}`,
  );
  await mayas.dispose();

  await bell(page).click();
  const panel = page.getByRole('dialog', { name: 'Notifications' });
  await expect(
    panel.getByRole('link', {
      name: new RegExp(`New reply on ticket #${desk}`),
    }),
  ).toBeVisible();
  await expect(
    panel.getByRole('link', {
      name: new RegExp(`Ticket #${desk} is resolved`),
    }),
  ).toBeVisible();
  // Priya escalated her own mobile ticket: nothing about it reaches her.
  await expect(panel.getByRole('link', { name: /escalated/ })).toHaveCount(0);
});

test('preferences: email off for replies, and after a reload it says “Set by you”', async ({
  page,
}) => {
  const { maya } = await tenant('j-n-prefs');
  await signInAs(page, maya);
  await page.goto('/notifications/settings');
  const email = page
    .getByRole('switch', { name: 'New messages, Email' })
    .first();
  await expect(email).toBeChecked();
  await email.click();
  await expect(page.getByText('Saved')).toBeVisible();

  await page.reload();
  await expect(email).not.toBeChecked();
  await expect(email).toHaveAccessibleDescription('Set by you');
});

test('SMS waits for a verified phone, and works once there is one', async ({
  page,
}) => {
  const { maya } = await tenant('j-n-sms');
  await signInAs(page, maya);
  await page.goto('/notifications/settings');
  const sms = page
    .getByRole('switch', { name: 'Assigned to you, SMS' })
    .first();
  await expect(sms).toBeDisabled();
  await expect(sms).toHaveAccessibleDescription(
    'Verify a phone number to get texts.',
  );

  await setPhone(maya, '+15555550123');
  await page.reload();
  await expect(sms).toBeEnabled();
});
