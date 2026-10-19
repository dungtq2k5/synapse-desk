import { expect, test, type Page } from '../coverage';
import { look } from './look';
import {
  USAGE,
  failed,
  hang,
  ok,
  paged,
  settings,
  type Overrides,
} from './settings-data';
import { signInAs, tenant } from './tenant';

/**
 * Settings › People (design 08): members in every status, row actions, no
 * results, loading and error; a person's page and each of its dialogs; your
 * own page; a Support Agent's read-only views; invitations, Invite with its
 * preview, too few seats and the result; and the invitee with no seat.
 */

const MENU = { disabled: ['aria-hidden-focus'] };

async function open(
  page: Page,
  path: string,
  overrides: Overrides = {},
  who: 'maya' | 'jordan' = 'maya',
) {
  const people = await tenant('settings');
  await signInAs(page, people[who]);
  await settings(page, people.maya.id, overrides);
  await page.goto(path);
  return people;
}

const preview = (rows: object[], seatOverrun = 0) =>
  ok({ rows, seatsInUse: 18, maxAgentSeats: 20, seatOverrun });
const row = (email: string, reason: string | null = null) => ({
  email,
  ok: reason === null,
  reason,
  unknownRoleIds: [],
  unknownDepartmentIds: [],
});

/** Opens Invite, types the addresses, and asks for the preview. */
async function invite(page: Page, emails: string[]) {
  await page.getByRole('button', { name: 'Invite people' }).click();
  const field = page.getByLabel('Email addresses');
  await field.fill(emails.join(', '));
  await field.press('Enter');
}

test.describe('members', () => {
  test('an Org Admin: every status', async ({ page }) => {
    await open(page, '/settings/people');
    await expect(
      page.getByRole('link', { name: 'Alex Rivera' }).first(),
    ).toBeVisible();
    await expect(
      page.getByText('Locked until Oct 21, 2026').first(),
    ).toBeVisible();
    await look(page, 'people');
  });

  test('a Support Agent: read-only', async ({ page }) => {
    await open(page, '/settings/people', {}, 'jordan');
    await expect(
      page.getByRole('link', { name: 'Alex Rivera' }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Invite people' }),
    ).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Roles' })).toHaveCount(0);
    await look(page, 'people-read-only');
  });

  test('row actions', async ({ page }) => {
    await open(page, '/settings/people');
    await page
      .getByRole('button', { name: 'Actions for Sam Okafor' })
      .first()
      .click();
    await expect(
      page.getByRole('menuitem', { name: 'Edit roles' }),
    ).toBeVisible();
    await look(page, 'people-row-actions', { viewportOnly: true, ...MENU });
  });

  test('no one matches', async ({ page }) => {
    await open(page, '/settings/people');
    await page
      .getByRole('searchbox', { name: 'Search by name or email' })
      .fill('zed');
    await expect(page.getByText(/No one matches/)).toBeVisible();
    await look(page, 'people-no-results');
  });

  test('loading', async ({ page }) => {
    await open(page, '/settings/people', { 'GET /users': hang });
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading people' }),
    ).toBeAttached();
    await look(page, 'people-loading');
  });

  test('error', async ({ page }) => {
    await open(page, '/settings/people', { 'GET /users': failed(500) });
    await expect(page.getByText('Couldn’t load people')).toBeVisible();
    await look(page, 'people-error');
  });
});

