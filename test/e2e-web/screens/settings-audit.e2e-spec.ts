import { expect, test, type Page } from '@playwright/test';
import { look } from './look';
import {
  failed,
  hang,
  ok,
  paged,
  settings,
  type Overrides,
} from './settings-data';
import { signInAs, tenant } from './tenant';

/**
 * Settings › Audit log (design 08): the log, the action filter, filters set,
 * an entry's sheet, Export and its three states, no results, loading and
 * error. An export in flight is kept in the browser's storage, cleared per
 * row by a new context.
 */

const MENU = { disabled: ['aria-hidden-focus'] };

const exportJob = (status: 'PENDING' | 'READY' | 'FAILED') =>
  ok({
    id: 'x1',
    status,
    kind: 'AUDIT_LOG',
    rowCount: status === 'READY' ? 2 : null,
    rollupComputedAt: null,
    downloadUrl:
      status === 'READY' ? 'https://files.example.test/audit.csv' : null,
    error: status === 'FAILED' ? 'Failed' : null,
    createdAt: '2026-10-18T14:30:00.000Z',
    completedAt: status === 'PENDING' ? null : '2026-10-18T14:31:00.000Z',
  });

/** Picks an action by typing its first words: the list is long. */
async function chooseAction(page: Page, words: string) {
  const action = page.getByRole('combobox', { name: 'Action' });
  await action.click();
  // The list is longer than the screen: focus the option, then pick it.
  await page.getByRole('option', { name: words, exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(action).toContainText(words);
}

async function open(page: Page, overrides: Overrides = {}) {
  const { maya } = await tenant('settings');
  await signInAs(page, maya);
  await settings(page, maya.id, overrides);
  await page.goto('/settings/audit-log');
}

/** Asks for an export with the current filters; the server answers `status`. */
async function exporting(page: Page, status: 'PENDING' | 'READY' | 'FAILED') {
  await open(page, {
    'POST /audit-logs/export': ok({ id: 'x1' }, 202),
    'GET /audit-logs/export/x1': exportJob(status),
  });
  await chooseAction(page, 'Locked a person');
  await page.getByRole('button', { name: /^Export/ }).click();
  await page.getByLabel('From', { exact: true }).fill('2026-10-01');
  await page.getByLabel('To', { exact: true }).fill('2026-10-18');
  await page.getByRole('button', { name: 'Request export' }).click();
}

test('the log: who did what, in words', async ({ page }) => {
  await open(page);
  await expect(
    page.getByRole('button', { name: 'Invited a person' }).first(),
  ).toBeVisible();
  await expect(
    page
      .getByText('Webhook endpoint · https://hooks.slack.com/services/T0/B0')
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText('SynapseDesk', { exact: true }).first(),
  ).toBeVisible();
  await look(page, 'audit');
});

test('the action filter: every action in words', async ({ page }) => {
  await open(page);
  await page.getByRole('combobox', { name: 'Action' }).click();
  await expect(
    page.getByRole('option', { name: 'Rotated a webhook’s signing secret' }),
  ).toBeAttached();
  await expect(page.getByRole('option')).toHaveCount(53);
  await look(page, 'audit-action-filter', { viewportOnly: true, ...MENU });
});

test('filters set', async ({ page }) => {
  await open(page);
  await chooseAction(page, 'Locked a person');
  await page.getByRole('combobox', { name: 'Dates' }).click();
  await page.getByRole('option', { name: 'Last 7 days' }).click();
  await expect(
    page.getByRole('button', { name: 'Clear filters' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Locked a person' }),
  ).toHaveCount(1);
  await look(page, 'audit-filters');
});

test('an entry: before and after', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Locked a person' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Locked a person' });
  await expect(sheet.getByText('USER_LOCKED')).toBeVisible();
  await expect(
    sheet.getByRole('cell', {
      name: 'Laptop reported stolen; waiting for IT to reissue.',
    }),
  ).toBeVisible();
  await look(page, 'audit-entry', { viewportOnly: true });
});

test('Export: a date range with the current filters', async ({ page }) => {
  await open(page);
  await chooseAction(page, 'Locked a person');
  await page.getByRole('button', { name: /^Export/ }).click();
  await page.getByLabel('From', { exact: true }).fill('2026-10-01');
  await page.getByLabel('To', { exact: true }).fill('2026-10-18');
  await expect(page.getByText('Action: Locked a person')).toBeVisible();
  await look(page, 'audit-export', { viewportOnly: true });
});

test('Export: preparing', async ({ page }) => {
  await exporting(page, 'PENDING');
  await expect(page.getByText('Preparing your export')).toBeVisible();
  await look(page, 'audit-export-preparing', {
    // The spinner turns.
    mask: [page.locator('.animate-spin')],
  });
});

test('Export: ready', async ({ page }) => {
  await exporting(page, 'READY');
  await expect(
    page.getByRole('button', { name: 'Download CSV' }),
  ).toBeVisible();
  await expect(page.getByText(/Locked a person · 2 entries\./)).toBeVisible();
  await look(page, 'audit-export-ready');
});

test('Export: failed', async ({ page }) => {
  await exporting(page, 'FAILED');
  await expect(page.getByText('The export failed')).toBeVisible();
  await look(page, 'audit-export-failed');
});

test('no entries match', async ({ page }) => {
  await open(page, { 'GET /audit-logs': paged([]) });
  await expect(page.getByText('No entries match')).toBeVisible();
  await look(page, 'audit-no-results');
});

test('loading', async ({ page }) => {
  await open(page, { 'GET /audit-logs': hang });
  await expect(
    page.getByRole('status').filter({ hasText: 'Loading the audit log' }),
  ).toBeAttached();
  await look(page, 'audit-loading');
});

test('error', async ({ page }) => {
  await open(page, { 'GET /audit-logs': failed(500) });
  await expect(page.getByText('Couldn’t load the audit log')).toBeVisible();
  await look(page, 'audit-error');
});
