import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi, type Reply } from '@/test/api';
import { KnowledgeView } from './knowledge-view';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const paged = (items: unknown[], meta: object = {}) =>
  ok({
    items,
    meta: {
      currentPage: 1,
      itemsPerPage: 8,
      totalItems: items.length,
      totalPages: 1,
      itemCount: items.length,
      ...meta,
    },
  });

const ARTICLE = {
  id: 'd1',
  title: 'Remote Work Policy.pdf',
  updatedAt: '2026-10-02T09:00:00Z',
  chunkCount: 12,
};
const CHUNK = {
  chunkId: 'c1',
  documentId: 'd1',
  documentTitle: 'Remote Work Policy.pdf',
  pageNumber: 4,
  chunkIndex: 7,
  contentText: 'The allowance resets on 1 January.',
  score: 0.9,
  vectorPointId: 'v1',
};
const ANSWER = {
  content: 'It resets on **1 January** [1].',
  status: 'DOC_ANSWER',
  citations: [
    {
      chunkId: 'c1',
      documentId: 'd1',
      documentTitle: 'Remote Work Policy.pdf',
      pageNumber: 4,
      vectorPointId: 'v1',
    },
  ],
  generationId: 'g1',
};

function show({
  articles = paged([ARTICLE]),
  search = ok({ chunks: [CHUNK], degraded: null }),
  ask = ok(ANSWER),
}: { articles?: Reply; search?: Reply; ask?: Reply } = {}) {
  const calls = stubApi({
    'GET /api/v1/organizations/current': ok({ id: 'o1', name: 'Northwind' }),
    'GET /api/v1/knowledge/articles': articles,
    'POST /api/v1/knowledge/search': search,
    'POST /api/v1/knowledge/ask': ask,
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <KnowledgeView />
    </QueryClientProvider>,
  );
  return { calls, user: userEvent.setup() };
}

const search = async (
  user: ReturnType<typeof userEvent.setup>,
  query = 'When does the allowance reset?',
) =>
  user.type(
    screen.getByRole('searchbox', { name: 'Search the knowledge base' }),
    query,
  );

const posts = (calls: ReturnType<typeof stubApi>, path: string) =>
  calls.filter(({ method, url }) => method === 'POST' && url.endsWith(path));

afterEach(() => {
  push.mockReset();
  sessionStorage.clear();
});

describe('Knowledge', () => {
  it('lists the articles before a search', async () => {
    show();

    expect(
      await screen.findByRole('link', { name: 'Remote Work Policy.pdf' }),
    ).toHaveAttribute('href', '/knowledge/articles/d1');
    expect(screen.getByText('Showing 1–1 of 1')).toBeInTheDocument();
  });

  it('searches once typing pauses: the answer on top, the passages with the query’s words marked', async () => {
    const { calls, user } = show();
    await search(user);

    const answer = await screen.findByRole('region', { name: 'AI answer' });
    expect(
      await within(answer).findByText('From 1 source in Northwind’s documents'),
    ).toBeInTheDocument();
    expect(
      within(answer).getByRole('link', {
        name: 'Remote Work Policy.pdf, page 4, source 1',
      }),
    ).toHaveAttribute('href', '/knowledge/articles/d1?passage=c1');

    const passages = screen.getByRole('region', { name: 'Passages' });
    expect(within(passages).getByText('1 passage')).toBeInTheDocument();
    expect(
      within(passages).getByRole('link', { name: 'Remote Work Policy.pdf' }),
    ).toHaveAttribute('href', '/knowledge/articles/d1?passage=c1');
    // "reset" marks "resets"; "the" and "when" aren't marked.
    expect(
      [...passages.querySelectorAll('mark')].map((mark) => mark.textContent),
    ).toEqual(['allowance', 'resets']);

    // One search and one answer for the whole query, not one per keystroke.
    expect(posts(calls, '/knowledge/search')).toHaveLength(1);
    expect(posts(calls, '/knowledge/ask')).toHaveLength(1);
    expect(posts(calls, '/knowledge/search')[0].body).toEqual({
      query: 'When does the allowance reset?',
    });
  });

  it('a miss offers to ask it as a conversation, with the same question', async () => {
    const { user } = show({
      ask: ok({ ...ANSWER, status: 'DOC_MISSING', citations: [] }),
    });
    await search(user, 'Can I expense a desk for my partner?');

    expect(
      await screen.findByText('I couldn’t find this in Northwind’s documents.'),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Ask as a conversation' }),
    );
    expect(push).toHaveBeenCalledWith('/ask');
    expect(sessionStorage.getItem('synapsedesk.ask')).toBe(
      'Can I expense a desk for my partner?',
    );
  });

  it('a greeting gets no card', async () => {
    const { user } = show({
      ask: ok({ ...ANSWER, status: 'GREETING', citations: [] }),
      search: ok({ chunks: [], degraded: null }),
    });
    await search(user, 'hello');

    expect(
      await screen.findByRole('heading', { name: 'No passages match “hello”' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'AI answer' })).toBeNull(),
    );
  });

  it('without the allowance, the card steps aside and the passages stay', async () => {
    const { user } = show({ ask: fail(402, 'Payment required') });
    await search(user);

    expect(
      await screen.findByText(/AI answers aren’t available on your plan/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'AI answer' })).toBeNull();
    expect(screen.getByText('1 passage')).toBeInTheDocument();
  });

  it('notes a limited search', async () => {
    const { user } = show({
      search: ok({ chunks: [CHUNK], degraded: 'LEXICAL_ONLY' }),
    });
    await search(user);

    expect(
      await screen.findByText(
        'Search was limited, so these may be less relevant.',
      ),
    ).toBeInTheDocument();
  });

  it('says a failed search is ours, apart from the answer', async () => {
    const { user } = show({ search: fail(500, 'Internal server error') });
    await search(user);

    expect(
      await screen.findByText('Couldn’t search the knowledge base'),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('region', { name: 'AI answer' }),
    ).toBeInTheDocument();
  });

  it('with no documents yet, says so', async () => {
    show({ articles: paged([]) });

    expect(await screen.findByText('No documents yet')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Ask a question' }),
    ).toHaveAttribute('href', '/ask');
  });

  it('Esc clears the search, and the articles come back', async () => {
    const { user } = show();
    await search(user);
    await screen.findByText('1 passage');

    await user.keyboard('{Escape}');
    expect(
      await screen.findByRole('heading', { name: 'Articles' }),
    ).toBeInTheDocument();
  });
});
