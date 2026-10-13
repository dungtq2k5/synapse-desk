import { expect, test, type Page } from '@playwright/test';
import { api } from '../support';
import { look, tabsThrough } from './look';
import { sessionAs, signInAs, tenant } from './tenant';

/**
 * The ticket list and the app shell around it, in every state, light and
 * dark, at both widths. The list's first page renders on the server, so the
 * data is the tenant's own (tenant.ts); a state that needs the browser's next
 * fetch to fail, wait or come back empty is made with `page.route` on that
 * fetch, which a sort triggers.
 */

const TICKETS = '**/api/v1/tickets?*';
const page1 = { currentPage: 1, itemsPerPage: 20, totalPages: 0 };

/** Sorts by Priority: the list's next fetch, from the browser. */
const resort = (page: Page) =>
  page
    .getByRole('button', { name: /^Priority/ })
    .first()
    .click();

/** The page's own alert: Next.js's route announcer is an `alert` too. */
const alert = (page: Page) => page.getByRole('main').getByRole('alert');

test.describe('the ticket list, as an agent', () => {
  test.beforeEach(async ({ page }) => {
    const { maya } = await tenant('list');
    await signInAs(page, maya);
    await page.goto('/tickets');
    await expect(page.getByRole('heading', { name: 'Tickets' })).toBeVisible();
  });

  test('the queue', async ({ page }) => {
    await expect(
      page.getByRole('link', { name: /Allowance for a standing desk/ }),
    ).toBeVisible();
    await look(page, 'list-agent');
  });

  test('the queue: the focus order', async ({ page }) => {
    await expect(
      page.getByRole('link', { name: /Allowance for a standing desk/ }),
    ).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search tickets' }).focus();
    await tabsThrough(page, [
      /^Assigned to me$/,
      /^Status/,
      /^Priority/,
      /^Source/,
      /^Assignee/,
      /^Department/,
    ]);
  });

  test('loading: the next page is on its way', async ({ page }) => {
    // The first page arrives with the HTML, so loading is a refetch: the rows
    // stay, marked busy, until the next page lands.
    await page.route(TICKETS, () => undefined);
    await resort(page);
    await expect(page.locator('[aria-busy="true"]').first()).toBeVisible();
    await look(page, 'list-loading');
  });

  test('empty: no tickets yet', async ({ page }) => {
    await page.route(TICKETS, (route) =>
      route.fulfill({
        json: {
          success: true,
          statusCode: 200,
          message: 'OK',
          data: { items: [], meta: { ...page1, totalItems: 0, itemCount: 0 } },
        },
      }),
    );
    await resort(page);
    await expect(
      page.getByRole('heading', { name: 'No tickets yet' }),
    ).toBeVisible();
    await look(page, 'list-empty');
  });

  test('no results for a search', async ({ page }) => {
    await page.getByRole('searchbox', { name: 'Search tickets' }).fill('zzzz');
    await expect(
      page.getByRole('heading', { name: 'No tickets match' }),
    ).toBeVisible();
    await look(page, 'list-no-results');
  });

  test("error: couldn't load, with Try again", async ({ page }) => {
    await page.route(TICKETS, (route) =>
      route.fulfill({
        status: 500,
        json: {
          success: false,
          statusCode: 500,
          error: 'Internal server error!',
        },
      }),
    );
    await resort(page);
    await expect(alert(page)).toContainText('Couldn’t load tickets');
    await look(page, 'list-error');
  });
});

test('the ticket list, as the person who raised them', async ({ page }) => {
  const { priya } = await tenant('list');
  await signInAs(page, priya);
  await page.goto('/tickets');
  await expect(page.getByRole('heading', { name: 'My tickets' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Allowance for a standing desk/ }),
  ).toBeVisible();
  await look(page, 'list-requester');
});

