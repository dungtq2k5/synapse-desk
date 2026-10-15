import { expect, test, type Page } from '@playwright/test';
import { api } from '../support';
import { look } from './look';
import { sessionAs, signInAs, tenant, type Person } from './tenant';

/**
 * The composer and the thread's own actions, in every state, light and dark,
 * at both widths. The AI's draft is played in at the network (it needs a
 * model), and so is storage for the upload states that can't be held still
 * otherwise. A row that changes its ticket has a tenant of its own, built
 * when it runs, so a message is still inside its 15 minutes.
 */

async function open(page: Page, person: Person, ticketId: string) {
  await signInAs(page, person);
  await page.goto(`/tickets/${ticketId}`);
  await expect(page.getByRole('log', { name: 'Conversation' })).toBeVisible();
}

/**
 * Radix's modal menu hides the rest of the page with aria-hidden and traps
 * focus inside the menu, so nothing hidden can be reached; axe sees the hiding
 * but not the trap.
 */
const MENU_OPEN = { disabled: ['aria-hidden-focus'] };

const envelope = (data: unknown) => ({
  status: 200,
  json: { success: true, statusCode: 200, message: 'OK', warning: null, data },
});
const failure = (status: number) => ({
  status,
  json: { success: false, statusCode: status, message: 'Request failed' },
});

const DRAFT = {
  content:
    'Hi Priya,\n\nYes: the home-office allowance covers a standing desk, up to **€500** a year [1].\n\n- Buy the desk and keep the receipt.\n- Claim it in Expenses within 30 days.',
  modelName: 'demo',
  promptTokens: 1,
  completionTokens: 1,
  generationId: '00000000-0000-4000-8000-00000000d4a1',
  citations: [
    {
      chunkId: 'c1',
      documentId: '00000000-0000-4000-8000-00000000d0c1',
      documentTitle: 'Home-office allowance policy',
      pageNumber: 2,
    },
  ],
};

async function draftWith(page: Page, reply: () => object | undefined) {
  await page.route('**/api/v1/tickets/*/ai/draft', (route) => {
    const response = reply();
    return response ? route.fulfill(response) : new Promise<void>(() => {});
  });
  await page.getByRole('button', { name: 'Draft with AI' }).click();
}

