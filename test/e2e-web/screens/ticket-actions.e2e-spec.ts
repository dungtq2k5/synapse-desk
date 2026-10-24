import { expect, test, type Page } from '../coverage';
import { api } from '../support';
import { look } from './look';
import { sessionAs, signInAs, tenant, type Person } from './tenant';

/**
 * The agent's action bar, in every state, light and dark, at both widths:
 * the status menu and its dialogs, assigning, editing, deleting and
 * restoring. A row that changes its ticket has a tenant of its own.
 */

async function open(page: Page, person: Person, ticketId: string) {
  await signInAs(page, person);
  await page.goto(`/tickets/${ticketId}`);
  await expect(page.getByRole('log', { name: 'Conversation' })).toBeVisible();
  await expect(
    page.getByRole('toolbar', { name: 'Ticket actions' }),
  ).toBeVisible();
}

/**
 * Radix's modal menu hides the rest of the page with aria-hidden and traps
 * focus inside the menu, so nothing hidden can be reached; axe sees the hiding
 * but not the trap.
 */
const MENU_OPEN = { disabled: ['aria-hidden-focus'] };

const failure = {
  status: 500,
  json: { success: false, statusCode: 500, error: 'Internal server error!' },
};

test.describe('status', () => {
  test('the menu offers only the moves from Escalated', async ({ page }) => {
    const { maya, tickets } = await tenant('actions');
    await open(page, maya, tickets.vpn);
    await page
      .getByRole('button', { name: 'Status: Escalated. Change status' })
      .click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText(['Resolve…', 'Close…']);
    await look(page, 'actions-status-menu', MENU_OPEN);
  });

  test('the Resolve dialog, with a reason', async ({ page }) => {
    const { maya, tickets } = await tenant('actions');
    await open(page, maya, tickets.vpn);
    await page
      .getByRole('button', { name: 'Status: Escalated. Change status' })
      .click();
    await page.getByRole('menuitem', { name: 'Resolve…' }).click();
    const dialog = page.getByRole('dialog', {
      name: /^Resolve ticket #\d+\?$/,
    });
    await expect(dialog.getByLabel('Reason (optional)')).toBeFocused();
    await dialog
      .getByLabel('Reason (optional)')
      .fill('Reset the VPN profile; drops stopped.');
    await expect(dialog.getByText('37/500')).toBeVisible();
    await look(page, 'actions-resolve');
  });

  test('resolving: both buttons wait', async ({ page }) => {
    const { maya, tickets } = await tenant('actions');
    await open(page, maya, tickets.vpn);
    await page.route('**/api/v1/tickets/*/resolve', () => undefined);
    await page
      .getByRole('button', { name: 'Status: Escalated. Change status' })
      .click();
    await page.getByRole('menuitem', { name: 'Resolve…' }).click();
    await page.getByRole('button', { name: 'Resolve', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('button', { name: 'Resolving…' }),
    ).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await expect(dialog).toHaveAttribute('aria-busy', 'true');
    await look(page, 'actions-resolve-busy');
  });

  test('resolving failed: the reason is kept', async ({ page }) => {
    const { maya, tickets } = await tenant('actions');
    await open(page, maya, tickets.vpn);
    await page.route('**/api/v1/tickets/*/resolve', (route) =>
      route.fulfill(failure),
    );
    await page
      .getByRole('button', { name: 'Status: Escalated. Change status' })
      .click();
    await page.getByRole('menuitem', { name: 'Resolve…' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Reason (optional)').fill('Reset the VPN profile.');
    await dialog.getByRole('button', { name: 'Resolve', exact: true }).click();
    await expect(
      dialog.getByRole('alert').getByText('Couldn’t change the status'),
    ).toBeVisible();
    await expect(dialog.getByLabel('Reason (optional)')).toHaveValue(
      'Reset the VPN profile.',
    );
    await look(page, 'actions-resolve-failed');
  });

  test('the Close dialog', async ({ page }) => {
    const { maya, tickets } = await tenant('actions');
    await open(page, maya, tickets.vpn);
    await page
      .getByRole('button', { name: 'Status: Escalated. Change status' })
      .click();
    await page.getByRole('menuitem', { name: 'Close…' }).click();
    await expect(
      page.getByRole('dialog', { name: /^Close ticket #\d+\?$/ }),
    ).toContainText('No one can reply until it’s reopened.');
    await look(page, 'actions-close');
  });

  test('the Reopen dialog, from Resolved', async ({ page }) => {
    const { maya, tickets } = await tenant('actions');
    await open(page, maya, tickets.billing);
    await page
      .getByRole('button', { name: 'Status: Resolved. Change status' })
      .click();
    await expect(page.getByRole('menuitem')).toHaveText(['Close…', 'Reopen…']);
    await page.getByRole('menuitem', { name: 'Reopen…' }).click();
    await expect(
      page.getByRole('dialog', { name: /^Reopen ticket #\d+\?$/ }),
    ).toContainText('The ticket moves back to Open.');
    await look(page, 'actions-reopen');
  });

  test('the Escalate dialog, from Open', async ({ page }) => {
    const { maya, tickets } = await tenant('actions');
    await open(page, maya, tickets.desk);
    await page
      .getByRole('button', { name: 'Status: Open. Change status' })
      .click();
    await expect(page.getByRole('menuitem')).toHaveText([
      'Mark as pending agent…',
      'Escalate…',
      'Resolve…',
      'Close…',
    ]);
    await page.getByRole('menuitem', { name: 'Escalate…' }).click();
    await expect(
      page.getByRole('dialog', { name: /^Escalate ticket #\d+\?$/ }),
    ).toBeVisible();
    await look(page, 'actions-escalate');
  });

  test('resolved: the toast, the badge and the history', async ({ page }) => {
    const { maya, tickets } = await tenant('resolved');
    await open(page, maya, tickets.vpn);
    await page
      .getByRole('button', { name: 'Status: Escalated. Change status' })
      .click();
    await page.getByRole('menuitem', { name: 'Resolve…' }).click();
    await page.getByRole('button', { name: 'Resolve', exact: true }).click();
    await expect(
      page
        .getByRole('region', { name: 'Notifications alt+T' })
        .getByText('Status changed to Resolved'),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Status: Resolved. Change status' }),
    ).toBeVisible();
    await look(page, 'actions-resolved', { viewportOnly: true });
  });
});

test.describe('assigning', () => {
  test('unassigned, with Assign to me in two departments', async ({ page }) => {
    const { maya, tickets } = await tenant('actions');
    await open(page, maya, tickets.mobile);
    await page.getByRole('button', { name: 'Assign to me' }).click();
    await expect(page.getByRole('menuitem')).toHaveText([
      'Facilities',
      'Workplace',
    ]);
    await look(page, 'actions-assign-to-me', MENU_OPEN);
  });

  test('the Assign dialog, a person chosen', async ({ page }) => {
    const { maya, tickets } = await tenant('actions');
    await open(page, maya, tickets.mobile);
    await page.getByRole('button', { name: 'Assign…' }).click();
    const dialog = page.getByRole('dialog', { name: /^Assign ticket #\d+$/ });
    await expect(dialog.getByRole('button', { name: 'Assign' })).toBeDisabled();
    await dialog.getByRole('combobox', { name: 'Department' }).click();
    await page.getByRole('option', { name: 'Workplace' }).click();
    await dialog.getByRole('combobox', { name: 'Assignee' }).click();
    await page.getByRole('option', { name: 'Jordan Lee' }).click();
    await expect(dialog.getByRole('combobox', { name: 'Reason' })).toHaveText(
      'First assignment',
    );
    await expect(dialog.getByRole('button', { name: 'Assign' })).toBeEnabled();
    await look(page, 'actions-assign');
  });

  test('Reassign: a new department sets the reason', async ({ page }) => {
    const { maya, tickets } = await tenant('actions');
    await open(page, maya, tickets.vpn);
    await page.getByRole('button', { name: 'Reassign…' }).click();
    const dialog = page.getByRole('dialog', { name: /^Reassign ticket #\d+$/ });
    await expect(dialog).toContainText('Currently Maya Chen in Workplace.');
    await dialog.getByRole('combobox', { name: 'Department' }).click();
    await page.getByRole('option', { name: 'Facilities' }).click();
    await dialog.getByRole('combobox', { name: 'Assignee' }).click();
    await page.getByRole('option', { name: 'Maya Chen' }).click();
    await expect(dialog.getByRole('combobox', { name: 'Reason' })).toHaveText(
      'Department change',
    );
    await expect(
      dialog.getByText(
        'Set because the department changed. You can pick another reason.',
      ),
    ).toBeVisible();
    await look(page, 'actions-reassign');
  });

  test('More: Unassign and Delete ticket', async ({ page }) => {
    const { maya, tickets } = await tenant('actions');
    await open(page, maya, tickets.desk);
    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(
      page.getByRole('menuitem', { name: 'Unassign' }),
    ).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: 'Delete ticket' }),
    ).toBeVisible();
    await look(page, 'actions-more', MENU_OPEN);
  });

  test('unassigned: the toast offers Undo', async ({ page }) => {
    const { maya, tickets } = await tenant('unassign');
    await open(page, maya, tickets.desk);
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Unassign' }).click();
    await expect(page.getByText(/^Ticket #\d+ is unassigned$/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Assign…' })).toBeVisible();
    await look(page, 'actions-unassigned', { viewportOnly: true });

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(
      page
        .getByRole('region', { name: 'Notifications alt+T' })
        .getByText('Assigned to Maya Chen'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reassign…' })).toBeVisible();
  });
});

test.describe('editing and deleting', () => {
  test('the Edit dialog', async ({ page }) => {
    const { maya, tickets } = await tenant('actions');
    await open(page, maya, tickets.desk);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /^Edit ticket #\d+$/ });
    await expect(dialog.getByLabel('Title')).toBeFocused();
    await expect(dialog.getByText('29/255')).toBeVisible();
    await look(page, 'actions-edit');
  });

  test('editing: the field errors', async ({ page }) => {
    const { maya, tickets } = await tenant('actions');
    await open(page, maya, tickets.desk);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Title').fill('Hi');
    await dialog.getByLabel('Description').fill('x'.repeat(20_001));
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(
      dialog.getByText('Enter a title of at least 3 characters.'),
    ).toBeVisible();
    await expect(
      dialog.getByText(
        'Shorten the description to 20,000 characters or fewer.',
      ),
    ).toBeVisible();
    await look(page, 'actions-edit-errors');
  });

  test('the Delete confirmation focuses Cancel', async ({ page }) => {
    const { maya, tickets } = await tenant('actions');
    await open(page, maya, tickets.desk);
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete ticket' }).click();
    const dialog = page.getByRole('alertdialog', {
      name: /^Delete ticket #\d+\?$/,
    });
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await look(page, 'actions-delete');
  });

  test('a deleted ticket: Restore in place of the bar', async ({ page }) => {
    const { maya, tickets } = await tenant('deleted');
    const mayas = await sessionAs(maya);
    expect((await mayas.delete(`/api/v1/tickets/${tickets.desk}`)).ok()).toBe(
      true,
    );
    await mayas.dispose();
    await signInAs(page, maya);
    await page.goto(`/tickets/${tickets.desk}`);
    await expect(
      page.getByText('This ticket is deleted').first(),
    ).toBeVisible();
    await expect(
      page.getByText('This ticket is deleted. Restore it to reply.'),
    ).toBeVisible();
    await expect(page.getByRole('toolbar')).toHaveCount(0);
    await look(page, 'actions-deleted');

    await page.getByRole('button', { name: 'Restore ticket' }).click();
    await expect(page.getByText(/^Ticket #\d+ restored$/)).toBeVisible();
    await expect(
      page.getByRole('toolbar', { name: 'Ticket actions' }),
    ).toBeVisible();
  });
});

test('an agent who can only assign to themselves', async ({ page }) => {
  const { maya, jordan, tickets } = await tenant('self-only');
  const mayas = await sessionAs(maya);
  const { id: roleId } = await api<{ id: string }>(mayas, 'POST', '/roles', {
    name: 'Queue agent',
    permissionCodes: [
      'ticket.read.all',
      'ticket.assign.self',
      'department.read',
    ],
  });
  await api(mayas, 'PUT', `/users/${jordan.id}/roles`, { roleIds: [roleId] });
  await mayas.dispose();

  await open(page, jordan, tickets.mobile);
  const bar = page.getByRole('toolbar', { name: 'Ticket actions' });
  // Escalate needs no permission; nothing else is offered.
  await expect(bar.getByRole('button')).toHaveText([/^Status/, 'Assign to me']);
  await bar.getByRole('button', { name: /^Status/ }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Escalate…']);
  await page.keyboard.press('Escape');
  await look(page, 'actions-self-only');
});
