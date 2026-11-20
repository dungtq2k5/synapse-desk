import { expect, test, type Page } from '../coverage';
import { look } from './look';
import {
  DEPARTMENTS,
  failed,
  paged,
  settings,
  type Overrides,
} from './settings-data';
import { signInAs, tenant, type Person } from './tenant';

/**
 * Settings › Departments (design 08): the list, New and Edit, Delete and
 * its refusal, Show deleted, empty, a department, Add people and Remove's
 * refusal; an Org Admin's and a Support Agent's (read-only). The data is the
 * deck's (settings-data.ts); the viewer is real.
 */

const MENU = { disabled: ['aria-hidden-focus'] };

async function open(
  page: Page,
  path: string,
  overrides: Overrides = {},
  who: 'maya' | 'jordan' = 'maya',
): Promise<Person> {
  const people = await tenant('settings');
  const viewer = people[who];
  await signInAs(page, viewer);
  await settings(page, people.maya.id, overrides);
  await page.goto(path);
  return viewer;
}

test.describe('the list', () => {
  test('an Org Admin', async ({ page }) => {
    await open(page, '/settings/departments');
    await expect(page.getByRole('link', { name: 'HR' })).toBeVisible();
    await expect(page.getByText('6 members').first()).toBeVisible();
    await expect(
      page.getByText('1 member', { exact: true }).first(),
    ).toBeVisible();
    await look(page, 'departments');
  });

  test('a Support Agent: read-only', async ({ page }) => {
    await open(page, '/settings/departments', {}, 'jordan');
    await expect(page.getByRole('link', { name: 'HR' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'New department' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /^Actions for/ }),
    ).toHaveCount(0);
    await expect(page.getByText('Show deleted')).toHaveCount(0);
    await look(page, 'departments-read-only');
  });

  test('New department: the name is taken', async ({ page }) => {
    await open(page, '/settings/departments', {
      'POST /departments': failed(
        409,
        'A department with that name already exists!',
      ),
    });
    await page.getByRole('button', { name: 'New department' }).click();
    await page.getByLabel('Name').fill('HR');
    await page.getByRole('button', { name: 'Create department' }).click();
    await expect(
      page.getByText('A department named HR already exists.'),
    ).toBeVisible();
    await look(page, 'departments-new-taken', { viewportOnly: true });
  });

  test('Delete refused: it still has members', async ({ page }) => {
    await open(page, '/settings/departments', {
      'DELETE /departments/hr': failed(
        409,
        'This department still has 6 member(s). Reassign them before deleting it!',
      ),
    });
    await page.getByRole('button', { name: 'Actions for HR' }).first().click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'HR still has 6 members' }),
    ).toBeVisible();
    await look(page, 'departments-delete-refused', { viewportOnly: true });
  });

  test('Delete: an empty department', async ({ page }) => {
    await open(page, '/settings/departments');
    await page
      .getByRole('button', { name: 'Actions for Payroll' })
      .first()
      .click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(
      page.getByRole('alertdialog', { name: 'Delete Payroll?' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await look(page, 'departments-delete', { viewportOnly: true });
  });

  test('Show deleted: Restore', async ({ page }) => {
    await open(page, '/settings/departments', {
      'GET /departments': (route) =>
        route.fulfill(
          new URL(route.request().url()).searchParams.get('includeDeleted')
            ? paged([
                ...DEPARTMENTS,
                {
                  ...DEPARTMENTS[5],
                  id: 'travel',
                  name: 'Travel',
                  description: 'Trips and bookings.',
                  deletedAt: '2026-10-03T09:00:00.000Z',
                  deletedByName: 'Maya Chen',
                },
              ])
            : paged(DEPARTMENTS),
        ),
    });
    await page.getByLabel('Show deleted').click();
    await expect(
      page.getByRole('button', { name: 'Restore Travel' }).first(),
    ).toBeVisible();
    await look(page, 'departments-show-deleted');
  });

  test('empty', async ({ page }) => {
    await open(page, '/settings/departments', {
      'GET /departments': paged([]),
    });
    await expect(page.getByText('No departments yet')).toBeVisible();
    await look(page, 'departments-empty');
  });

  test('row actions', async ({ page }) => {
    await open(page, '/settings/departments');
    await page.getByRole('button', { name: 'Actions for HR' }).first().click();
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
    await look(page, 'departments-row-actions', {
      viewportOnly: true,
      ...MENU,
    });
  });
});

test.describe('a department', () => {
  test('its members, the primary marked', async ({ page }) => {
    await open(page, '/settings/departments/hr');
    await expect(
      page.getByRole('heading', { name: 'HR', level: 1 }),
    ).toBeVisible();
    await expect(page.getByText('6 members').first()).toBeVisible();
    await expect(page.getByText('Primary').first()).toBeVisible();
    await look(page, 'department');
  });

  test('Add people', async ({ page }) => {
    await open(page, '/settings/departments/hr');
    await page.getByRole('button', { name: 'Add people' }).click();
    const picker = page.getByRole('combobox', { name: 'People' });
    await picker.fill('pri');
    await page.getByRole('option', { name: /Priya Shah/ }).click();
    await picker.fill('ale');
    await page.getByRole('option', { name: /Alex Rivera/ }).click();
    await expect(
      page.getByRole('button', { name: 'Add 2 people' }),
    ).toBeEnabled();
    await look(page, 'department-add-people', { viewportOnly: true });
  });

  test('Remove refused: their primary department', async ({ page }) => {
    await open(page, '/settings/departments/hr', {
      'DELETE /departments/hr/members/u-sam': failed(
        409,
        "This is the user's primary department. Set another of their departments as primary first!",
      ),
    });
    await page
      .getByRole('button', { name: 'Remove Sam Okafor from HR' })
      .first()
      .click();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'HR is Sam Okafor’s primary department' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Open Sam Okafor' }),
    ).toBeVisible();
    await look(page, 'department-remove-refused');
  });

  test('a Support Agent: read-only', async ({ page }) => {
    await open(page, '/settings/departments/hr', {}, 'jordan');
    await expect(page.getByText('6 members').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add people' })).toHaveCount(
      0,
    );
    await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0);
    await look(page, 'department-read-only');
  });
});