test.describe('the composer', () => {
  test('Draft with AI: the instruction', async ({ page }) => {
    const { maya, tickets } = await tenant('composer');
    await open(page, maya, tickets.desk);
    await draftWith(page, () => undefined);
    await expect(
      page.getByRole('textbox', { name: 'Instruction (optional)' }),
    ).toBeFocused();
    await look(page, 'composer-draft');
  });

  test('Draft with AI: writing, with Cancel', async ({ page }) => {
    const { maya, tickets } = await tenant('composer');
    await open(page, maya, tickets.desk);
    await draftWith(page, () => undefined);
    await page.getByRole('button', { name: 'Generate draft' }).click();
    await expect(
      page.getByText('Writing a draft… This takes a few seconds.'),
    ).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Reply to Priya' }),
    ).toHaveAttribute('aria-busy', 'true');
    await look(page, 'composer-draft-writing');
  });

  test('Draft with AI: landed, with its sources', async ({ page }) => {
    const { maya, tickets } = await tenant('composer');
    await open(page, maya, tickets.desk);
    await draftWith(page, () => envelope(DRAFT));
    await page.getByRole('button', { name: 'Generate draft' }).click();
    await expect(
      page.getByRole('textbox', { name: 'Reply to Priya' }),
    ).toHaveValue(DRAFT.content);
    await expect(
      page.getByText('Review and edit it before sending.'),
    ).toBeVisible();
    await look(page, 'composer-draft-landed');
  });

  test('Draft with AI: 402', async ({ page }) => {
    const { maya, tickets } = await tenant('composer');
    await open(page, maya, tickets.desk);
    await draftWith(page, () => failure(402));
    await page.getByRole('button', { name: 'Generate draft' }).click();
    await expect(
      page.getByRole('alert').getByText('Write your reply as usual.'),
    ).toBeVisible();
    await look(page, 'composer-draft-402');
  });

  test('Draft with AI: failed, with Try again', async ({ page }) => {
    const { maya, tickets } = await tenant('composer');
    await open(page, maya, tickets.desk);
    await draftWith(page, () => failure(500));
    await page.getByRole('button', { name: 'Generate draft' }).click();
    await expect(page.getByText('Couldn’t write a draft')).toBeVisible();
    await look(page, 'composer-draft-failed');
  });

  test('Preview: the Markdown, rendered', async ({ page }) => {
    const { maya, tickets } = await tenant('composer');
    await open(page, maya, tickets.desk);
    await page
      .getByRole('textbox', { name: 'Reply to Priya' })
      .fill(DRAFT.content);
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByRole('button', { name: 'Preview' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByText('€500', { exact: true })).toHaveJSProperty(
      'tagName',
      'STRONG',
    );
    await look(page, 'composer-preview');
  });

  /**
   * Storage, played in at a path on the page's own origin (no CORS to
   * answer): a held upload, one that lands, and a refused one.
   */
  async function storage(page: Page) {
    let count = 0;
    await page.route(
      '**/api/v1/tickets/*/messages/attachments/upload-url',
      (route) =>
        route.fulfill(
          envelope({
            uploadUrl: `/screens-storage/upload/${++count}`,
            uploadMethod: 'PUT',
            objectPath: `tickets/screens/${count}`,
            expiresAt: '2099-01-01T00:00:00.000Z',
          }),
        ),
    );
    await page.route('**/screens-storage/upload/*', (route) => {
      const which = route.request().url().split('/').pop();
      if (which === '1') return new Promise<void>(() => {});
      if (which === '3') return route.fulfill({ status: 500 });
      return route.fulfill({ status: 200 });
    });
  }

  const file = (name: string, mimeType: string, bytes = 1024) => ({
    name,
    mimeType,
    buffer: Buffer.alloc(bytes, 1),
  });

  test('attachments: every file state', async ({ page }) => {
    const { maya, tickets } = await tenant('composer');
    await storage(page);
    await open(page, maya, tickets.desk);
    await page
      .locator('form input[type="file"]')
      .setInputFiles([
        file('receipt-scan.jpg', 'image/jpeg'),
        file('desk-quote.pdf', 'application/pdf', 217_088),
        file('order.pdf', 'application/pdf'),
        file('invoice-archive.pdf', 'application/pdf', 14_900_000),
        file('setup.exe', 'application/x-msdownload'),
      ]);
    const files = page.getByRole('list', { name: 'Attachments' });
    // Settled first: then only the held upload is still uploading.
    await expect(files.getByText('212 KB')).toBeVisible();
    await expect(files.getByText('Upload failed.')).toBeVisible();
    await expect(files.getByText('Uploading… 0%')).toBeVisible();
    // Refused files take no place: the limit isn't reached.
    await expect(
      page.getByRole('button', { name: 'Attach files' }),
    ).toBeEnabled();
    await expect(
      files.getByText('is over the 10 MB limit.', { exact: false }),
    ).toBeVisible();
    await expect(
      files.getByText('This file type isn’t supported.'),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Send reply' }),
    ).toBeDisabled();
    await look(page, 'composer-files');
  });

  test('attachments: the limit of 5', async ({ page }) => {
    const { maya, tickets } = await tenant('composer');
    await storage(page);
    await open(page, maya, tickets.desk);
    await page
      .locator('form input[type="file"]')
      .setInputFiles(
        ['a', 'b', 'c', 'd', 'e'].map((name) =>
          file(`${name}.pdf`, 'application/pdf'),
        ),
      );
    await expect(
      page.getByRole('button', { name: 'Attach files' }),
    ).toBeDisabled();
    await expect(
      page.getByText('5 of 5 files. Remove one to attach another.'),
    ).toBeVisible();
    await look(page, 'composer-files-limit');
  });

  test('attachments: dragging files over the composer', async ({ page }) => {
    const { maya, tickets } = await tenant('composer');
    await open(page, maya, tickets.desk);
    const composer = page.getByRole('form', { name: 'Reply to Priya' });
    const dataTransfer = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(new File(['x'], 'quote.pdf', { type: 'application/pdf' }));
      return data;
    });
    await composer.dispatchEvent('dragover', { dataTransfer });
    await expect(page.getByText('Drop files to attach')).toBeVisible();
    await look(page, 'composer-drop');
  });
});

