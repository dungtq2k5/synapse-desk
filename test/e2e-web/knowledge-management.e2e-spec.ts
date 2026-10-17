import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REPO_ROOT } from '../system/services';
import {
  documentFlag,
  sessionAs,
  setStorageLimit,
  signInAs,
  tenant,
  type Person,
} from './screens/tenant';
import { api, clearThrottles } from './support';

/**
 * Managing the knowledge base, end to end, through the real services: files
 * go to the Storage emulator and are processed by ingestion-service's
 * model-free embeddings, which rag-service's model-free answers search, so
 * everything here works offline (global-setup.ts).
 */
test.beforeEach(clearThrottles);

const FIXTURES = join(REPO_ROOT, 'scripts/seed-demo/fixtures');

/**
 * A file the page can be handed: its name, type and words. Its words are
 * padded past the chunker's minimum (16 tokens), under which a passage is
 * dropped and the file reads as having no text.
 */
const file = (name: string, text: string, mimeType = 'text/plain') => ({
  name,
  mimeType,
  buffer: Buffer.from(
    `${text} This note is kept by the Workplace team and reviewed every quarter, so check back here before relying on an older copy.`,
  ),
});

const organizationOf = async (person: Person) => {
  const session = await sessionAs(person);
  const { id } = await api<{ id: string }>(
    session,
    'GET',
    '/organizations/current',
  );
  await session.dispose();
  return id;
};

/** Opens Upload, adds the files, sets who sees them, and uploads. */
async function upload(
  page: Page,
  files: Parameters<Page['setInputFiles']>[1],
  departments: string[] = [],
) {
  await page.goto('/knowledge/documents');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload documents' });
  await dialog.locator('input[type="file"]').setInputFiles(files);
  if (departments.length) {
    await dialog.getByRole('radio', { name: 'Only some departments' }).check();
    await dialog.getByRole('button', { name: 'Choose departments' }).click();
    for (const name of departments) {
      await page.getByRole('menuitemcheckbox', { name }).click();
    }
    await page.keyboard.press('Escape');
  }
  await dialog.getByRole('button', { name: /^Upload \d+ documents?$/ }).click();
  await expect(dialog.getByText(/^\d+ documents? uploaded$/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
}

/** The table row of a document, by its title. */
const row = (page: Page, title: string) =>
  page
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: title, exact: true }) });

test('three files, one of each type, are indexed live; Ask then cites one', async ({
  page,
}) => {
  const { maya, priya } = await tenant('km-upload');
  await signInAs(page, maya);
  await upload(page, [
    join(FIXTURES, 'remote-work-policy.pdf'),
    join(FIXTURES, 'new-starter-guide.docx'),
    join(FIXTURES, 'expenses-faq.md'),
  ]);

  // Live: the rows turn Indexed without a reload.
  for (const title of [
    'remote-work-policy.pdf',
    'new-starter-guide.docx',
    'expenses-faq.md',
  ]) {
    await expect(row(page, title).getByText('Indexed')).toBeVisible({
      timeout: 30_000,
    });
  }

  // A member asks; the answer cites one of them.
  await page.context().clearCookies();
  await signInAs(page, priya);
  await page.goto('/ask');
  await page
    .getByRole('textbox', { name: 'Your question' })
    .fill('When does the home-office allowance reset?');
  await page.getByRole('button', { name: 'Ask' }).click();
  const thread = page.getByRole('log', { name: 'Conversation' });
  await expect(
    thread.getByText(/This answer comes from the offline model, citing \[1\]/),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    thread.getByRole('link', {
      name: /^(remote-work-policy\.pdf|expenses-faq\.md)(, page \d+)?, source 1$/,
    }),
  ).toBeVisible();
});

test('a document only for Facilities answers nobody outside it', async ({
  page,
}) => {
  const { maya, priya } = await tenant('km-scoped');
  await signInAs(page, maya);
  await upload(
    page,
    [file('Parking.txt', 'Zephyrine permits cover the north car park.')],
    ['Facilities'],
  );
  await expect(row(page, 'Parking.txt').getByText('Indexed')).toBeVisible({
    timeout: 30_000,
  });
  await expect(row(page, 'Parking.txt').getByText('Facilities')).toBeVisible();

  // Maya is in Facilities: her search finds it.
  await page.goto('/knowledge');
  await page
    .getByRole('searchbox', { name: 'Search the knowledge base' })
    .fill('zephyrine');
  await expect(page.getByText('1 passage', { exact: true })).toBeVisible();

  // Priya isn't: nothing, and the offer to ask a person instead.
  await page.context().clearCookies();
  await signInAs(page, priya);
  await page.goto('/knowledge');
  await page
    .getByRole('searchbox', { name: 'Search the knowledge base' })
    .fill('zephyrine');
  await expect(
    page.getByRole('button', { name: 'Ask as a conversation' }),
  ).toBeVisible();
  await expect(page.getByText('1 passage', { exact: true })).toHaveCount(0);
});

