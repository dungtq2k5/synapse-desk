import { expect, test } from '@playwright/test';
import { look } from './look';
import { setEmailVerified, signInAs, tenant } from './tenant';

/**
 * The signed-in account screens, in every state, light and dark, at both
 * widths, drawn from the screen tenant (tenant.ts).
 */

test('the shell asks an unverified person to verify their email', async ({
  page,
}) => {
  const { priya } = await tenant('banner');
  await setEmailVerified([priya], false);
  await signInAs(page, priya);
  await page.goto('/tickets');
  await expect(
    page.getByRole('region', { name: 'Email verification' }),
  ).toBeVisible();
  await look(page, 'shell-verify-banner');
});
