import { expect, test, type Page } from '../coverage';
import { look } from './look';
import { keepNormalized, stopNormalizing } from './normalize';

/**
 * The landing page, signed out, each state as the design draws it. Under
 * reduced motion, so the hero shows its still image and
 * the flow graph has no light: the live scene moves and depends on the GPU,
 * so it is never a baseline. That makes the first-paint capture the "reduce
 * motion" frame too.
 */
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

const HEADLINE = 'Support that answers from your own documents';

/** The real page, its pricing narrowed to the seeded catalog (see the test page). */
const SEEDED = '/test-pages/landing?pricing=seeded';

async function open(page: Page, path = SEEDED) {
  await page.goto(path);
  await expect(
    page.getByRole('heading', { level: 1, name: HEADLINE }),
  ).toBeVisible();
}

/** Pricing has streamed in: the plans, or the state the page was held in. */
async function plans(page: Page) {
  await expect(
    page.locator('#pricing').getByRole('region', { name: 'Free' }),
  ).toBeVisible();
}

test('first paint: every section, the still image, Monthly prices', async ({
  page,
}) => {
  await open(page);
  await plans(page);
  await look(page, 'landing');
});

test('scrolled: the header stays at the top, with its border', async ({
  page,
}) => {
  await open(page);
  await plans(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(keepNormalized);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(() => window.scrollTo(0, 900));
    await expect(page.locator('header').first()).toBeInViewport();
    await expect(page).toHaveScreenshot(
      `landing-scrolled-desktop-${scheme}.png`,
    );
  }
  await page.evaluate(stopNormalizing);
});

test('the menu open at 390', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('button', { name: 'Close menu' })).toBeVisible();
  await look(page, 'landing-menu', { widths: ['phone'], viewportOnly: true });
});

test('a step highlighted', async ({ page }) => {
  await open(page);
  const step = page
    .getByRole('list')
    .filter({ hasText: '1. Someone asks' })
    .getByRole('listitem')
    .nth(1);
  await step.focus();
  await expect(step).toHaveAttribute('data-active', 'true');
  await look(page, 'landing-step', { target: page.locator('#how-it-works') });
});

test('pricing on Yearly', async ({ page }) => {
  await open(page);
  await plans(page);
  await page.locator('#pricing').getByRole('radio', { name: 'Yearly' }).click();
  await expect(
    page.locator('#pricing').getByRole('region', { name: 'Pro', exact: true }),
  ).toContainText('per year');
  await look(page, 'landing-pricing-yearly', {
    target: page.locator('#pricing'),
  });
});

test('pricing while the plans load', async ({ page }) => {
  await open(page, '/test-pages/landing?pricing=loading');
  await expect(page.getByRole('status')).toHaveText('Loading plans');
  await look(page, 'landing-pricing-loading', {
    target: page.locator('#pricing'),
  });
});

test('pricing when the plans couldn’t be read', async ({ page }) => {
  await open(page, '/test-pages/landing?pricing=unavailable');
  await expect(
    page.getByText('The plans couldn’t be loaded just now.', { exact: false }),
  ).toBeVisible();
  await look(page, 'landing-pricing-unavailable', {
    target: page.locator('#pricing'),
  });
});
