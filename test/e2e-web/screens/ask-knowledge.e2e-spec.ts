import { expect, test, type Page, type Route } from '../coverage';
import { api } from '../support';
import { look } from './look';
import { sessionAs, signInAs, startedAs, tenant } from './tenant';

/**
 * Ask, My requests, Knowledge and the article reader, in every state, light
 * and dark, at both widths. People and tickets are the tenant's own
 * (tenant.ts). The knowledge base is not: indexing a document needs a model,
 * so the browser's knowledge calls are answered here with the examples the
 * designs draw. A state that needs a call to fail, wait or come back empty is
 * made with `page.route`, as on the other screens.
 */

const ARTICLES = '**/api/v1/knowledge/articles?*';
const ARTICLE = '**/api/v1/knowledge/articles/d1?*';
const SEARCH = '**/api/v1/knowledge/search';
const ASK = '**/api/v1/knowledge/ask';
const START = '**/api/v1/chat/conversations';
const TICKETS = '**/api/v1/tickets?*';

/** The gateway's envelope around `data`, or its error. */
const ok = (data: unknown) => ({
  json: { success: true, statusCode: 200, message: 'OK', data },
});
const failed = (status: number) => ({
  status,
  json: { success: false, statusCode: status, message: 'Failed' },
});
/** A call that never answers: the state while it's on its way. */
const hang = () => undefined;

const paged = (items: unknown[], extra: object = {}) =>
  ok({
    items,
    meta: {
      currentPage: 1,
      itemsPerPage: 8,
      totalItems: items.length,
      totalPages: 1,
      itemCount: items.length,
      ...extra,
    },
  });

const TITLES = [
  ['Remote Work Policy.pdf', '2026-10-02'],
  ['Expenses FAQ', '2026-09-28'],
  ['New Starter Guide.pdf', '2026-09-15'],
  ['Parental Leave Policy.pdf', '2026-09-09'],
  ['IT Equipment Returns', '2026-08-30'],
  ['Benefits Portal Help', '2026-08-21'],
  ['Travel and Expenses Policy.pdf', '2026-08-12'],
  ['Security Basics', '2026-08-01'],
] as const;
const articles = TITLES.map(([title, day], index) => ({
  id: index === 0 ? 'd1' : `d${index + 1}`,
  title,
  updatedAt: `${day}T09:00:00Z`,
  chunkCount: 12,
}));

const chunk = (
  chunkId: string,
  documentTitle: string,
  pageNumber: number,
  contentText: string,
) => ({
  chunkId,
  documentId: 'd1',
  documentTitle,
  pageNumber,
  chunkIndex: 1,
  contentText,
  score: 0.9,
  vectorPointId: chunkId,
});
const CHUNKS = [
  chunk(
    'c1',
    'Remote Work Policy.pdf',
    4,
    'Each employee has a home-office allowance of €450 a year. The allowance resets on 1 January; unused amounts don’t carry over to the next year.',
  ),
  chunk(
    'c2',
    'Expenses FAQ',
    2,
    'Submit receipts within 30 days of purchase. Claims above your allowance are paid from your next salary only with Finance’s approval.',
  ),
  chunk(
    'c3',
    'New Starter Guide.pdf',
    11,
    'Your equipment allowance starts on your first day and is not prorated for the first year.',
  ),
];
const answer = (status: string, extra: object = {}) =>
  ok({
    content:
      'The allowance resets on **1 January** each year, whatever your start date [1].\n\n- Unused allowance doesn’t carry over [1].\n- Claims must reach Expenses within **30 days** of buying [2].',
    status,
    citations: [
      { ...CHUNKS[0], vectorPointId: 'c1' },
      { ...CHUNKS[1], vectorPointId: 'c2' },
    ].map(({ chunkId, documentId, documentTitle, pageNumber }) => ({
      chunkId,
      documentId,
      documentTitle,
      pageNumber,
      vectorPointId: chunkId,
    })),
    generationId: 'g1',
    ...extra,
  });

