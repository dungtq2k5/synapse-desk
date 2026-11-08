import { expect, test, type Page } from './coverage';
import { signInAs, tenant } from './screens/tenant';
import { signInAsSuperAdmin, superAdmin } from './super-admin';
import { clearThrottles, settled } from './support';

/**
 * What axe can't see, on the main screens: the page reflows at 320 CSS px
 * (400% zoom) and at 200% text with no horizontal scrolling, has one `h1` and
 * one `main`, and a signed-in page starts with its skip link. And reduced
 * motion shortens what moves.
 */
test.beforeEach(clearThrottles);

/**
 * What makes the page itself scroll sideways (a wide table inside a scrolling
 * box may): the outermost elements reaching past the viewport, or none.
 */
const sideways = (page: Page) =>
  page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= width + 1) return [];
    return [...document.querySelectorAll('body *')]
      .filter((element) => element.getBoundingClientRect().right > width + 1)
      .filter(
        (element) =>
          !element.parentElement ||
          element.parentElement.getBoundingClientRect().right <= width + 1,
      )
      .slice(0, 5)
      .map(
        (element) =>
          `${element.tagName.toLowerCase()}.${[...element.classList].slice(0, 4).join('.')}`,
      );
  });

/**
 * The browser's default font size, as a person sets it: the breakpoints move
 * with it (rem media queries resolve against it), unlike a `font-size` on the
 * page, which doubles the text inside a layout nobody gets. Chrome's setting,
 * over CDP, so this row runs on Chromium only.
 */
async function defaultFontSize(page: Page, standard: number) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Page.setFontSizes', {
      fontSizes: { standard, fixed: Math.round((standard * 13) / 16) },
    });
  } finally {
    await cdp.detach();
  }
}

async function checkScreen(page: Page, path: string, shell: boolean) {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(path);
  await expect(page.locator('h1').first()).toBeVisible();
  // Settled: the page's own data has drawn, and the layout stopped moving.
  await page.waitForLoadState('networkidle');
  await settled(page);

  expect.soft(await sideways(page), `${path} at 320 px`).toEqual([]);
  expect.soft(await page.locator('h1').count(), `${path}: one h1`).toBe(1);
  expect.soft(await page.locator('main').count(), `${path}: one main`).toBe(1);
  if (shell) {
    await expect(
      page.getByRole('link', { name: 'Skip to content' }),
    ).toHaveAttribute('href', '#main');
  }

  // Text at 200% (the default 16 px doubled), on a desktop-sized window.
  await page.setViewportSize({ width: 1280, height: 800 });
  await defaultFontSize(page, 32);
  // The setting took: a call that changed nothing would pass vacuously.
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).fontSize,
    ),
  ).toBe('32px');
  await settled(page);
  expect.soft(await sideways(page), `${path} at 200% text`).toEqual([]);
  await defaultFontSize(page, 16);
}

test('the main screens reflow at 320 px and at 200% text, with one h1, one main and a skip link', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await checkScreen(page, '/login', false);

  const { maya, tickets } = await tenant('structure');
  await signInAs(page, maya);
  for (const path of [
    '/tickets',
    `/tickets/${tickets.mobile}`,
    '/ask',
    '/knowledge/documents',
    '/settings/people',
    '/analytics',
  ]) {
    await checkScreen(page, path, true);
  }

  await page.context().clearCookies();
  await signInAsSuperAdmin(page, await superAdmin('structure'));
  await checkScreen(page, '/platform', true);
});

test('what can be clicked shows the pointer; a disabled button and a text field’s label don’t', async ({
  page,
}) => {
  await page.goto('/login');
  const signIn = page.getByRole('button', { name: 'Sign in' });
  await expect(signIn).toBeVisible();
  const cursor = (locator: ReturnType<Page['locator']>) =>
    locator.evaluate((element) => getComputedStyle(element).cursor);

  expect(await cursor(signIn)).toBe('pointer');
  expect(await cursor(page.locator('label', { hasText: 'Email' }))).not.toBe(
    'pointer',
  );

  await signIn.evaluate((button) => button.setAttribute('disabled', ''));
  expect(await cursor(signIn)).toBe('not-allowed');

  // A checkbox's label, as the role editors lay it out: the box, then its label.
  await page.evaluate(() => {
    const row = document.createElement('div');
    row.innerHTML =
      '<button type="button" role="checkbox" id="probe-box"></button>' +
      '<div><label for="probe-box">A permission</label></div>';
    document.body.append(row);
  });
  expect(await cursor(page.locator('label[for="probe-box"]'))).toBe('pointer');
  await page
    .locator('#probe-box')
    .evaluate((button) => button.setAttribute('disabled', ''));
  expect(await cursor(page.locator('label[for="probe-box"]'))).not.toBe(
    'pointer',
  );
});

test('reduced motion shortens what moves', async ({ page }) => {
  const { maya } = await tenant('structure');
  await signInAs(page, maya);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/tickets');

  await page.getByRole('button', { name: 'Account' }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const seconds = await menu.evaluate((element) => {
    const { animationDuration, transitionDuration } = getComputedStyle(element);
    return Math.max(
      ...[animationDuration, transitionDuration].map((value) =>
        value.endsWith('ms')
          ? Number.parseFloat(value) / 1000
          : Number.parseFloat(value),
      ),
    );
  });
  // The fast duration (120 ms) at most.
  expect(seconds).toBeLessThanOrEqual(0.12);
});

test('on a phone, a link chosen in the menu closes it and focus lands on the page', async ({
  page,
}) => {
  const { maya } = await tenant('structure');
  await signInAs(page, maya);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tickets');

  await page.getByRole('button', { name: 'Open menu' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('link', { name: 'Ask' }).click();

  await expect(page).toHaveURL(/\/ask/);
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('#main')).toBeFocused();

  // A link to the page already open closes the sheet too.
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(sheet).toBeVisible();
  await sheet.getByRole('link', { name: 'Ask' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('#main')).toBeFocused();
});
