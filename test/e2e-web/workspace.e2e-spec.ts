import { join } from 'node:path';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { REPO_ROOT } from '../system/services';
import { sessionAs, signInAs, tenant, type Person } from './screens/tenant';
import { api, clearThrottles } from './support';

/**
 * The agent's workspace, end to end: each journey on a tenant of its own
 * (screens/tenant.ts), through the real services. Only the AI's draft is
 * played in at the network, since it needs a model.
 */
test.beforeEach(clearThrottles);

/** A browser of its own, signed in as `person`, on `path`. */
async function personAt(
  browser: Browser,
  person: Person,
  path: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAs(page, person);
  await page.goto(path);
  return { context, page };
}

const thread = (page: Page) => page.getByRole('log', { name: 'Conversation' });
const status = (page: Page, label: string) =>
  page.getByRole('main').getByText(label, { exact: true }).first();

test('an agent takes a ticket, replies from an edited AI draft and resolves it; the requester sees each change live', async ({
  browser,
}) => {
  const { maya, priya, tickets } = await tenant('j-take');
  const requester = await personAt(
    browser,
    priya,
    `/tickets/${tickets.mobile}`,
  );
  const agent = await personAt(browser, maya, `/tickets/${tickets.mobile}`);
  await expect(thread(requester.page)).toBeVisible();

  await agent.page.getByRole('button', { name: 'Assign to me' }).click();
  await agent.page.getByRole('menuitem', { name: 'Workplace' }).click();
  await expect(
    requester.page.getByRole('main').getByText('Maya Chen').first(),
  ).toBeVisible();

  await agent.page.route('**/api/v1/tickets/*/ai/draft', (route) =>
    route.fulfill({
      json: {
        success: true,
        statusCode: 200,
        message: 'OK',
        warning: null,
        data: {
          content: 'Hi Priya, sign out and in again on the app.',
          modelName: 'demo',
          promptTokens: 1,
          completionTokens: 1,
          generationId: '00000000-0000-4000-8000-00000000d4a2',
          citations: [],
        },
      },
    }),
  );
  await agent.page.getByRole('button', { name: 'Draft with AI' }).click();
  await agent.page.getByRole('button', { name: 'Generate draft' }).click();
  const box = agent.page.getByRole('textbox', { name: 'Reply to Priya' });
  await expect(box).toHaveValue('Hi Priya, sign out and in again on the app.');
  await box.press('End');
  await box.pressSequentially(' Then update it.');
  const sent = agent.page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      request.url().endsWith(`/tickets/${tickets.mobile}/messages`),
  );
  await agent.page.getByRole('button', { name: 'Send reply' }).click();
  expect((await sent).postDataJSON()).toMatchObject({
    content: 'Hi Priya, sign out and in again on the app. Then update it.',
    generatedFromId: '00000000-0000-4000-8000-00000000d4a2',
  });
  await expect(
    thread(requester.page).getByText(
      'Hi Priya, sign out and in again on the app. Then update it.',
    ),
  ).toBeVisible();

  for (const [from, move, confirm] of [
    ['New', 'Mark as open…', 'Mark as open'],
    ['Open', 'Resolve…', 'Resolve'],
  ]) {
    await agent.page
      .getByRole('button', { name: `Status: ${from}. Change status` })
      .click();
    await agent.page.getByRole('menuitem', { name: move }).click();
    await agent.page
      .getByRole('dialog')
      .getByRole('button', { name: confirm, exact: true })
      .click();
  }
  await expect(status(requester.page, 'Resolved')).toBeVisible();

  await requester.context.close();
  await agent.context.close();
});

test('reassigned to another department: the history says so, and the other agent’s queue has it', async ({
  page,
  browser,
}) => {
  const { maya, jordan, facilitiesId, tickets } = await tenant('j-reassign');
  const mayas = await sessionAs(maya);
  await api(mayas, 'POST', `/departments/${facilitiesId}/members`, {
    userIds: [jordan.id],
  });
  await mayas.dispose();
  await signInAs(page, maya);
  await page.goto(`/tickets/${tickets.vpn}`);

  await page.getByRole('button', { name: 'Reassign…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Department' }).click();
  await page.getByRole('option', { name: 'Facilities' }).click();
  await dialog.getByRole('combobox', { name: 'Assignee' }).click();
  await page.getByRole('option', { name: 'Jordan Lee' }).click();
  await expect(dialog.getByRole('combobox', { name: 'Reason' })).toHaveText(
    'Department change',
  );
  await dialog.getByRole('button', { name: 'Reassign' }).click();
  await expect(page.getByText('Assigned to Jordan Lee').first()).toBeVisible();

  await page.locator('aside').getByRole('tab', { name: 'History' }).click();
  await expect(
    page.getByText('Moved to Facilities: department change'),
  ).toBeVisible();

  const other = await personAt(browser, jordan, '/tickets');
  await other.page.getByRole('button', { name: 'Assigned to me' }).click();
  await expect(
    other.page.getByRole('link', { name: /VPN drops every hour/ }).first(),
  ).toBeVisible();
  await other.context.close();
});