/** The knowledge base the designs draw, with each call's answer as given. */
async function knowledge(
  page: Page,
  {
    list = paged(articles.slice(0, 8), { totalItems: 23, totalPages: 3 }),
    search = ok({ chunks: CHUNKS, degraded: null }),
    ask = answer('DOC_ANSWER'),
  }: {
    list?: object | typeof hang;
    search?: object | typeof hang;
    ask?: object | typeof hang;
  } = {},
): Promise<void> {
  const reply = (body: object | typeof hang) => (route: Route) =>
    typeof body === 'function' ? undefined : route.fulfill(body);
  await page.route(ARTICLES, (route) => {
    // The Ask page's card asks for three.
    if (
      typeof list !== 'function' &&
      new URL(route.request().url()).searchParams.get('limit') === '3'
    ) {
      return route.fulfill(
        'json' in list &&
          (list.json as { data: { items: unknown[] } }).data.items.length === 0
          ? list
          : paged(articles.slice(0, 3)),
      );
    }
    return reply(list)(route);
  });
  await page.route(SEARCH, reply(search));
  await page.route(ASK, reply(ask));
}

/** The page's own alert: Next.js's route announcer is an `alert` too. */
const alert = (page: Page) => page.getByRole('main').getByRole('alert');

const QUESTION =
  'Does the allowance reset in January or on my start date? I started in March and haven’t claimed anything yet.';

