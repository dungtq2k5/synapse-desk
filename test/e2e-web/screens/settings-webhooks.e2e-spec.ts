import { expect, test, type Page } from '@playwright/test';
import { look } from './look';
import {
  ENDPOINTS,
  failed,
  ok,
  settings,
  type Overrides,
} from './settings-data';
import { signInAs, tenant } from './tenant';

/**
 * Settings › Webhooks (design 08): the list in each status, empty, New
 * endpoint's checks, the secret shown once, an endpoint with a test, turned
 * off by SynapseDesk, More actions, rotating, and Delete.
 */

const MENU = { disabled: ['aria-hidden-focus'] };
/** The secret is drawn fixed, so a baseline holds it. */
const SECRET = 'whsec_7Qk2v9XbL0p3mZt8RcY4nW1e';

async function open(page: Page, path: string, overrides: Overrides = {}) {
  const { maya } = await tenant('settings');
  await signInAs(page, maya);
  await settings(page, maya.id, overrides);
  await page.goto(path);
}

test('the list: active, turned off by SynapseDesk, turned off', async ({
  page,
}) => {
  await open(page, '/settings/webhooks');
  await expect(
    page.getByText('Turned off by SynapseDesk').first(),
  ).toBeVisible();
  await expect(
    page.getByText('Deliveries failed 50 times in a row.').first(),
  ).toBeVisible();
  await expect(page.getByText('All 10 events').first()).toBeVisible();
  await look(page, 'webhooks');
});

test('empty', async ({ page }) => {
  await open(page, '/settings/webhooks', {
    'GET /webhook-endpoints': ok({ items: [] }),
  });
  await expect(page.getByText('No endpoints yet')).toBeVisible();
  await look(page, 'webhooks-empty');
});

test('New endpoint: HTTPS, and at least one event', async ({ page }) => {
  await open(page, '/settings/webhooks');
  await page.getByRole('button', { name: 'New endpoint' }).click();
  await page.getByLabel('URL').fill('http://ops.northwind.health/synapse');
  await page.getByLabel('Description (optional)').fill('Ops dashboard');
  await page.getByRole('button', { name: 'Create endpoint' }).click();
  await expect(page.getByText('Use an https:// address.')).toBeVisible();
  await expect(page.getByText('Choose at least one event.')).toBeVisible();
  await look(page, 'webhooks-new-errors', { viewportOnly: true });
});

test('the signing secret, once', async ({ page }) => {
  await open(page, '/settings/webhooks', {
    'POST /webhook-endpoints': ok(
      {
        endpoint: {
          ...ENDPOINTS[1],
          id: 'w-new',
          isActive: true,
          disabledReason: null,
        },
        secret: SECRET,
      },
      201,
    ),
  });
  await page.getByRole('button', { name: 'New endpoint' }).click();
  await page.getByLabel('URL').fill('https://ops.northwind.health/synapse');
  await page.getByRole('button', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Create endpoint' }).click();
  await expect(page.getByText('Copy the signing secret now')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Done' })).toBeDisabled();
  await page.getByLabel('I’ve stored the secret somewhere safe').click();
  await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled();
  await look(page, 'webhooks-secret', { viewportOnly: true });
});

test('an endpoint: test delivered', async ({ page }) => {
  await open(page, '/settings/webhooks/w-slack', {
    'POST /webhook-endpoints/w-slack/test': ok({
      delivered: true,
      responseStatus: 200,
      error: null,
    }),
  });
  await page.getByRole('button', { name: 'Send test' }).click();
  await expect(page.getByText('Test delivered')).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Service Unavailable' }),
  ).toBeVisible();
  await look(page, 'webhook');
});

test('an endpoint turned off by SynapseDesk', async ({ page }) => {
  await open(page, '/settings/webhooks/w-ops');
  await expect(
    page.getByText('SynapseDesk turned this endpoint off'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn on' })).toHaveCount(2);
  await look(page, 'webhook-system-off');
});

test('Send test: failed', async ({ page }) => {
  await open(page, '/settings/webhooks/w-slack', {
    'POST /webhook-endpoints/w-slack/test': ok({
      delivered: false,
      responseStatus: 503,
      error: 'Service Unavailable',
    }),
  });
  await page.getByRole('button', { name: 'Send test' }).click();
  await expect(
    page.getByText('The receiver answered 503 Service Unavailable.'),
  ).toBeVisible();
  await look(page, 'webhook-test-failed');
});

test('More actions', async ({ page }) => {
  await open(page, '/settings/webhooks/w-slack');
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(
    page.getByRole('menuitem', { name: 'Rotate secret' }),
  ).toBeVisible();
  await look(page, 'webhook-more', { viewportOnly: true, ...MENU });
});

test('Rotate secret: the old one works 24 more hours', async ({ page }) => {
  await open(page, '/settings/webhooks/w-slack');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Rotate secret' }).click();
  await expect(
    page.getByText('The old one keeps working for 24 hours'),
  ).toBeVisible();
  await look(page, 'webhook-rotate', { viewportOnly: true });
});

test('the new secret, once: when the old one stops', async ({ page }) => {
  await open(page, '/settings/webhooks/w-slack', {
    'POST /webhook-endpoints/w-slack/rotate-secret': ok({
      endpoint: ENDPOINTS[0],
      secret: SECRET,
    }),
  });
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Rotate secret' }).click();
  await page.getByRole('button', { name: 'Rotate secret' }).click();
  await expect(page.getByText('New signing secret')).toBeVisible();
  const note = page.getByText(/The old secret keeps working until/);
  await expect(note).toBeVisible();
  await look(page, 'webhook-new-secret', { viewportOnly: true, mask: [note] });
});

test('Delete: the confirmation', async ({ page }) => {
  await open(page, '/settings/webhooks/w-slack', {
    'DELETE /webhook-endpoints/w-slack': failed(500),
  });
  await page
    .getByRole('button', { name: 'Delete', exact: true })
    .last()
    .click();
  await expect(
    page.getByRole('alertdialog', { name: 'Delete this endpoint?' }),
  ).toBeVisible();
  await look(page, 'webhook-delete', { viewportOnly: true });
});