test('Unassign, then Undo', async ({ page }) => {
  const { maya, tickets } = await tenant('j-unassign');
  await signInAs(page, maya);
  await page.goto(`/tickets/${tickets.desk}`);

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Unassign' }).click();
  await expect(page.getByRole('button', { name: 'Assign…' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'Reassign…' })).toBeVisible();
  await expect(
    page.locator('aside').getByText('Maya Chen').first(),
  ).toBeVisible();
});

test('deleted, found with Show deleted, and restored', async ({ page }) => {
  const { maya, tickets } = await tenant('j-delete');
  await signInAs(page, maya);
  await page.goto(`/tickets/${tickets.laptop}`);

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete ticket' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete ticket' })
    .click();
  await expect(page).toHaveURL(/\/tickets$/);
  await expect(
    page.getByRole('link', { name: /Laptop won’t charge/ }),
  ).toHaveCount(0);

  await page.getByRole('button', { name: 'Show deleted' }).click();
  await page
    .getByRole('button', { name: /^Restore ticket #\d+$/ })
    .first()
    .click();
  await expect(page.getByText(/^Ticket #\d+ restored$/)).toBeVisible();
  await page.getByRole('button', { name: 'Show deleted' }).click();
  await expect(
    page.getByRole('link', { name: /Laptop won’t charge/ }).first(),
  ).toBeVisible();
});

test('a file: uploaded through Storage, downloaded, deleted', async ({
  page,
}) => {
  const { maya, tickets } = await tenant('j-file');
  await signInAs(page, maya);
  await page.goto(`/tickets/${tickets.desk}`);

  await page
    .locator('form input[type="file"]')
    .setInputFiles(join(REPO_ROOT, 'test/fixtures/images/avatar.png'));
  const files = page.getByRole('list', { name: 'Attachments' });
  await expect(files.getByText('avatar.png')).toBeVisible();
  await expect(files.getByText('Uploading…', { exact: false })).toHaveCount(0);
  await page
    .getByRole('textbox', { name: 'Reply to Priya' })
    .fill('The photo you asked for.');
  await page.getByRole('button', { name: 'Send reply' }).click();

  const message = thread(page)
    .getByRole('article')
    .filter({ hasText: 'The photo you asked for.' });
  const chip = message.getByRole('button', { name: /^avatar\.png/ });
  await expect(chip).toBeVisible();

  // The new tab is sent to a signed Storage link; Storage answers with the
  // file, which the browser downloads rather than shows.
  const fetched = page
    .context()
    .waitForEvent('response', (response) =>
      /\/tickets\/[^/]+\/attachments\/[^/?]+\.png\?/.test(response.url()),
    );
  await chip.click();
  const file = await fetched;
  expect(file.ok()).toBe(true);
  expect((await page.request.get(file.url())).ok()).toBe(true);

  await message.getByRole('button', { name: 'Delete avatar.png' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete file' })
    .click();
  await expect(chip).toHaveCount(0);
});

test('Edit within the window, and not after it', async ({ page }) => {
  // The e2e stack's window is one minute (global-setup.ts).
  test.setTimeout(150_000);
  const { maya, tickets } = await tenant('j-edit');
  await signInAs(page, maya);
  await page.goto(`/tickets/${tickets.desk}`);
  await page
    .getByRole('textbox', { name: 'Reply to Priya' })
    .fill('Checking with Finance.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  const reply = thread(page)
    .getByRole('article')
    .filter({ hasText: 'Checking with Finance' });

  await reply.getByRole('button', { name: 'Edit', exact: true }).click();
  const box = reply.getByRole('textbox', { name: 'Message' });
  await box.fill('Checking with Finance today.');
  await reply.getByRole('button', { name: 'Save' }).click();
  await expect(reply.getByText('Checking with Finance today.')).toBeVisible();
  await expect(reply.getByText('Edited')).toBeVisible();

  // Gone once the window closes, without a reload.
  await expect(
    reply.getByRole('button', { name: 'Edit', exact: true }),
  ).toHaveCount(0, { timeout: 90_000 });
});

test('a moderator redacts a message', async ({ page }) => {
  const { maya, tickets } = await tenant('j-redact');
  await signInAs(page, maya);
  await page.goto(`/tickets/${tickets.desk}`);
  const quote = thread(page)
    .getByRole('article')
    .filter({ hasText: 'Here’s the quote from the shop.' });

  await quote.getByRole('button', { name: 'Message actions' }).click();
  await page.getByRole('menuitem', { name: 'Redact message' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Redact message' })
    .click();
  await expect(
    thread(page).getByText('Here’s the quote from the shop.'),
  ).toHaveCount(0);
  await expect(thread(page).getByText('This message was removed.')).toHaveCount(
    2,
  );
});

test('feedback on an AI answer: given, changed, withdrawn', async ({
  page,
}) => {
  const { maya, tickets } = await tenant('j-feedback');
  await signInAs(page, maya);
  await page.goto(`/tickets/${tickets.desk}`);
  const answer = thread(page)
    .getByRole('article')
    .filter({ hasText: 'covers desks and chairs' });

  await answer.getByRole('button', { name: 'Not helpful' }).click();
  await answer
    .getByRole('textbox', { name: 'Tell us more (optional)' })
    .fill('The limit is per year, not per item.');
  await answer.getByRole('radio', { name: 'Yes' }).click();
  await answer.getByRole('button', { name: 'Send feedback' }).click();
  await expect(answer.getByText('Thanks for your feedback.')).toBeVisible();

  await page.reload();
  await expect(answer.getByText('Thanks for your feedback.')).toBeVisible();
  await answer.getByRole('button', { name: 'Change' }).click();
  await expect(
    answer.getByRole('textbox', { name: 'Tell us more (optional)' }),
  ).toHaveValue('The limit is per year, not per item.');
  await answer.getByRole('button', { name: 'Helpful', exact: true }).click();
  await answer.getByRole('button', { name: 'Send feedback' }).click();
  await expect(answer.getByText('Thanks for your feedback.')).toBeVisible();

  await answer.getByRole('button', { name: 'Remove' }).click();
  await expect(answer.getByText('Helpful?')).toBeVisible();
  await page.reload();
  await expect(answer.getByText('Helpful?')).toBeVisible();
});

test('an agent raises a ticket for a requester, who sees it in their list', async ({
  page,
  browser,
}) => {
  const { maya, priya } = await tenant('j-raise');
  await signInAs(page, maya);
  await page.goto('/tickets');
  await page.getByRole('link', { name: 'New ticket' }).click();

  await page.getByRole('button', { name: /Maya Chen \(you\)/ }).click();
  await page
    .getByRole('combobox', { name: 'Search people by name or email' })
    .fill('Priya');
  await page.getByRole('option', { name: /Priya Shah/ }).click();
  await page.getByLabel('Title').fill('Badge doesn’t open the side door');
  await page.getByLabel('Description').fill('It beeps red since Monday.');
  await page.getByRole('button', { name: 'Create ticket' }).click();
  await expect(page).toHaveURL(/\/tickets\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole('heading', { name: 'Badge doesn’t open the side door' }),
  ).toBeVisible();

  const requester = await personAt(browser, priya, '/tickets');
  await expect(
    requester.page.getByRole('link', {
      name: /Badge doesn’t open the side door/,
    }),
  ).toBeVisible();
  await requester.context.close();
});

test('an export: started, the page reloaded, resumed, downloaded', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { maya } = await tenant('j-export');
  await signInAs(page, maya);
  await page.goto('/tickets');

  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('button', { name: 'Start export' }).click();
  await expect(
    page.getByText(/Preparing your export…|Your export is ready/),
  ).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Export' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export tickets' });
  await expect(dialog.getByText('Your export is ready')).toBeVisible({
    timeout: 90_000,
  });
  const opened = page.context().waitForEvent('page');
  await dialog.getByRole('button', { name: 'Download CSV' }).click();
  const tab = await opened;
  await expect.poll(() => tab.url()).not.toBe('about:blank');
  const csv = await page.request.get(tab.url());
  expect(csv.ok()).toBe(true);
  expect(await csv.text()).toContain('ticket');
});
