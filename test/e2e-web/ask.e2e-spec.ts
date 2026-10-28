import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from './coverage';
import { REPO_ROOT } from '../system/services';
import {
  knowledgeDocument,
  sessionAs,
  signInAs,
  tenant,
} from './screens/tenant';
import { api, clearThrottles } from './support';

/**
 * Asking and the knowledge base, end to end, through the real services, with
 * rag-service in its model-free mode (global-setup.ts): its answers are fixed
 * text citing their sources, so they are asserted word for word. The knowledge
 * journeys read one policy written for their tenant (`knowledgeDocument`).
 */
test.beforeEach(clearThrottles);

const thread = (page: Page) => page.getByRole('log', { name: 'Conversation' });

test('an end user asks; the answer comes, they hand over, and an agent replies in the same thread', async ({
  page,
}) => {
  const { maya, priya, departmentId } = await tenant('j-ask');
  await signInAs(page, priya);
  await page.goto('/');
  await expect(page).toHaveURL(/\/ask$/);

  await page
    .getByRole('textbox', { name: 'Your question' })
    .fill('Is a standing desk covered by the home-office allowance?');
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page).toHaveURL(/\/tickets\/[0-9a-f-]{36}$/);
  const ticketId = page.url().split('/').at(-1)!;
  await expect(
    page.getByRole('link', { name: 'My requests' }).first(),
  ).toBeVisible();
  await expect(
    thread(page).getByText(
      'Is a standing desk covered by the home-office allowance?',
    ),
  ).toBeVisible();

  // The tenant has no documents, so the first answer is a miss (rag-service
  // runs its model-free mode here), and the thread offers a person.
  await expect(
    thread(page).getByText(
      'Not what you needed? A person from the support team can take over.',
    ),
  ).toBeVisible({ timeout: 30_000 });
  await expect(thread(page).getByText('Writing an answer…')).toBeHidden();
  await thread(page).getByRole('button', { name: 'Ask a person' }).click();
  await expect(
    thread(page).getByText(
      'Escalated to the support team. A person will reply here.',
    ),
  ).toBeVisible();

  const mayas = await sessionAs(maya);
  await api(mayas, 'POST', `/tickets/${ticketId}/assign/self`, {
    departmentId,
  });
  await api(mayas, 'POST', `/tickets/${ticketId}/messages`, {
    content: 'Yes, desks are in scope. Send me the quote.',
    isInternalNote: false,
    invokeAi: false,
  });
  await mayas.dispose();
  await expect(
    thread(page).getByText('Yes, desks are in scope. Send me the quote.'),
  ).toBeVisible();

  await page.getByRole('link', { name: 'My requests' }).first().click();
  await expect(
    page.getByRole('link', {
      name: /Is a standing desk covered by the home-office allowance\?/,
    }),
  ).toBeVisible();
});

test('a member opens a ticket from New request', async ({ page }) => {
  const { priya } = await tenant('j-open-ticket');
  await signInAs(page, priya);
  await page.goto('/requests');
  await page.getByRole('button', { name: 'New request' }).click();
  await page.getByRole('menuitem', { name: 'Open a ticket' }).click();
  await expect(page).toHaveURL(/\/tickets\/new$/);

  await page.getByLabel('Title').fill('Badge doesn’t open the side door');
  await page.getByLabel('Description').fill('It beeps red since Monday.');
  await page.getByRole('button', { name: 'Create ticket' }).click();
  await expect(page).toHaveURL(/\/tickets\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole('heading', { name: 'Badge doesn’t open the side door' }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'My requests' }).first().click();
  await expect(
    page.getByRole('link', { name: /Badge doesn’t open the side door/ }),
  ).toBeVisible();
});

const SCREENSHOT = join(REPO_ROOT, 'test/fixtures/images/avatar.png');

/** The thread's first entry: the question or description, with its files. */
const opening = (page: Page, text: string) =>
  thread(page).getByRole('article').filter({ hasText: text });

