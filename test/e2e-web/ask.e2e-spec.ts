import { expect, test, type Page } from '@playwright/test';
import { sessionAs, signInAs, tenant } from './screens/tenant';
import {
  api,
  clearThrottles,
  DEMO_PASSWORD,
  seededActors,
  signIn,
} from './support';

/**
 * Asking and the knowledge base, end to end, through the real services. The
 * stack's rag-service calls a real model, so what it answers is not asserted:
 * only that an answer, or the hand-over to a person, arrives in the thread.
 * The knowledge rows read the demo seed's documents.
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

  // The first answer: written by the model, or the team told instead.
  await expect(
    thread(page)
      .getByText(/^(AI answer|AI)$/)
      .or(thread(page).getByText(/Escalated to the support team/))
      .first(),
  ).toBeVisible({ timeout: 90_000 });
  await expect(thread(page).getByText('Writing an answer…')).toBeHidden();

  const priyas = await sessionAs(priya);
  await api(priyas, 'POST', `/tickets/${ticketId}/escalate`, {
    reason: 'Asked for a person',
  }).catch(() => undefined);
  await priyas.dispose();

  const mayas = await sessionAs(maya);
  await api(mayas, 'POST', `/tickets/${ticketId}/messages`, {
    content: 'Yes, desks are in scope. Send me the quote.',
    isInternalNote: false,
    invokeAi: false,
  }).catch(async () => {
    // Only the holder may reply: take it first.
    await api(mayas, 'POST', `/tickets/${ticketId}/assign/self`, {
      departmentId,
    });
    await api(mayas, 'POST', `/tickets/${ticketId}/messages`, {
      content: 'Yes, desks are in scope. Send me the quote.',
      isInternalNote: false,
      invokeAi: false,
    });
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
  /** The demo seed's member, whose organization has documents. */
  const asColleague = async (page: Page) => {
    const { colleague } = await seededActors();
    await signIn(page, colleague.email, DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/ask$/);
  };

  test('an article from the list: paged, opened at a cited passage, its original downloaded', async ({
    page,
  }) => {
    await asColleague(page);
    await page.goto('/knowledge');
    const first = page
      .getByRole('region', { name: 'Articles' })
      .getByRole('link')
      .first();
    await expect(first).toBeVisible();
    const title = (await first.textContent())!;

    // Paged: the next page lists other articles, when there is one.
    const next = page.getByRole('button', { name: 'Next' });
    if (await next.isEnabled()) {
      await next.click();
      await expect(page.getByText(/^Showing 9–/)).toBeVisible();
      await page.getByRole('button', { name: 'Previous' }).click();
    }

    await page.getByRole('link', { name: title }).first().click();
    await expect(
      page.getByRole('heading', { name: title, level: 1 }),
    ).toBeVisible();
    const href = page.url();

    // A passage of it, found the way a citation names one.
    const firstBlock = await page
      .getByRole('article')
      .locator('p.text-base')
      .first()
      .textContent();
    const word = firstBlock!.split(/\s+/).find((w) => /^\w{6,}$/.test(w))!;
    const found = await page.request.post('/api/v1/knowledge/search', {
      data: { query: word },
    });
    const { chunks } = (
      (await found.json()) as {
        data: { chunks: { chunkId: string; documentId: string }[] };
      }
    ).data;
    const documentId = href.split('/').at(-1)!.split('?')[0];
    const passage = chunks.find((chunk) => chunk.documentId === documentId);
    if (passage) {
      await page.goto(
        `/knowledge/articles/${documentId}?passage=${passage.chunkId}`,
      );
      await expect(
        page.getByRole('region', { name: 'Cited passage' }),
      ).toBeFocused();
    }

    // The demo seed writes documents' rows, not their files, so the gateway
    // answers this one's download with a 404: the reader says so.
    const asked = page.waitForResponse((response) =>
      response.url().endsWith(`/api/v1/documents/${documentId}/download`),
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

  test('a search: the passages and the answer card; a miss asks it as a conversation', async ({
    page,
  }) => {
    await asColleague(page);
    await page.goto('/knowledge');
    await page
      .getByRole('searchbox', { name: 'Search the knowledge base' })
      .fill('policy');
    // Whatever the model says, the passages and the card settle.
    await expect(
      page
        .getByText(/^\d+ passages?$/)
        .or(page.getByRole('heading', { name: /^No passages match/ })),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole('main').getByText('Couldn’t search the knowledge base'),
    ).toHaveCount(0);

    // A miss, played in at the network: the model decides when it misses.
    await page.route('**/api/v1/knowledge/ask', (route) =>
      route.fulfill({
        json: {
          success: true,
          statusCode: 200,
          message: 'OK',
          data: {
            content: 'Not in the documents.',
            status: 'DOC_MISSING',
            citations: [],
            generationId: 'g1',
          },
        },
      }),
    );
    await page
      .getByRole('searchbox', { name: 'Search the knowledge base' })
      .fill('parking permit for visitors');
    await page.getByRole('button', { name: 'Ask as a conversation' }).click();
    await expect(page).toHaveURL(/\/ask$/);
    await expect(
      page.getByRole('textbox', { name: 'Your question' }),
    ).toHaveValue('parking permit for visitors');
  });

  test('the allowance used up: the answer card steps aside, the passages stay', async ({
    page,
  }) => {
    await asColleague(page);
    await page.route('**/api/v1/knowledge/ask', (route) =>
      route.fulfill({
        status: 402,
        json: { success: false, statusCode: 402, message: 'Payment required' },
      }),
    );
    await page.goto('/knowledge');
    await page
      .getByRole('searchbox', { name: 'Search the knowledge base' })
      .fill('policy');
    await expect(
      page.getByText(/AI answers aren’t available on your plan right now/),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'AI answer' })).toHaveCount(
      0,
    );
  });
});