test.describe('the thread', () => {
  test('Markdown in an agent’s reply and note; a requester’s as typed', async ({
    page,
  }) => {
    // The laptop ticket is Jordan's: only its assignee and its author post.
    const { maya, jordan, priya, tickets } = await tenant('markdown');
    const jordans = await sessionAs(jordan);
    const priyas = await sessionAs(priya);
    const post = (session: typeof jordans, content: string, note = false) =>
      api(session, 'POST', `/tickets/${tickets.laptop}/messages`, {
        content,
        isInternalNote: note,
        invokeAi: false,
      });
    await post(priyas, 'It *really* needs a fix by **Friday**.');
    await post(
      jordans,
      'Thanks, Priya. Two things to try:\n\n1. Use the **original** charger.\n2. Hold the power button for `10 s`.\n\nThe [charging guide](https://example.com/charging) has more.',
    );
    await post(
      jordans,
      'Check the **warranty** before sending a new one.',
      true,
    );
    await priyas.dispose();
    await jordans.dispose();

    await open(page, maya, tickets.laptop);
    await expect(
      page.getByText('It *really* needs a fix by **Friday**.'),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'charging guide' }),
    ).toHaveAttribute('rel', 'noopener noreferrer');
    await look(page, 'thread-markdown');
  });

  /** A reply of Maya's, just sent: inside its 15 minutes. */
  async function freshReply(maya: Person, ticketId: string) {
    const session = await sessionAs(maya);
    await api(session, 'POST', `/tickets/${ticketId}/messages`, {
      content: 'On it: checking with Finance now.',
      isInternalNote: false,
      invokeAi: false,
    });
    await session.dispose();
  }

  test('Edit, offered within the window', async ({ page }) => {
    const { maya, tickets } = await tenant('edit');
    await freshReply(maya, tickets.desk);
    await open(page, maya, tickets.desk);
    const reply = page
      .getByRole('article')
      .filter({ hasText: 'On it: checking with Finance now.' });
    await expect(
      reply.getByRole('button', { name: 'Edit', exact: true }),
    ).toBeVisible();
    // Older messages are past their window.
    await expect(
      page
        .getByRole('log', { name: 'Conversation' })
        .getByRole('button', { name: 'Edit', exact: true }),
    ).toHaveCount(1);
    await look(page, 'thread-edit-offered');
  });

  test('editing in place: Esc cancels', async ({ page }) => {
    const { maya, tickets } = await tenant('editing');
    await freshReply(maya, tickets.desk);
    await open(page, maya, tickets.desk);
    const reply = page
      .getByRole('article')
      .filter({ hasText: 'On it: checking with Finance now.' });
    await reply.getByRole('button', { name: 'Edit', exact: true }).click();
    const box = reply.getByRole('textbox', { name: 'Message' });
    await expect(box).toBeFocused();
    await expect(reply.getByText('Esc cancels.')).toBeVisible();
    await look(page, 'thread-editing');

    await page.keyboard.press('Escape');
    await expect(box).toHaveCount(0);
    await expect(
      reply.getByRole('button', { name: 'Edit', exact: true }),
    ).toBeFocused();
  });

  test('a moderator’s message actions', async ({ page }) => {
    const { maya, tickets } = await tenant('thread-tools');
    await open(page, maya, tickets.desk);
    await page
      .getByRole('article')
      .filter({ hasText: 'Finance confirmed desks are in scope' })
      .getByRole('button', { name: 'Message actions' })
      .click();
    await expect(page.getByRole('menuitem')).toHaveText([
      'Edit note',
      'Redact message',
    ]);
    await look(page, 'thread-moderator-menu', MENU_OPEN);
  });

  test('redacting: the confirmation, then the entry stays', async ({
    page,
  }) => {
    const { maya, tickets } = await tenant('redact');
    await open(page, maya, tickets.desk);
    await page
      .getByRole('article')
      .filter({ hasText: 'Finance confirmed desks are in scope' })
      .getByRole('button', { name: 'Message actions' })
      .click();
    await page.getByRole('menuitem', { name: 'Redact message' }).click();
    const dialog = page.getByRole('alertdialog', {
      name: 'Redact this message?',
    });
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await look(page, 'thread-redact');

    await dialog.getByRole('button', { name: 'Redact message' }).click();
    await expect(
      page.getByText('Finance confirmed desks are in scope'),
    ).toHaveCount(0);
    await expect(page.getByText('This message was removed.')).toHaveCount(2);
    await look(page, 'thread-redacted');
  });

  test('a file on a message: open it, or delete it', async ({ page }) => {
    const { maya, tickets } = await tenant('thread-tools');
    await open(page, maya, tickets.desk);
    await page
      .getByRole('button', { name: 'Delete standing-desk-quote.pdf' })
      .click();
    const dialog = page.getByRole('alertdialog', {
      name: 'Delete standing-desk-quote.pdf?',
    });
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await look(page, 'thread-delete-file');
  });

  test('feedback on an AI answer: the comment and the sources question', async ({
    page,
  }) => {
    const { maya, tickets } = await tenant('thread-tools');
    await open(page, maya, tickets.desk);
    const answer = page
      .getByRole('article')
      .filter({ hasText: 'covers desks and chairs' });
    await answer.getByRole('button', { name: 'Not helpful' }).click();
    await expect(
      answer.getByRole('button', { name: 'Not helpful' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(answer.getByText('Were the sources right?')).toBeVisible();
    await look(page, 'thread-feedback');
  });

  test('feedback saved: Change or Remove', async ({ page }) => {
    const { maya, tickets } = await tenant('feedback');
    await open(page, maya, tickets.desk);
    const answer = page
      .getByRole('article')
      .filter({ hasText: 'covers desks and chairs' });
    await answer.getByRole('button', { name: 'Helpful', exact: true }).click();
    await answer.getByRole('button', { name: 'Send feedback' }).click();
    await expect(answer.getByText('Thanks for your feedback.')).toBeVisible();
    await look(page, 'thread-feedback-saved');

    await answer.getByRole('button', { name: 'Remove' }).click();
    await expect(answer.getByText('Helpful?')).toBeVisible();
  });
});