test.describe('Ask, as an end user', () => {
  test.beforeEach(async ({ page }) => {
    const { priya } = await tenant('ask');
    await signInAs(page, priya);
  });

  const open = async (page: Page) => {
    await page.goto('/ask');
    await expect(
      page.getByRole('heading', { name: 'Ask a question', level: 1 }),
    ).toBeVisible();
  };

  test('home: the latest requests and the newest articles', async ({
    page,
  }) => {
    await knowledge(page);
    await open(page);
    await expect(
      page.getByRole('link', { name: 'Remote Work Policy.pdf' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Your latest requests' }),
    ).toBeVisible();
    await look(page, 'ask-home');
  });

  test('typed: the title it will be saved under', async ({ page }) => {
    await knowledge(page);
    await open(page);
    await page.getByRole('textbox', { name: 'Your question' }).fill(QUESTION);
    await expect(
      page.getByText(
        'It’ll be saved as “Does the allowance reset in January or on my start date?” in My requests.',
      ),
    ).toBeVisible();
    await look(page, 'ask-typed');
  });

  test('typed, with two files attached', async ({ page }) => {
    await knowledge(page);
    let count = 0;
    await page.route('**/api/v1/tickets/attachments/upload-url', (route) =>
      route.fulfill(
        ok({
          uploadUrl: `/screens-storage/upload/${++count}`,
          uploadMethod: 'PUT',
          objectPath: `ticket-openings/screens/${count}`,
          expiresAt: '2099-01-01T00:00:00.000Z',
        }),
      ),
    );
    await page.route('**/screens-storage/upload/*', (route) =>
      route.fulfill({ status: 200 }),
    );
    await open(page);
    await page.getByRole('textbox', { name: 'Your question' }).fill(QUESTION);
    await page.locator('form input[type="file"]').setInputFiles([
      {
        name: 'receipt.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.alloc(217_088, 1),
      },
      {
        name: 'invoice.heic',
        mimeType: 'image/heic',
        buffer: Buffer.alloc(1_468_006, 1),
      },
    ]);
    const files = page.getByRole('list', { name: 'Attachments' });
    await expect(files.getByText('212 KB')).toBeVisible();
    await expect(files.getByText('1.4 MB')).toBeVisible();
    await look(page, 'ask-files');
  });

  test('too short to title', async ({ page }) => {
    await knowledge(page);
    await open(page);
    await page.getByRole('textbox', { name: 'Your question' }).fill('Hi');
    await page.getByRole('button', { name: 'Ask' }).click();
    await expect(
      page.getByText('Ask a little more so we can help.'),
    ).toBeVisible();
    await look(page, 'ask-too-short');
  });

  test('the first time', async ({ page }) => {
    await knowledge(page);
    await page.route(TICKETS, (route) => route.fulfill(paged([])));
    await open(page);
    await expect(
      page.getByRole('heading', {
        name: 'Your questions and requests will appear here',
      }),
    ).toBeVisible();
    await look(page, 'ask-first-time');
  });

  test('no documents yet', async ({ page }) => {
    await knowledge(page, { list: paged([]) });
    await page.route(TICKETS, (route) => route.fulfill(paged([])));
    await open(page);
    await expect(
      page.getByText('Answers may be limited for now'),
    ).toBeVisible();
    await look(page, 'ask-no-documents');
  });

  test('sending', async ({ page }) => {
    await knowledge(page);
    await page.route(START, hang);
    await open(page);
    await page.getByRole('textbox', { name: 'Your question' }).fill(QUESTION);
    await page.getByRole('button', { name: 'Ask' }).click();
    await expect(page.getByRole('button', { name: 'Sending…' })).toBeVisible();
    await look(page, 'ask-sending');
  });

  test('failed', async ({ page }) => {
    await knowledge(page);
    await page.route(START, (route) => route.fulfill(failed(500)));
    await open(page);
    await page.getByRole('textbox', { name: 'Your question' }).fill(QUESTION);
    await page.getByRole('button', { name: 'Ask' }).click();
    await expect(alert(page)).toContainText('Couldn’t send your question');
    await look(page, 'ask-failed');
  });

  test('too many questions', async ({ page }) => {
    await knowledge(page);
    await page.route(START, (route) =>
      route.fulfill({ ...failed(429), headers: { 'Retry-After': '300' } }),
    );
    await open(page);
    await page.getByRole('textbox', { name: 'Your question' }).fill(QUESTION);
    await page.getByRole('button', { name: 'Ask' }).click();
    await expect(alert(page)).toContainText('Try again in 5 minutes.');
    await look(page, 'ask-429');
  });

  test('the menu on a phone', async ({ page }) => {
    await knowledge(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(
      page.getByRole('dialog').getByRole('link', { name: 'My requests' }),
    ).toBeVisible();
    await look(page, 'nav-requester-sheet', {
      widths: ['phone'],
      viewportOnly: true,
    });
  });
});

test.describe('Ask, as an agent', () => {
  test('their latest questions, and their own lead', async ({ page }) => {
    const { maya } = await tenant('ask-agent');
    const mayas = await sessionAs(maya);
    await api(mayas, 'POST', '/tickets', {
      title: 'Is the standing desk allowance per year?',
      description: 'Asking for my own desk.',
    });
    await mayas.dispose();
    await signInAs(page, maya);
    await knowledge(page);
    await page.goto('/ask');
    await expect(
      page.getByRole('heading', { name: 'Your latest questions' }),
    ).toBeVisible();
    await look(page, 'ask-agent');
  });

  test('the menu on a phone', async ({ page }) => {
    const { maya } = await tenant('ask-agent');
    await signInAs(page, maya);
    await knowledge(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/ask');
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(
      page.getByRole('dialog').getByRole('link', { name: 'Tickets' }),
    ).toBeVisible();
    await look(page, 'nav-agent-sheet', {
      widths: ['phone'],
      viewportOnly: true,
    });
  });
});

test.describe('after asking', () => {
  test('the first answer is being written', async ({ page }) => {
    const { maya, priya } = await tenant('after-asking');
    const mayas = await sessionAs(maya);
    const { id } = await api<{ id: string }>(mayas, 'POST', '/tickets', {
      title: 'Does the allowance reset in January?',
      description: QUESTION,
      authorId: priya.id,
    });
    await mayas.dispose();
    await startedAs(id, 'CHAT');
    await signInAs(page, priya);
    await page.goto(`/tickets/${id}`);
    await expect(page.getByText('Writing an answer…')).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'My requests' }).first(),
    ).toBeVisible();
    await look(page, 'after-asking-answering');
  });

  test('the allowance used up: the assistant out, and the team told', async ({
    page,
  }) => {
    const { maya, priya } = await tenant('after-asking-cap');
    const mayas = await sessionAs(maya);
    const { id } = await api<{ id: string }>(mayas, 'POST', '/tickets', {
      title: 'Does the allowance reset in January?',
      description: QUESTION,
      authorId: priya.id,
    });
    await mayas.dispose();
    const priyas = await sessionAs(priya);
    // What ticket-service records when the cap escalates in place of an answer.
    await api(priyas, 'POST', `/tickets/${id}/escalate`, {
      reason: 'Escalated automatically: the workspace is at its AI budget cap',
    });
    await priyas.dispose();
    await startedAs(id, 'CHAT');
    await signInAs(page, priya);
    await page.goto(`/tickets/${id}`);
    await expect(
      page.getByText('The assistant isn’t available right now.'),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Escalated to the support team. A person will reply here.',
      ),
    ).toBeVisible();
    await look(page, 'after-asking-at-cap');
  });
});