test.describe('the list, live', () => {
  test('a new ticket arrives, and a reassignment says who has it now', async ({
    page,
  }) => {
    const { maya, jordan, priya, departmentId, tickets } =
      await tenant('live-list');
    await signInAs(page, maya);
    await page.goto('/tickets');
    await expect(page.getByRole('heading', { name: 'Tickets' })).toBeVisible();

    const jordans = await sessionAs(jordan);
    await api(jordans, 'POST', '/tickets', {
      title: 'Monitor flickers after lunch',
      description: 'Only on the left monitor.',
      priority: 'MEDIUM',
      authorId: priya.id,
    });
    await expect(
      page.getByRole('link', { name: /Monitor flickers after lunch/ }),
    ).toBeVisible();
    await look(page, 'list-live-new');

    await api(jordans, 'POST', `/tickets/${tickets.desk}/reassign`, {
      assigneeId: jordan.id,
      departmentId,
      reason: 'MANUAL',
    });
    await expect(
      page.getByText('Jordan Lee now owns this ticket.'),
    ).toBeVisible();
    await look(page, 'list-reassigned', {
      viewportOnly: true,
      // The toast's title names the ticket's number.
      mask: [page.getByText(/^Ticket #\d+ reassigned$/)],
    });
    await jordans.dispose();
  });
});

test.describe('the app shell', () => {
  test.beforeEach(async ({ page }) => {
    const { maya } = await tenant('list');
    await signInAs(page, maya);
  });

  test('its focus order', async ({ page }) => {
    await page.goto('/tickets');
    await expect(page.getByRole('heading', { name: 'Tickets' })).toBeVisible();
    await tabsThrough(page, [
      /^Skip to content$/,
      /^Tickets$/,
      /^Account$/,
      /^Toggle sidebar$/,
    ]);
  });

  test('the user menu, open', async ({ page }) => {
    await page.goto('/tickets');
    await page.getByRole('button', { name: 'Account' }).click();
    await expect(
      page.getByRole('menuitem', { name: 'Sign out' }),
    ).toBeVisible();
    await look(page, 'shell-user-menu', {
      widths: ['desktop'],
      // Radix's modal menu hides the rest of the page with aria-hidden and
      // traps focus inside the menu, so nothing hidden can be reached; axe
      // sees the hiding but not the trap.
      disabled: ['aria-hidden-focus'],
    });
  });

  test("the phone's menu sheet, open", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/tickets');
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await look(page, 'shell-phone-sheet', { widths: ['phone'] });
  });

  test("sign-out failed: a toast that won't be missed", async ({ page }) => {
    await page.route('**/api/v1/auth/logout', (route) =>
      route.fulfill({
        status: 500,
        json: {
          success: false,
          statusCode: 500,
          error: 'Internal server error!',
        },
      }),
    );
    await page.goto('/tickets');
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page.getByText('Couldn’t sign out')).toBeVisible();
    // The menu closes first; axe runs on the page, not the closing menu.
    await expect(page.getByRole('menu')).toHaveCount(0);
    await look(page, 'shell-sign-out-failed', { viewportOnly: true });
  });

  test('live updates paused when the socket drops', async ({ page }) => {
    let drop: (() => void) | undefined;
    let dropped = false;
    // After the drop every reconnect is refused too, so the page stays paused
    // while it is drawn rather than coming back mid-capture.
    await page.routeWebSocket(/\/socket\.io\//, (ws) => {
      if (dropped) {
        void ws.close();
        return;
      }
      ws.connectToServer();
      drop = () => {
        dropped = true;
        void ws.close();
      };
    });
    await page.goto('/tickets');
    await expect.poll(() => drop !== undefined).toBe(true);
    // Live first: the toast is for losing a connection, not for never having one.
    await page.waitForTimeout(1_000);
    drop!();
    await expect(page.getByText('Live updates paused')).toBeVisible();
    await look(page, 'shell-socket-lost', { viewportOnly: true });
  });

  test('after a two-step sign-in, the backup-codes warning stays until dismissed', async ({
    page,
  }) => {
    await page.addInitScript(() =>
      sessionStorage.setItem(
        'synapsedesk:two-step-warning',
        'You have 2 backup code(s) left. Regenerate a new set soon.',
      ),
    );
    await page.goto('/tickets');
    await expect(page.getByText('Backup codes running low')).toBeVisible();
    await look(page, 'shell-backup-codes-low');
  });
});