test('**an end user asks with a screenshot**: the answer comes, and the file is in the thread under the question', async ({
  page,
}) => {
  const { priya } = await tenant('j-ask-file');
  await signInAs(page, priya);
  await page.goto('/ask');

  await page
    .getByRole('textbox', { name: 'Your question' })
    .fill('Why does the expenses page show this error?');
  await page.locator('form input[type="file"]').setInputFiles(SCREENSHOT);
  const files = page.getByRole('list', { name: 'Attachments' });
  await expect(files.getByText('avatar.png')).toBeVisible();
  await expect(files.getByText('Uploading…', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page).toHaveURL(/\/tickets\/[0-9a-f-]{36}$/);

  const question = opening(page, 'Why does the expenses page show this error?');
  await expect(
    question.getByRole('button', { name: /^avatar\.png/ }),
  ).toBeVisible();
  // The first answer was asked for with the file bound: it arrives (a miss,
  // with no documents in this tenant) rather than failing.
  await expect(
    thread(page).getByText(
      'Not what you needed? A person from the support team can take over.',
    ),
  ).toBeVisible({ timeout: 30_000 });
});

test('**a member opens a ticket with a file**, it is under the description, and they delete it inside the window', async ({
  page,
}) => {
  const { priya } = await tenant('j-open-file');
  await signInAs(page, priya);
  await page.goto('/tickets/new');

  await page.getByLabel('Title').fill('Dock flickers');
  await page.getByLabel('Description').fill('See the photo of the dock.');
  await page.locator('form input[type="file"]').setInputFiles(SCREENSHOT);
  await expect(
    page.getByRole('list', { name: 'Attachments' }).getByText('avatar.png'),
  ).toBeVisible();
  await expect(
    page.getByText('Wait for your files to finish uploading.'),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Create ticket' }).click();
  await expect(page).toHaveURL(/\/tickets\/[0-9a-f-]{36}$/);

  const description = opening(page, 'See the photo of the dock.');
  await expect(
    description.getByRole('button', { name: /^avatar\.png/ }),
  ).toBeVisible();

  // Their own file, inside the window: they may remove it, and the server
  // agrees (it answered 403 to this click before).
  await description.getByRole('button', { name: 'Delete avatar.png' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(
    dialog.getByText(
      'It’s removed from this ticket for everyone. This can’t be undone.',
    ),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete file' }).click();
  await expect(
    description.getByRole('button', { name: /^avatar\.png/ }),
  ).toHaveCount(0);
});

test('**an upload made for something else can’t be bound to a ticket**: its name comes back skipped', async () => {
  const { priya } = await tenant('j-open-purpose');
  const session = await sessionAs(priya);
  try {
    const file = readFileSync(SCREENSHOT);
    // A pending avatar, uploaded by the same person: same tenant, same
    // uploader, another purpose.
    const avatar = await api<{
      uploadUrl: string;
      uploadMethod: string;
      objectPath: string;
    }>(session, 'POST', '/users/me/avatar/upload-url', {
      contentType: 'image/png',
      sizeBytes: file.length,
      fileName: 'me.png',
    });
    const sent = await fetch(avatar.uploadUrl, {
      method: avatar.uploadMethod,
      headers: { 'Content-Type': 'image/png' },
      body: new Uint8Array(file),
    });
    expect(sent.ok).toBe(true);

    const created = await api<{
      id: string;
      attachments: unknown[];
      skippedAttachments: string[];
    }>(session, 'POST', '/chat/conversations', {
      title: 'A question with the wrong file',
      message: 'A question with the wrong file attached.',
      attachments: [{ objectPath: avatar.objectPath, fileName: 'me.png' }],
    });

    expect(created.skippedAttachments).toEqual(['me.png']);
    expect(created.attachments).toEqual([]);
  } finally {
    await session.dispose();
  }
});

test('an agent asks from Ask, and finds it under their latest questions', async ({
  page,
}) => {
  const { maya } = await tenant('j-ask-agent');
  await signInAs(page, maya);
  await page.goto('/');
  await expect(page).toHaveURL(/\/tickets$/);
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Ask' })
    .click();
  await page
    .getByRole('textbox', { name: 'Your question' })
    .fill('Which VPN client do we support on Linux?');
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page).toHaveURL(/\/tickets\/[0-9a-f-]{36}$/);
  // An agent's ticket hangs from the queue.
  await expect(
    page.getByRole('link', { name: 'Tickets' }).first(),
  ).toBeVisible();

  await page.goto('/ask');
  await expect(
    page.getByRole('heading', { name: 'Your latest questions' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', {
      name: /Which VPN client do we support on Linux\?/,
    }),
  ).toBeVisible();
});

test.describe('the knowledge base', () => {
  /**
   * Priya, in a tenant with one searchable policy across two pages of blocks
   * (the reader pages twenty at a time), signed in on Knowledge.
   */
  const withPolicy = async (page: Page, name: string) => {
    const { maya, priya } = await tenant(name);
    const mayas = await sessionAs(maya);
    const { id: organizationId } = await api<{ id: string }>(
      mayas,
      'GET',
      '/organizations/current',
    );
    await mayas.dispose();
    const policy = await knowledgeDocument(maya, organizationId, {
      title: 'Remote Work Policy.pdf',
      passages: Array.from({ length: 25 }, (_, index) => ({
        page: index + 1,
        text:
          index === 21
            ? 'Each employee has a home-office allowance of 450 a year. The allowance resets on 1 January.'
            : `Section ${index + 1} covers working hours, equipment and expenses.`,
      })),
    });
    await signInAs(page, priya);
    return policy;
  };

  test('an article from the list: paged, opened at a cited passage, its original asked for', async ({
    page,
  }) => {
    const policy = await withPolicy(page, 'j-article');
    await page.goto('/knowledge');
    await page
      .getByRole('region', { name: 'Articles' })
      .getByRole('link', { name: 'Remote Work Policy.pdf' })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Remote Work Policy.pdf', level: 1 }),
    ).toBeVisible();
    // Paged by blocks: the second page is a click away.
    await page.getByRole('button', { name: 'Show later passages' }).click();
    await expect(
      page.getByText('Section 25 covers working hours'),
    ).toBeVisible();

    // Opened at a passage on the second page, the way a citation opens it.
    await page.goto(
      `/knowledge/articles/${policy.id}?passage=${policy.passageIds[21]}`,
    );
    const cited = page.getByRole('region', { name: 'Cited passage' });
    await expect(cited).toBeFocused();
    await expect(cited).toContainText('The allowance resets on 1 January.');

    // The fixture stores no file, so the gateway answers 404: the reader says so.
    const asked = page.waitForResponse((response) =>
      response.url().endsWith(`/api/v1/documents/${policy.id}/download`),
    );
    await page
      .getByRole('button', { name: 'Download original' })
      .first()
      .click();
    expect((await asked).status()).toBe(404);
    await expect(
      page.getByText('Couldn’t download the original', { exact: true }),
    ).toBeVisible();
  });

  test('a search: the passages and the answer card, citing them; a miss asks it as a conversation', async ({
    page,
  }) => {
    await withPolicy(page, 'j-search');
    await page.goto('/knowledge');
    await page
      .getByRole('searchbox', { name: 'Search the knowledge base' })
      .fill('allowance');
    await expect(page.getByText('1 passage', { exact: true })).toBeVisible();

    // rag-service's model-free answer: fixed text, citing what it was given.
    const card = page.getByRole('region', { name: 'AI answer' });
    await expect(
      card.getByText('This answer comes from the offline model, citing [1].'),
    ).toBeVisible();
    await card
      .getByRole('link', { name: 'Remote Work Policy.pdf, page 22, source 1' })
      .click();
    await expect(
      page.getByRole('region', { name: 'Cited passage' }),
    ).toContainText('The allowance resets on 1 January.');

    // Nothing retrieved: the answer is a miss, which offers a conversation.
    await page.goto('/knowledge');
    await page
      .getByRole('searchbox', { name: 'Search the knowledge base' })
      .fill('parking permit');
    await page.getByRole('button', { name: 'Ask as a conversation' }).click();
    await expect(page).toHaveURL(/\/ask$/);
    await expect(
      page.getByRole('textbox', { name: 'Your question' }),
    ).toHaveValue('parking permit');
  });

  test('the allowance used up: the answer card steps aside, the passages stay', async ({
    page,
  }) => {
    await withPolicy(page, 'j-at-cap');
    await page.route('**/api/v1/knowledge/ask', (route) =>
      route.fulfill({
        status: 402,
        json: { success: false, statusCode: 402, message: 'Payment required' },
      }),
    );
    await page.goto('/knowledge');
    await page
      .getByRole('searchbox', { name: 'Search the knowledge base' })
      .fill('allowance');
    await expect(
      page.getByText(/AI answers aren’t available on your plan right now/),
    ).toBeVisible();
    await expect(page.getByText('1 passage', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'AI answer' })).toHaveCount(
      0,
    );
  });
});