test.describe('My requests', () => {
  test.beforeEach(async ({ page }) => {
    const { priya, tickets } = await tenant('requests');
    // Started three ways, as the design draws them.
    await startedAs(tickets.desk, 'CHAT');
    await startedAs(tickets.laptop, 'CHAT');
    await startedAs(tickets.printer, 'EMAIL');
    await signInAs(page, priya);
    await page.goto('/requests');
    await expect(
      page.getByRole('heading', { name: 'My requests', level: 1 }),
    ).toBeVisible();
  });

  /** Sorts by Status: the list's next fetch, from the browser. */
  const resort = (page: Page) =>
    page
      .getByRole('button', { name: /^Status/ })
      .first()
      .click();

  test('the list, with how each started', async ({ page }) => {
    await expect(
      page.getByRole('link', { name: /Allowance for a standing desk/ }),
    ).toBeVisible();
    await look(page, 'requests-list');
  });

  test('New request', async ({ page }) => {
    await page.getByRole('button', { name: 'New request' }).click();
    await expect(
      page.getByRole('menuitem', { name: 'Ask a question' }),
    ).toBeVisible();
    await look(page, 'requests-new-menu', {
      viewportOnly: true,
      // Radix's modal menu hides the rest of the page with aria-hidden and
      // traps focus inside the menu; axe sees the hiding but not the trap.
      disabled: ['aria-hidden-focus'],
    });
  });

  test('empty', async ({ page }) => {
    await page.route(TICKETS, (route) => route.fulfill(paged([])));
    await resort(page);
    await expect(
      page.getByRole('heading', { name: 'No requests yet' }),
    ).toBeVisible();
    await look(page, 'requests-empty');
  });

  test('no results', async ({ page }) => {
    await page.getByRole('combobox', { name: 'Search requests' }).fill('zzzz');
    await expect(
      page.getByRole('heading', { name: 'No requests match' }),
    ).toBeVisible();
    await look(page, 'requests-no-results');
  });

  test('loading', async ({ page }) => {
    await page.route(TICKETS, hang);
    await resort(page);
    await expect(page.locator('[aria-busy="true"]').first()).toBeVisible();
    await look(page, 'requests-loading');
  });

  test('error', async ({ page }) => {
    await page.route(TICKETS, (route) => route.fulfill(failed(500)));
    await resort(page);
    await expect(alert(page)).toContainText('Couldn’t load your requests');
    await look(page, 'requests-error');
  });
});