test('a file with no readable text fails at Parsing, in words; replacing it with one that reads indexes it', async ({
  page,
}) => {
  const { maya } = await tenant('km-unreadable');
  await signInAs(page, maya);
  await upload(page, [
    {
      name: 'Blank.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(' \n \n '),
    },
  ]);
  await expect(row(page, 'Blank.txt').getByText('Failed')).toBeVisible({
    timeout: 30_000,
  });

  await row(page, 'Blank.txt').getByRole('link', { name: 'Blank.txt' }).click();
  const failed = page
    .getByRole('alert')
    .filter({ hasText: 'Processing failed' });
  await expect(failed).toContainText(
    'We couldn’t find any text in this file. Check that it isn’t empty, then replace it.',
  );
  const parsing = page.getByRole('listitem').filter({ hasText: /^Parsing/ });
  await expect(parsing).toContainText('Failed');
  // Retrying can't change this outcome, so the alert offers Replace file only,
  // and Reindex (for an indexed document) is off.
  await expect(failed.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reindex' })).toBeDisabled();
  await failed.getByRole('button', { name: 'Replace file' }).click();
  const dialog = page.getByRole('dialog', { name: 'Replace the file' });
  await dialog
    .locator('input[type="file"]')
    .setInputFiles(
      file(
        'Blank.txt',
        'The lockers on floor two are emptied every Friday evening.',
      ),
    );
  await dialog.getByRole('button', { name: 'Replace file' }).click();
  await expect(page.getByText(/^Indexed (just now|on )/)).toBeVisible({
    timeout: 30_000,
  });
  // The history keeps the failure beside the run that worked.
  await expect(page.getByRole('row').filter({ hasText: 'Failed' })).toHaveCount(
    1,
  );
  await expect(
    page.getByRole('row').filter({ hasText: 'Completed' }),
  ).toHaveCount(1);
});

test('replacing a file: the new version answers, the old words no longer do', async ({
  page,
}) => {
  const { maya } = await tenant('km-replace');
  await signInAs(page, maya);
  await upload(page, [
    file('Canteen.txt', 'The canteen opens at eight with quillberry porridge.'),
  ]);
  await expect(row(page, 'Canteen.txt').getByText('Indexed')).toBeVisible({
    timeout: 30_000,
  });
  await row(page, 'Canteen.txt')
    .getByRole('link', { name: 'Canteen.txt' })
    .click();

  await page.getByRole('button', { name: 'Replace file' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Replace the file' });
  await dialog
    .locator('input[type="file"]')
    .setInputFiles(
      file('Canteen 2.txt', 'The canteen opens at nine with marrowbloom soup.'),
    );
  await expect(dialog.getByText('What happens next')).toBeVisible();
  await dialog.getByRole('button', { name: 'Replace file' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('row').filter({ hasText: 'Completed' }),
  ).toHaveCount(2, { timeout: 30_000 });

  // What the AI reads is the new file's words, and none of the old ones.
  const reads = page.getByRole('region', { name: 'What the AI reads' });
  await expect(reads).toContainText('marrowbloom');
  await expect(reads).not.toContainText('quillberry');

  // And a search for the new words finds the passage that holds them.
  await page.goto('/knowledge');
  await page
    .getByRole('searchbox', { name: 'Search the knowledge base' })
    .fill('marrowbloom');
  await expect(
    page.getByRole('link', { name: /Canteen\.txt/ }).first(),
  ).toBeVisible();
  await expect(page.getByText(/marrowbloom soup/).first()).toBeVisible();
});

test('over the storage limit, Upload says why and links to billing', async ({
  page,
}) => {
  const { maya } = await tenant('km-full');
  const organizationId = await organizationOf(maya);
  await setStorageLimit(organizationId, 10);
  await signInAs(page, maya);
  await page.goto('/knowledge/documents');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload documents' });
  await dialog
    .locator('input[type="file"]')
    .setInputFiles(
      file('Big.txt', 'More words than ten bytes of storage hold.'),
    );
  await dialog.getByRole('button', { name: 'Upload 1 document' }).click();

  await expect(
    dialog.getByText('Storage is full', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText(
      'Your document storage is full. New uploads will be refused until space is freed or your plan is changed.',
    ),
  ).toBeVisible();
  await expect(
    dialog.getByText('Storage is full.', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Done' })).toBeVisible();
  await expect(
    dialog.getByRole('link', { name: 'See plans and billing' }),
  ).toHaveAttribute('href', '/settings/billing');
});

test('flags: one dismissed with a reason, one marked fixed', async ({
  page,
}) => {
  const { maya } = await tenant('km-flags');
  const organizationId = await organizationOf(maya);
  await signInAs(page, maya);
  await upload(page, [
    file('Security.txt', 'Passwords rotate every ninety days.'),
  ]);
  await expect(row(page, 'Security.txt').getByText('Indexed')).toBeVisible({
    timeout: 30_000,
  });
  const session = await sessionAs(maya);
  const { items } = await api<{ items: { id: string; title: string }[] }>(
    session,
    'GET',
    '/documents?limit=10',
  );
  await session.dispose();
  const documentId = items.find((item) => item.title === 'Security.txt')!.id;
  await documentFlag(organizationId, documentId, {
    flagType: 'OUTDATED',
    severity: 'WARNING',
    detail: 'Mentions the 2024 password rules.',
  });
  await documentFlag(organizationId, documentId, {
    flagType: 'UNCITED',
    severity: 'INFO',
    detail: 'Retrieved 42 times in 30 days; cited 0 times.',
  });

  await page.goto('/knowledge/flags');
  await expect(page.getByText('2 open')).toBeVisible();
  const outdated = page.getByRole('article', {
    name: 'Out of date, Security.txt',
  });
  await outdated.getByRole('button', { name: 'Dismiss' }).click();
  const dismiss = page.getByRole('dialog', { name: 'Dismiss this flag?' });
  await dismiss.getByRole('button', { name: 'Dismiss flag' }).click();
  await expect(
    dismiss.getByText('Say why you’re dismissing it.'),
  ).toBeVisible();
  await dismiss
    .getByRole('textbox', { name: 'Reason' })
    .fill('The rules are current for 2026.');
  await dismiss.getByRole('button', { name: 'Dismiss flag' }).click();
  await expect(dismiss).toBeHidden();

  const uncited = page.getByRole('article', {
    name: 'Found, never cited, Security.txt',
  });
  await uncited.getByRole('button', { name: 'Fixed' }).click();
  const fixed = page.getByRole('dialog', { name: 'Mark as fixed?' });
  await fixed.getByRole('button', { name: 'Mark as fixed' }).click();
  await expect(fixed).toBeHidden();
  await expect(page.getByText('Nothing needs attention')).toBeVisible();

  await page.getByRole('switch', { name: 'Show resolved' }).click();
  await expect(page.getByText('0 open · 2 resolved')).toBeVisible();
  await expect(
    page.getByText(
      /^Dismissed by Maya Chen on .*: “The rules are current for 2026\.”$/,
    ),
  ).toBeVisible();
  await expect(page.getByText(/^Fixed by Maya Chen on /)).toBeVisible();
});

test('a share-only manager changes departments, and can’t switch to everyone', async ({
  page,
}) => {
  const { maya, jordan } = await tenant('km-share-only');
  await signInAs(page, maya);
  await upload(
    page,
    [file('Rota.txt', 'The weekend rota is posted on Fridays.')],
    ['Workplace'],
  );
  await expect(row(page, 'Rota.txt').getByText('Indexed')).toBeVisible({
    timeout: 30_000,
  });

  // A role that may share documents and nothing more.
  const mayas = await sessionAs(maya);
  const { id: roleId } = await api<{ id: string }>(mayas, 'POST', '/roles', {
    name: 'Document sharer',
    permissionCodes: ['document.read', 'document.share', 'department.read'],
  });
  await api(mayas, 'PUT', `/users/${jordan.id}/roles`, { roleIds: [roleId] });
  await mayas.dispose();

  await page.context().clearCookies();
  await signInAs(page, jordan);
  await page.goto('/knowledge/documents');
  await page.getByRole('link', { name: 'Rota.txt' }).click();
  const sharing = page.getByRole('region', { name: 'Who can see it' });
  await expect(
    sharing.getByText(
      'Only people who can edit documents can switch between everyone and departments.',
    ),
  ).toBeVisible();
  await expect(
    sharing.getByRole('radio', { name: /^Everyone in / }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Replace file' })).toHaveCount(
    0,
  );

  await sharing.getByRole('button', { name: 'Choose departments' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Facilities' }).click();
  await page.keyboard.press('Escape');
  await sharing.getByRole('button', { name: 'Save sharing' }).click();
  await expect(page.getByText('Sharing saved.')).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByText('Workplace, Facilities')
      .or(page.getByText('Facilities, Workplace'))
      .first(),
  ).toBeVisible();
});
