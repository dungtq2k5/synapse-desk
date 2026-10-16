import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi, type Reply } from '@/test/api';
import { ArticleReader } from './article-reader';

jest.mock('@/components/shell/app-header', () => ({
  AppHeader: ({ crumbs }: { crumbs: { label: string }[] }) => (
    <nav aria-label="Breadcrumb">
      {crumbs.map((crumb) => crumb.label).join(' / ')}
    </nav>
  ),
}));

const ARTICLE = {
  id: 'd1',
  title: 'Remote Work Policy.pdf',
  updatedAt: '2026-10-02T09:00:00Z',
  chunkCount: 6,
};

/** Page `n` of three, two blocks each, a document page per reader page. */
const page = (n: number, passageIndex: number | null = null) =>
  ok({
    article: ARTICLE,
    blocks: [0, 1].map((index) => ({
      chunkIndex: (n - 1) * 2 + index,
      pageNumber: n + 2,
      contentText: `Block ${(n - 1) * 2 + index}`,
    })),
    meta: {
      currentPage: n,
      itemsPerPage: 2,
      totalItems: 6,
      totalPages: 3,
      itemCount: 2,
    },
    hasUnindexedPages: n === 2,
    passageIndex,
  });

function show(reply: (url: string) => Reply, passage?: string) {
  const calls = stubApi({
    'GET /api/v1/knowledge/articles/d1': (_, url) => reply(url),
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ArticleReader articleId="d1" passage={passage} />
    </QueryClientProvider>,
  );
  return { calls, user: userEvent.setup() };
}

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

describe('the article reader', () => {
  it('opens at the cited passage: highlighted, focused, with the pages around it to load', async () => {
    const { calls, user } = show(
      (url) =>
        url.includes('passage=c3')
          ? page(2, 1)
          : url.includes('page=1')
            ? page(1)
            : page(3),
      'c3',
    );

    const cited = await screen.findByRole('region', { name: 'Cited passage' });
    expect(cited).toHaveTextContent('Block 3');
    await waitFor(() => expect(cited).toHaveFocus());
    expect(
      screen.getByRole('heading', { name: 'Remote Work Policy.pdf' }),
    ).toBeInTheDocument();
    expect(screen.getByText('2 Oct 2026')).toBeInTheDocument();
    expect(screen.getByText('Page 4')).toBeInTheDocument();
    expect(screen.getByText('Some pages couldn’t be read')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Show earlier passages' }),
    );
    expect(await screen.findByText('Block 0')).toBeInTheDocument();
    expect(screen.getByText('2 more passages loaded')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Show earlier passages' }),
    ).toBeNull();

    await user.click(
      screen.getByRole('button', { name: 'Show later passages' }),
    );
    expect(await screen.findByText('Block 5')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Show later passages' }),
    ).toBeNull();

    // The passage asked for once; the pages around it by number.
    expect(calls.map(({ url }) => new URL(url, 'http://x').search)).toEqual([
      '?limit=20&passage=c3',
      '?page=1&limit=20',
      '?page=3&limit=20',
    ]);
    // Each document page is marked once, where it starts.
    expect(screen.getAllByText(/^Page \d$/).map((n) => n.textContent)).toEqual([
      'Page 3',
      'Page 4',
      'Page 5',
    ]);
  });

  it('says an article isn’t available, for a missing one and one out of reach alike', async () => {
    show(() => fail(404, 'Not found'));

    expect(
      await screen.findByRole('heading', {
        name: 'This article isn’t available',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Back to Knowledge' }),
    ).toHaveAttribute('href', '/knowledge');
  });

  it('offers to try again when it fails to load', async () => {
    let failing = true;
    const { user } = show(() =>
      failing ? fail(500, 'Internal server error') : page(1),
    );

    expect(
      await screen.findByRole('heading', { name: 'Couldn’t load the article' }),
    ).toBeInTheDocument();
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Block 0')).toBeInTheDocument();
  });
});