test.describe('Knowledge', () => {
  test.beforeEach(async ({ page }) => {
    const { priya } = await tenant('knowledge');
    await signInAs(page, priya);
  });

  const open = async (page: Page) => {
    await page.goto('/knowledge');
    await expect(
      page.getByRole('heading', { name: 'Knowledge', level: 1 }),
    ).toBeVisible();
  };
  const search = (page: Page, query = 'When does the allowance reset?') =>
    page
      .getByRole('searchbox', { name: 'Search the knowledge base' })
      .fill(query);
  const passages = (page: Page) =>
    expect(page.getByText('3 passages', { exact: true })).toBeVisible();

  test('before a search: the articles', async ({ page }) => {
    await knowledge(page);
    await open(page);
    await expect(page.getByText('Showing 1–8 of 23')).toBeVisible();
    await look(page, 'knowledge-articles');
  });

  test('searching', async ({ page }) => {
    await knowledge(page, { search: hang, ask: hang });
    await open(page);
    await search(page);
    await expect(
      page.getByText('Writing an answer… This takes a few seconds.'),
    ).toBeVisible();
    await look(page, 'knowledge-searching');
  });

  test('results: the answer, its sources, the passages', async ({ page }) => {
    await knowledge(page);
    await open(page);
    await search(page);
    await passages(page);
    await expect(
      page.getByRole('link', {
        name: 'Remote Work Policy.pdf, page 4, source 1',
      }),
    ).toBeVisible();
    await look(page, 'knowledge-results');
  });

  test('not in the documents', async ({ page }) => {
    await knowledge(page, {
      search: ok({ chunks: [CHUNKS[1]], degraded: null }),
      ask: answer('DOC_MISSING', { citations: [] }),
    });
    await open(page);
    await search(page, 'Can I expense a standing desk for my partner?');
    await expect(
      page.getByRole('button', { name: 'Ask as a conversation' }),
    ).toBeVisible();
    await look(page, 'knowledge-doc-missing');
  });

  test('refused', async ({ page }) => {
    await knowledge(page, { ask: answer('REFUSED', { citations: [] }) });
    await open(page);
    await search(page);
    await expect(page.getByText('I can’t answer that here.')).toBeVisible();
    await passages(page);
    await look(page, 'knowledge-refused');
  });

  test('the allowance used up: the card steps aside', async ({ page }) => {
    await knowledge(page, { ask: failed(402) });
    await open(page);
    await search(page);
    await expect(
      page.getByText(/AI answers aren’t available on your plan/),
    ).toBeVisible();
    await passages(page);
    await look(page, 'knowledge-402');
  });

  test('a limited search', async ({ page }) => {
    await knowledge(page, {
      search: ok({ chunks: CHUNKS, degraded: 'LEXICAL_ONLY' }),
    });
    await open(page);
    await search(page);
    await expect(
      page.getByText('Search was limited, so these may be less relevant.'),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'AI answer' }),
    ).not.toHaveAttribute('aria-busy', 'true');
    await look(page, 'knowledge-lexical-only');
  });

  test('no passages match', async ({ page }) => {
    await knowledge(page, {
      search: ok({ chunks: [], degraded: null }),
      ask: answer('DOC_MISSING', { citations: [] }),
    });
    await open(page);
    await search(page, 'parking permit');
    await expect(
      page.getByRole('heading', { name: 'No passages match “parking permit”' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Ask as a conversation' }),
    ).toBeVisible();
    await look(page, 'knowledge-no-results');
  });

  test('a greeting: no card', async ({ page }) => {
    await knowledge(page, {
      search: ok({ chunks: [], degraded: null }),
      ask: answer('GREETING', { citations: [] }),
    });
    await open(page);
    await search(page, 'hello');
    await expect(
      page.getByRole('heading', { name: 'No passages match “hello”' }),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'AI answer' })).toHaveCount(
      0,
    );
    await look(page, 'knowledge-greeting');
  });

  test('the search failed', async ({ page }) => {
    await knowledge(page, { search: failed(500), ask: hang });
    await open(page);
    await search(page);
    await expect(alert(page)).toContainText(
      'Couldn’t search the knowledge base',
    );
    await look(page, 'knowledge-error');
  });

  test('the answer failed alone', async ({ page }) => {
    await knowledge(page, { ask: failed(500) });
    await open(page);
    await search(page);
    await passages(page);
    await expect(alert(page)).toContainText('Couldn’t get an answer.');
    await look(page, 'knowledge-answer-failed');
  });

  test('the articles, filtered', async ({ page }) => {
    await knowledge(page);
    await page.route(ARTICLES, (route) =>
      new URL(route.request().url()).searchParams.get('searchTerm')
        ? route.fulfill(
            paged(articles.filter(({ title }) => /Polic/.test(title))),
          )
        : route.fallback(),
    );
    await open(page);
    await page.getByRole('textbox', { name: 'Filter by title' }).fill('policy');
    await expect(page.getByText('Showing 1–3 of 3')).toBeVisible();
    await look(page, 'knowledge-articles-filtered');
  });

  test('no documents yet', async ({ page }) => {
    await knowledge(page, { list: paged([]) });
    await open(page);
    await expect(page.getByText('No documents yet')).toBeVisible();
    await look(page, 'knowledge-no-documents');
  });

  test('as an agent', async ({ page }) => {
    const { maya } = await tenant('knowledge');
    await signInAs(page, maya);
    await knowledge(page);
    await open(page);
    await search(page);
    await passages(page);
    await look(page, 'knowledge-agent');
  });
});