test.describe('a person', () => {
  test('an active member', async ({ page }) => {
    await open(page, '/settings/people/u-sam');
    await expect(
      page.getByRole('heading', { name: 'Sam Okafor', level: 1 }),
    ).toBeVisible();
    await expect(page.getByText('2 devices signed in.')).toBeVisible();
    await look(page, 'person');
  });

  test('locked until a date', async ({ page }) => {
    await open(page, '/settings/people/u-alex', {
      'GET /audit-logs': paged([]),
    });
    await expect(page.getByRole('button', { name: 'Unlock' })).toBeVisible();
    await look(page, 'person-locked');
  });

  test('deleted: Restore', async ({ page }) => {
    await open(page, '/settings/people/u-chris');
    await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
    await look(page, 'person-deleted');
  });

  test('Restore refused: no free seat', async ({ page }) => {
    await open(page, '/settings/people/u-chris', {
      'GET /organizations/current/usage': ok({
        ...USAGE,
        seats: { ...USAGE.seats, used: 20 },
      }),
      'POST /users/u-chris/restore': failed(
        402,
        'No seats left. Revoke a pending invitation or change the plan to add people!',
      ),
    });
    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(
      page.getByText('No free seat to restore Chris Park'),
    ).toBeVisible();
    await look(page, 'person-restore-no-seat');
  });

  test('your own page', async ({ page }) => {
    const { maya } = await tenant('settings');
    await open(page, `/settings/people/${maya.id}`);
    await expect(
      page.getByText('You can’t lock or delete your own account.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lock' })).toHaveCount(0);
    await look(page, 'person-own');
  });

  test('a Support Agent: read-only', async ({ page }) => {
    await open(page, '/settings/people/u-sam', {}, 'jordan');
    await expect(
      page.getByRole('heading', { name: 'Sam Okafor', level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit roles' })).toHaveCount(
      0,
    );
    await look(page, 'person-read-only');
  });

  test('Edit roles: the last active Org Admin', async ({ page }) => {
    const { maya } = await tenant('settings');
    await open(page, `/settings/people/${maya.id}`, {
      [`PUT /users/${maya.id}/roles`]: failed(
        409,
        'This is the last active Org Admin. Promote another before removing this one!',
      ),
    });
    await page.getByRole('button', { name: 'Edit roles' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit roles' });
    await dialog.getByRole('button', { name: /Remove Org Admin/ }).click();
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'last active Org Admin' }),
    ).toBeVisible();
    await look(page, 'person-edit-roles-last-admin', { viewportOnly: true });
  });

  test('Edit departments: one primary', async ({ page }) => {
    await open(page, '/settings/people/u-sam');
    await page.getByRole('button', { name: 'Edit departments' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Edit departments' }),
    ).toBeVisible();
    await expect(
      page.getByText('Exactly one department is their primary.'),
    ).toBeVisible();
    await look(page, 'person-edit-departments', { viewportOnly: true });
  });

  test('Lock: the reason and until when', async ({ page }) => {
    await open(page, '/settings/people/u-sam');
    await page.getByRole('button', { name: 'Lock' }).click();
    await expect(
      page.getByRole('alertdialog', { name: 'Lock Sam Okafor?' }),
    ).toBeVisible();
    await look(page, 'person-lock', { viewportOnly: true });
  });

  test('Sign out everywhere: the confirmation', async ({ page }) => {
    await open(page, '/settings/people/u-sam');
    await page
      .getByRole('button', { name: /Sign out everywhere/ })
      .first()
      .click();
    await expect(
      page.getByRole('alertdialog', {
        name: 'Sign Sam Okafor out everywhere?',
      }),
    ).toBeVisible();
    await look(page, 'person-sign-out', { viewportOnly: true });
  });

  test('Delete: the confirmation', async ({ page }) => {
    await open(page, '/settings/people/u-sam');
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(
      page.getByRole('alertdialog', { name: 'Delete Sam Okafor?' }),
    ).toBeVisible();
    await look(page, 'person-delete', { viewportOnly: true });
  });
});

test.describe('invitations', () => {
  test('every status', async ({ page }) => {
    await open(page, '/settings/people/invitations');
    await expect(page.getByText('Resent twice')).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: 'Revoke the invitation to omar@northwind.health',
      }),
    ).toBeVisible();
    await look(page, 'invitations');
  });

  test('Invite: the seats left', async ({ page }) => {
    await open(page, '/settings/people');
    await invite(page, ['omar@northwind.health', 'lena@northwind.health']);
    await expect(page.getByText('2 seats left')).toBeVisible();
    await look(page, 'invite', { viewportOnly: true });
  });

  test('Invite: the preview, with reasons', async ({ page }) => {
    await open(page, '/settings/people', {
      'POST /users/invitations/preview': preview([
        row('omar@northwind.health'),
        row('lena@northwind.health', 'An invitation is already pending'),
        row('sam@northwind.health', 'Already a member'),
      ]),
    });
    await invite(page, [
      'omar@northwind.health',
      'lena@northwind.health',
      'sam@northwind.health',
    ]);
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(
      page.getByRole('heading', { name: 'Check before sending' }),
    ).toBeVisible();
    await look(page, 'invite-preview', { viewportOnly: true });
  });

  test('Invite: too few seats', async ({ page }) => {
    await open(page, '/settings/people', {
      'POST /users/invitations/preview': preview(
        ['a', 'b', 'c'].map((name) => row(`${name}@northwind.health`)),
        1,
      ),
      'POST /users/invitations': failed(
        402,
        'No seats left. Revoke a pending invitation or change the plan to add people!',
      ),
    });
    await invite(page, [
      'a@northwind.health',
      'b@northwind.health',
      'c@northwind.health',
    ]);
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByText('Not enough seats')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Send/ })).toBeDisabled();
    await expect(
      page.getByRole('link', { name: 'Plans and billing' }),
    ).toBeVisible();
    await look(page, 'invite-too-few-seats', { viewportOnly: true });
  });

  test('Invite: the result', async ({ page }) => {
    await open(page, '/settings/people', {
      'POST /users/invitations/preview': preview([
        row('omar@northwind.health'),
        row('lena@northwind.health'),
      ]),
      'POST /users/invitations': ok(
        {
          batchId: 'b1',
          created: [
            {
              id: 'i9',
              email: 'omar@northwind.health',
              status: 'PENDING',
              roleIds: [],
              departmentIds: [],
              primaryDepartmentId: null,
              invitedByName: 'Maya Chen',
              resentCount: 0,
              lastSentAt: '2026-10-18T09:00:00.000Z',
              createdAt: '2026-10-18T09:00:00.000Z',
              expiresAt: '2026-10-25T09:00:00.000Z',
            },
          ],
          failed: [
            {
              email: 'lena@northwind.health',
              reason: 'An invitation is already pending',
            },
          ],
        },
        201,
      ),
    });
    await invite(page, ['omar@northwind.health', 'lena@northwind.health']);
    await page.getByRole('button', { name: 'Preview' }).click();
    await page.getByRole('button', { name: /^Send/ }).click();
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
    await look(page, 'invite-result', { viewportOnly: true });
  });

  test('Revoke: the confirmation', async ({ page }) => {
    await open(page, '/settings/people/invitations');
    await page
      .getByRole('button', {
        name: 'Revoke the invitation to omar@northwind.health',
      })
      .click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await look(page, 'invitation-revoke', { viewportOnly: true });
  });
});

test('accepting an invitation with no free seat', async ({ page }) => {
  await page.route('**/api/v1/users/invitations/token/*', (route) =>
    route.fulfill(
      ok({
        valid: true,
        email: 'omar@northwind.health',
        organizationName: 'Northwind Health',
        inviterName: 'Maya Chen',
        roleNames: ['End User'],
        expiresAt: '2026-10-25T09:00:00.000Z',
      }),
    ),
  );
  await page.route('**/api/v1/users/invitations/accept', (route) =>
    route.fulfill(
      failed(
        402,
        'This organization has no free seats right now. Ask the person who invited you to free a seat, then try again. Your invitation still works!',
      ),
    ),
  );
  await page.goto('/invitations/accept?token=screens-token');
  await page.getByLabel('Full name').fill('Omar Haddad');
  await page.getByLabel('Password', { exact: true }).fill('Harbor-Lights-26');
  await page.getByRole('button', { name: 'Join Northwind Health' }).click();
  await expect(page.getByText(/no free seats right now/)).toBeVisible();
  await look(page, 'invitation-accept-no-seat');
});
