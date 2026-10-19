import { expect, test, type Page } from '../coverage';
import { look } from './look';
import {
  SETTINGS,
  USAGE,
  failed,
  ok,
  settings,
  type Overrides,
} from './settings-data';
import { signInAs, tenant } from './tenant';

/**
 * Settings › Organization (design 08): the whole page, the meters that
 * couldn't be read or aren't available, the address taken, requiring
 * two-step, a public domain, inbound email on with its two confirmations,
 * the typed delete, and the two sign-in notices that follow it.
 */

const ADDRESS = 'tickets+k3v9q2@inbound.synapsedesk.test';

/**
 * The profile is read by the renderer's server, so it's the tenant's own:
 * its address and domain change every run.
 */
const profile = (page: Page) => [
  page.locator('#organization-slug'),
  page.locator('#organization-domain'),
];

async function open(page: Page, overrides: Overrides = {}) {
  const { maya } = await tenant('settings');
  await signInAs(page, maya);
  await settings(page, maya.id, overrides);
  await page.goto('/settings/organization');
  await expect(
    page.getByRole('heading', { name: 'Organization', level: 1 }),
  ).toBeVisible();
}

test('an Org Admin: every card', async ({ page }) => {
  await open(page);
  await expect(page.getByText('18 of 20')).toBeVisible();
  await expect(
    page.getByText('2 seats left. Pending invitations hold seats too.'),
  ).toBeVisible();
  await expect(page.getByText('62% used')).toBeVisible();
  await look(page, 'organization', { mask: profile(page) });
});

test('a meter that couldn’t be read, and one that isn’t available', async ({
  page,
}) => {
  await open(page, {
    'GET /organizations/current/usage': ok({
      ...USAGE,
      storage: {
        available: false,
        used: null,
        limit: null,
        unavailableReason: 'READ_FAILED',
      },
      aiTokens: {
        available: false,
        used: null,
        limit: null,
        unavailableReason: 'NOT_AVAILABLE',
      },
    }),
  });
  await expect(page.getByText('Couldn’t read it')).toBeVisible();
  await expect(page.getByText('Not available')).toBeVisible();
  await look(page, 'organization-meters-unavailable', { mask: profile(page) });
});

test('Profile: the address is taken', async ({ page }) => {
  await open(page, {
    'PATCH /organizations/current': failed(
      409,
      'That address is already taken by another organization!',
    ),
  });
  await page.getByLabel('Address').fill('northwind');
  await page.getByRole('button', { name: 'Save changes' }).first().click();
  await expect(
    page.getByText('That address is already taken by another organization.'),
  ).toBeVisible();
  await look(page, 'organization-address-taken', { mask: profile(page) });
});

test('Security: requiring two-step asks first', async ({ page }) => {
  await open(page);
  await page
    .getByRole('switch', { name: 'Require two-step verification for everyone' })
    .click();
  await expect(
    page.getByRole('alertdialog', {
      name: 'Require two-step verification for everyone?',
    }),
  ).toBeVisible();
  await look(page, 'organization-require-two-step', {
    viewportOnly: true,
    mask: profile(page),
  });
});

test('Security: a public email domain', async ({ page }) => {
  await open(page, {
    'GET /organizations/current/settings': ok({
      ...SETTINGS,
      allowedEmailDomains: ['northwind.health', 'gmail.com'],
      publicDomainWarnings: ['gmail.com'],
    }),
  });
  await expect(
    page.getByText('gmail.com is a public email domain'),
  ).toBeVisible();
  await look(page, 'organization-public-domain', { mask: profile(page) });
});

test.describe('inbound email on', () => {
  const on = {
    'GET /organizations/current/settings': ok({
      ...SETTINGS,
      inboundAddress: ADDRESS,
    }),
  };

  test('the address, just copied', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page, on);
    await page.getByRole('button', { name: 'Copy' }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    await look(page, 'organization-inbound-on', { mask: profile(page) });
  });

  test('Rotate: the confirmation', async ({ page }) => {
    await open(page, on);
    await page.getByRole('button', { name: 'Rotate address' }).click();
    await expect(
      page.getByRole('alertdialog', { name: 'Rotate the inbound address?' }),
    ).toBeVisible();
    await look(page, 'organization-inbound-rotate', {
      viewportOnly: true,
      mask: profile(page),
    });
  });

  test('Turn off: the confirmation', async ({ page }) => {
    await open(page, on);
    await page.getByRole('button', { name: 'Turn off' }).click();
    await expect(
      page.getByRole('alertdialog', { name: 'Turn off inbound email?' }),
    ).toBeVisible();
    await look(page, 'organization-inbound-off', {
      viewportOnly: true,
      mask: profile(page),
    });
  });
});

test('Delete: the typed confirmation', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Delete organization' }).click();
  const dialog = page.getByRole('alertdialog', {
    name: 'Delete Northwind Health?',
  });
  await dialog
    .getByLabel('Why are you deleting it?')
    .fill('We merged with Contoso.');
  await dialog.getByLabel('Type Northwind Health to confirm').fill('Northwind');
  await expect(
    dialog.getByRole('button', { name: 'Delete organization' }),
  ).toBeDisabled();
  await look(page, 'organization-delete', {
    viewportOnly: true,
    mask: profile(page),
  });
});

test('after deleting: sign-in says why', async ({ page }) => {
  await page.goto('/login?organization-deleted=Northwind%20Health');
  await expect(
    page.getByText('Northwind Health is being deleted'),
  ).toBeVisible();
  await look(page, 'organization-after-deleting');
});

test('a frozen organization’s sign-in', async ({ page }) => {
  await page.route('**/api/v1/auth/login', (route) =>
    route.fulfill({
      status: 403,
      json: {
        ...failed(
          403,
          "This organization can't be opened. Contact support to restore access!",
        ).json,
        details: { organizationStatus: 'FROZEN' },
      },
    }),
  );
  await page.goto('/login');
  await page.getByLabel('Email').fill('priya@northwind.health');
  await page.getByLabel('Password', { exact: true }).fill('a-long-password-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByText('This organization can’t be opened'),
  ).toBeVisible();
  await look(page, 'organization-frozen-sign-in');
});

test('the sidebar: Settings only for someone who holds one of its permissions', async ({
  page,
}) => {
  const { priya, jordan } = await tenant('settings');
  await signInAs(page, priya);
  await page.goto('/tickets');
  const sidebar = page.getByRole('navigation').first();
  await expect(sidebar.getByRole('link', { name: 'Ask' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await signInAs(page, jordan);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/settings\/people$/);
  const sections = page.getByRole('navigation', { name: 'Settings' });
  await expect(sections.getByRole('link')).toHaveText([
    'People',
    'Departments',
  ]);
});