test.describe('the article reader', () => {
  test.beforeEach(async ({ page }) => {
    const { priya } = await tenant('knowledge');
    await signInAs(page, priya);
  });

  const BLOCKS = [
    [
      3,
      'Home-office equipment covers a desk, a chair, a monitor and the cables to connect them. Items must be for your own use at home.',
    ],
    [
      4,
      'Each employee has a home-office allowance of €450 a year. The allowance resets on 1 January; unused amounts don’t carry over to the next year.',
    ],
    [
      4,
      'Claims go through Expenses with the receipt attached. See the Expenses FAQ for the deadlines and the approval steps.',
    ],
    [
      5,
      'Equipment bought with the allowance belongs to Northwind Health and is returned when you leave, as described in IT Equipment Returns.',
    ],
  ] as const;
  const detail = (extra: object = {}) =>
    ok({
      article: {
        id: 'd1',
        title: 'Remote Work Policy.pdf',
        updatedAt: '2026-10-02T09:00:00Z',
        chunkCount: 12,
      },
      blocks: BLOCKS.map(([pageNumber, contentText], index) => ({
        chunkIndex: 4 + index,
        pageNumber,
        contentText,
      })),
      meta: {
        currentPage: 2,
        itemsPerPage: 4,
        totalItems: 12,
        totalPages: 3,
        itemCount: 4,
      },
      hasUnindexedPages: false,
      passageIndex: 1,
      ...extra,
    });

  test('from a citation: the cited passage', async ({ page }) => {
    await page.route(ARTICLE, (route) => route.fulfill(detail()));
    await page.goto('/knowledge/articles/d1?passage=c1');
    await expect(
      page.getByRole('region', { name: 'Cited passage' }),
    ).toBeFocused();
    await look(page, 'reader-cited');
  });

  test('some pages couldn’t be read', async ({ page }) => {
    await page.route(ARTICLE, (route) =>
      route.fulfill(
        detail({
          hasUnindexedPages: true,
          passageIndex: null,
          meta: {
            currentPage: 1,
            itemsPerPage: 4,
            totalItems: 4,
            totalPages: 1,
            itemCount: 4,
          },
        }),
      ),
    );
    await page.goto('/knowledge/articles/d1');
    await expect(page.getByText('Some pages couldn’t be read')).toBeVisible();
    await look(page, 'reader-unreadable');
  });

  test('loading', async ({ page }) => {
    await page.route(ARTICLE, hang);
    await page.goto('/knowledge/articles/d1');
    await expect(page.getByText('Loading article')).toBeAttached();
    await look(page, 'reader-loading');
  });

  test('not found', async ({ page }) => {
    await page.route(ARTICLE, (route) => route.fulfill(failed(404)));
    await page.goto('/knowledge/articles/d1');
    await expect(
      page.getByRole('heading', { name: 'This article isn’t available' }),
    ).toBeVisible();
    await look(page, 'reader-not-found');
  });

  test('error', async ({ page }) => {
    await page.route(ARTICLE, (route) => route.fulfill(failed(500)));
    await page.goto('/knowledge/articles/d1');
    await expect(alert(page)).toContainText('Couldn’t load the article');
    await look(page, 'reader-error');
  });
});
