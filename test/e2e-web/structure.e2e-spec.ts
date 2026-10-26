import { expect, test, type Page } from './coverage';
import { signInAs, tenant } from './screens/tenant';
import { signInAsSuperAdmin, superAdmin } from './super-admin';
import { clearThrottles } from './support';

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

async function checkScreen(page: Page, path: string, shell: boolean) {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(path);
  await expect(page.locator('h1').first()).toBeVisible();
  // Settled: the page's own data has drawn.
  await page.waitForLoadState('networkidle');

  expect.soft(await sideways(page), `${path} at 320 px`).toEqual([]);
  expect.soft(await page.locator('h1').count(), `${path}: one h1`).toBe(1);
  expect.soft(await page.locator('main').count(), `${path}: one main`).toBe(1);
  if (shell) {
    await expect(
      page.getByRole('link', { name: 'Skip to content' }),
    ).toHaveAttribute('href', '#main');
  }

  // Text at 200%, on a desktop-sized window.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect.soft(await sideways(page), `${path} at 200% text`).toEqual([]);
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
