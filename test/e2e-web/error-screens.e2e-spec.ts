import { expect, test, type Page } from './coverage';
import { tabTo } from './keyboard';
import { signInAsSuperAdmin, superAdmin } from './super-admin';
import { clearThrottles, DEMO_PASSWORD, seededActors, signIn } from './support';

/**
 * An error screen keeps a way out: it draws the shell's header, so at 390,
 * where the sidebar starts closed, the keyboard can still open it and leave.
 * The pages are test-only (`WEB_TEST_PAGES=1`) and fail as they render.
 */
test.beforeEach(clearThrottles);

async function leave(page: Page, link: string, to: RegExp): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await tabTo(page, page.getByRole('button', { name: 'Open menu' }));
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByRole('dialog').getByRole('link', { name: link }));
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(to);
}

test('**the app’s error screen**: open the menu and reach another page', async ({
  page,
}) => {
  const { requester } = await seededActors();
  await signIn(page, requester.email, DEMO_PASSWORD);
  await expect(page).toHaveURL(/\/(tickets|ask)$/);
  await page.goto('/test-pages/render-error');
  await expect(
    page.getByRole('heading', { name: 'Something went wrong' }),
  ).toBeVisible();

  await leave(page, 'Ask', /\/ask$/);
});

test('**the console’s error screen**: open the menu and reach another page', async ({
  page,
}) => {
  await signInAsSuperAdmin(page, await superAdmin('error-screen'));
  await page.goto('/platform/test-pages/render-error');
  await expect(
    page.getByRole('heading', { name: 'This console page didn’t load' }),
  ).toBeVisible();

  await leave(page, 'Organizations', /\/platform\/organizations$/);
});
