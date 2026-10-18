import { expect, test, type Page } from '@playwright/test';
import { look } from './look';
import { ROLES, failed, settings, type Overrides } from './settings-data';
import { signInAs, tenant } from './tenant';

/**
 * Settings › Roles (design 08): system roles first, a system role (read-
 * only), a custom role with an unsaved change, the no-escalation refusal,
 * New role, the last Org Admin, adding holders, and Delete with its refusal.
 */

const MENU = { disabled: ['aria-hidden-focus'] };

async function open(page: Page, path: string, overrides: Overrides = {}) {
  const { maya } = await tenant('settings');
  await signInAs(page, maya);
  await settings(page, maya.id, overrides);
  await page.goto(path);
  return maya;
}

test('the list: system roles, then custom ones', async ({ page }) => {
  await open(page, '/settings/roles');
  await expect(
    page.getByRole('heading', { name: 'System roles' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Billing Lead' }).first(),
  ).toBeVisible();
  await expect(
    page.getByText('Everything in Northwind Health:').first(),
  ).toBeVisible();
  await look(page, 'roles');
});

test('a system role: read-only', async ({ page }) => {
  await open(page, '/settings/roles/r-agent');
  await expect(page.getByText('System role · read-only')).toBeVisible();
  await expect(page.getByRole('button', { name: /Copy/ })).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: 'View all tickets' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Save permissions' }),
  ).toHaveCount(0);
  await look(page, 'role-system');
});

test('a custom role: one change unsaved', async ({ page }) => {
  await open(page, '/settings/roles/r-billing');
  await page.getByRole('checkbox', { name: 'View the audit log' }).click();
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await look(page, 'role-custom');
});

test('no escalation: the refusal in words', async ({ page }) => {
  await open(page, '/settings/roles/r-billing', {
    'PUT /roles/r-billing/permissions': failed(
      403,
      'You cannot grant permission(s) you do not hold: audit.export!',
    ),
  });
  await page.getByRole('checkbox', { name: 'View analytics' }).click();
  await page.getByRole('button', { name: 'Save permissions' }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Export the audit log isn’t yours to give.' }),
  ).toBeVisible();
  await look(page, 'role-no-escalation');
});

test('New role: start from a role, the name is taken', async ({ page }) => {
  await open(page, '/settings/roles', {
    'POST /roles': failed(409, 'A role with that name already exists!'),
  });
  await page.getByRole('button', { name: 'New role' }).click();
  await page.getByLabel('Name').fill('Billing Lead');
  await page.getByRole('combobox', { name: 'Start from' }).click();
  await page.getByRole('option', { name: 'Support Agent (Tier 2)' }).click();
  await page.getByRole('button', { name: 'Create role' }).click();
  await expect(
    page.getByText('A role named Billing Lead already exists.'),
  ).toBeVisible();
  await look(page, 'role-new-taken', { viewportOnly: true });
});

test('Org Admin: the last active Org Admin', async ({ page }) => {
  const { maya } = await tenant('settings');
  await open(page, '/settings/roles/r-admin', {
    [`DELETE /roles/r-admin/users/${maya.id}`]: failed(
      409,
      'This is the last active Org Admin. Promote another before removing this one!',
    ),
  });
  await page
    .getByRole('button', { name: 'Take Org Admin from Maya Chen' })
    .click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Maya Chen is the last active Org Admin' }),
  ).toBeVisible();
  await look(page, 'role-last-admin');
});

test('Who holds it: add several people', async ({ page }) => {
  await open(page, '/settings/roles/r-billing');
  await page.getByRole('button', { name: 'Add people' }).click();
  const picker = page.getByRole('combobox', { name: 'People' });
  await picker.fill('pri');
  await page.getByRole('option', { name: /Priya Shah/ }).click();
  await picker.fill('sam');
  await page.getByRole('option', { name: /Sam Okafor/ }).click();
  await expect(
    page.getByRole('button', { name: 'Give to 2 people' }),
  ).toBeEnabled();
  await look(page, 'role-add-holders', { viewportOnly: true });
});

test('Delete refused: held by someone', async ({ page }) => {
  await open(page, '/settings/roles/r-billing', {
    'DELETE /roles/r-billing': failed(
      409,
      'This role is assigned to 1 user(s). Reassign them before deleting it!',
    ),
  });
  await page.getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Billing Lead is held by 1 person' }),
  ).toBeVisible();
  await look(page, 'role-delete-refused', { viewportOnly: true });
});

test('Delete: a role nobody holds', async ({ page }) => {
  await open(page, '/settings/roles');
  await page
    .getByRole('button', { name: 'Actions for Night shift' })
    .first()
    .click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(
    page.getByText('Nobody holds it. It’s removed for good.'),
  ).toBeVisible();
  await look(page, 'role-delete', { viewportOnly: true, ...MENU });
});

test('the catalog has every permission, in words', async ({ page }) => {
  await open(page, '/settings/roles/r-admin');
  await expect(
    page.getByText(`${ROLES[0].permissionCodes.length} of 44 permissions.`),
  ).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(44);
});
