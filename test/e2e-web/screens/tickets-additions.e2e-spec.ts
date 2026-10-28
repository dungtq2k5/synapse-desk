import { expect, test, type Page } from '../coverage';
import { look } from './look';
import { sessionAs, signInAs, tenant, type Person } from './tenant';

/**
 * The list's additions in every state, light and dark, at both widths:
 * finding a ticket by number, deleted tickets, the export, and the New ticket
 * form. The export's job is played in at the network (it runs on a worker
 * this stack doesn't drive to a file).
 */

async function list(page: Page, person: Person) {
  await signInAs(page, person);
  await page.goto('/tickets');
  await expect(page.getByRole('heading', { name: 'Tickets' })).toBeVisible();
}

const envelope = (data: unknown, status = 200) => ({
  status,
  json: {
    success: true,
    statusCode: status,
    message: 'OK',
    warning: null,
    data,
  },
});

test.describe('finding a ticket by number', () => {
  test('Go to the ticket', async ({ page }) => {
    const { maya } = await tenant('find');
    await list(page, maya);
    const mayas = await sessionAs(maya);
    const { items } = (
      (await (
        await mayas.get(
          '/api/v1/tickets?limit=1&sortBy=createdAt&sortOrder=DESC',
        )
      ).json()) as { data: { items: { ticketNumber: number }[] } }
    ).data;
    await mayas.dispose();
    const search = page.getByRole('combobox', { name: 'Search tickets' });
    await search.fill(`#${items[0].ticketNumber}`);
    await expect(
      page.getByRole('option', { name: /^Go to #\d+/ }),
    ).toBeVisible();
    // The number typed is this run's.
    await look(page, 'list-find', { mask: [search] });
  });

  test('No ticket with that number', async ({ page }) => {
    const { maya } = await tenant('find');
    await list(page, maya);
    await page
      .getByRole('combobox', { name: 'Search tickets' })
      .fill('#999999999');
    await expect(page.getByText(/^No ticket #\d+$/)).toBeVisible();
    await look(page, 'list-find-none');
  });
});

test.describe('deleted tickets', () => {
  test('after deleting: the toast offers Undo', async ({ page }) => {
    const { maya, tickets } = await tenant('deleting');
    await signInAs(page, maya);
    await page.goto(`/tickets/${tickets.desk}`);
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete ticket' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete ticket' })
      .click();
    await expect(page).toHaveURL(/\/tickets$/);
    await expect(page.getByText(/^Ticket #\d+ deleted$/)).toBeVisible();
    await look(page, 'list-deleted-toast', { viewportOnly: true });
  });

  test('Show deleted: marked rows with Restore', async ({ page }) => {
    const { maya, tickets } = await tenant('show-deleted');
    const mayas = await sessionAs(maya);
    for (const id of [tickets.desk, tickets.billing]) {
      expect((await mayas.delete(`/api/v1/tickets/${id}`)).ok()).toBe(true);
    }
    await mayas.dispose();
    await list(page, maya);
    await page.getByRole('button', { name: 'Show deleted' }).click();
    await expect(page.getByText('6 tickets · 2 deleted')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /^Restore ticket #\d+$/ }),
    ).toHaveCount(2);
    await look(page, 'list-show-deleted');
  });
});

test.describe('the export', () => {
  const JOB = {
    id: '00000000-0000-4000-8000-0000000e4901',
    kind: 'TICKETS',
    rowCount: null,
    rollupComputedAt: null,
    error: null,
    createdAt: '2026-10-14T09:00:00.000Z',
    completedAt: null,
  };

  /** The job's answers, in turn: each poll gets the next. */
  async function exportAnswers(page: Page, ...statuses: object[]) {
    await page.route('**/api/v1/tickets/export', (route) =>
      route.fulfill(
        envelope({ ...JOB, status: 'PENDING', downloadUrl: null }, 201),
      ),
    );
    let poll = 0;
    await page.route(`**/api/v1/tickets/export/${JOB.id}`, (route) =>
      route.fulfill(
        envelope({
          ...JOB,
          ...statuses[Math.min(poll++, statuses.length - 1)],
        }),
      ),
    );
  }

  async function openDialog(page: Page) {
    const { maya } = await tenant('export');
    await list(page, maya);
    await page.getByRole('button', { name: 'Export' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export tickets' });
    await dialog.getByLabel('From').fill('2026-10-01');
    await dialog.getByLabel('To').fill('2026-10-14');
    return dialog;
  }

  test('the dialog', async ({ page }) => {
    const dialog = await openDialog(page);
    await expect(
      dialog.getByText('A CSV of the tickets in this period.', {
        exact: false,
      }),
    ).toBeVisible();
    await look(page, 'export');
  });

  test('a range that ends before it starts', async ({ page }) => {
    const dialog = await openDialog(page);
    await dialog.getByLabel('To').fill('2026-09-01');
    await dialog.getByRole('button', { name: 'Start export' }).click();
    await expect(
      dialog.getByText('Choose a start date on or before the end date.'),
    ).toBeVisible();
    await look(page, 'export-range-error');
  });

  test('preparing', async ({ page }) => {
    await exportAnswers(page, { status: 'PENDING', downloadUrl: null });
    const dialog = await openDialog(page);
    await dialog.getByRole('button', { name: 'Start export' }).click();
    await expect(dialog.getByText('Preparing your export…')).toBeVisible();
    await look(page, 'export-pending');
  });

  test('ready', async ({ page }) => {
    await exportAnswers(page, {
      status: 'READY',
      downloadUrl: 'https://files.example.test/export.csv',
    });
    const dialog = await openDialog(page);
    await dialog.getByRole('button', { name: 'Start export' }).click();
    await expect(dialog.getByText('Your export is ready')).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Download CSV' }),
    ).toBeFocused();
    await look(page, 'export-ready');
  });

  test('failed', async ({ page }) => {
    await exportAnswers(page, {
      status: 'FAILED',
      downloadUrl: null,
      error: 'The export ran out of time. Try a shorter period.',
    });
    const dialog = await openDialog(page);
    await dialog.getByRole('button', { name: 'Start export' }).click();
    await expect(dialog.getByText('The export failed')).toBeVisible();
    await look(page, 'export-failed');
  });

  test('closed while running: the ready toast', async ({ page }) => {
    await exportAnswers(
      page,
      { status: 'PENDING', downloadUrl: null },
      { status: 'PENDING', downloadUrl: null },
      { status: 'READY', downloadUrl: 'https://files.example.test/export.csv' },
    );
    const dialog = await openDialog(page);
    await dialog.getByRole('button', { name: 'Start export' }).click();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(
      page.getByRole('button', { name: 'Export, running' }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: 'Notifications alt+T' })
        .getByText('Your export is ready'),
    ).toBeVisible();
    await look(page, 'export-ready-toast', { viewportOnly: true });
  });
});

test.describe('a new ticket', () => {
  async function form(page: Page, person: Person) {
    await signInAs(page, person);
    await page.goto('/tickets/new');
    await expect(
      page.getByRole('heading', { name: 'New ticket' }),
    ).toBeVisible();
  }

  test('as an end user', async ({ page }) => {
    const { priya } = await tenant('new');
    await form(page, priya);
    await expect(
      page.getByText('Tell us what you need. We’ll reply in the ticket.'),
    ).toBeVisible();
    await look(page, 'new-ticket');
  });

  test('uploading, one failed', async ({ page }) => {
    const { priya } = await tenant('new');
    let count = 0;
    await page.route('**/api/v1/tickets/attachments/upload-url', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          statusCode: 200,
          message: 'OK',
          warning: null,
          data: {
            uploadUrl: `/screens-storage/upload/${++count}`,
            uploadMethod: 'PUT',
            objectPath: `ticket-openings/screens/${count}`,
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
        }),
      }),
    );
    await page.route('**/screens-storage/upload/*', (route) => {
      const which = route.request().url().split('/').pop();
      if (which === '1') return new Promise<void>(() => {});
      if (which === '2') return route.fulfill({ status: 500 });
      return route.fulfill({ status: 200 });
    });
    await form(page, priya);
    await page.getByLabel('Title').fill('Monitor flickers on the dock');
    await page
      .getByLabel('Description')
      .fill(
        'My second monitor flickers when it’s connected through the dock. I’ve tried another cable. Can I get a replacement dock?',
      );
    await page.locator('form input[type="file"]').setInputFiles([
      {
        name: 'dock-photo.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.alloc(1024, 1),
      },
      {
        name: 'flicker.png',
        mimeType: 'image/png',
        buffer: Buffer.alloc(1024, 1),
      },
      {
        name: 'order.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.alloc(151_552, 1),
      },
    ]);
    const files = page.getByRole('list', { name: 'Attachments' });
    await expect(files.getByText('148 KB')).toBeVisible();
    await expect(files.getByText('Upload failed.')).toBeVisible();
    await expect(files.getByText('Uploading… 0%')).toBeVisible();
    await expect(
      page.getByText('Wait for your files to finish uploading.'),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Create ticket' }),
    ).toBeDisabled();
    await look(page, 'new-ticket-uploading');
  });

  test('as an agent: the Requester, defaulting to them', async ({ page }) => {
    const { maya } = await tenant('new');
    await form(page, maya);
    await expect(
      page.getByRole('button', { name: /Maya Chen \(you\)/ }),
    ).toBeVisible();
    await look(page, 'new-ticket-agent');
  });

  test('as an agent: searching for the requester', async ({ page }) => {
    const { maya } = await tenant('new');
    await form(page, maya);
    await page.getByRole('button', { name: /Maya Chen \(you\)/ }).click();
    await page
      .getByRole('combobox', { name: 'Search people by name or email' })
      .fill('pri');
    // The search has applied: the whole list has Priya in it too.
    await expect(page.getByRole('option')).toHaveCount(1);
    const priya = page.getByRole('option', { name: /Priya Shah/ });
    // The highlighted option, as the arrow keys or the pointer leave it.
    await priya.hover();
    await expect(priya).toHaveAttribute('aria-selected', 'true');
    await look(page, 'new-ticket-requester-search', {
      disabled: ['aria-hidden-focus'],
    });
  });

  test('the field errors', async ({ page }) => {
    const { priya } = await tenant('new');
    await form(page, priya);
    await page.getByLabel('Title').fill('Hi');
    await page.getByRole('button', { name: 'Create ticket' }).click();
    await expect(
      page.getByText('Enter a title of at least 3 characters.'),
    ).toBeVisible();
    await expect(page.getByText('Describe what you need.')).toBeVisible();
    await look(page, 'new-ticket-errors');
  });

  async function refused(page: Page, status: number, headers = {}) {
    const { priya } = await tenant('new');
    await page.route('**/api/v1/tickets', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status,
            headers,
            json: { success: false, statusCode: status, message: 'Refused' },
          })
        : route.fallback(),
    );
    await form(page, priya);
    await page.getByLabel('Title').fill('Laptop won’t charge');
    await page.getByLabel('Description').fill('The battery stays at 3%.');
    await page.getByRole('button', { name: 'Create ticket' }).click();
  }

  test('creating failed: the text is kept', async ({ page }) => {
    await refused(page, 500);
    await expect(page.getByText('Couldn’t create your ticket')).toBeVisible();
    await expect(page.getByLabel('Title')).toHaveValue('Laptop won’t charge');
    await look(page, 'new-ticket-failed');
  });

  test('429: too many new tickets', async ({ page }) => {
    await refused(page, 429, { 'Retry-After': '300' });
    await expect(
      page.getByText(
        'You’ve created several tickets in a short time. Try again in 5 minutes.',
      ),
    ).toBeVisible();
    await look(page, 'new-ticket-429');
  });
});
