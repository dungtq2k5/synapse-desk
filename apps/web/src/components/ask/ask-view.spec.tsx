import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi, type Reply } from '@/test/api';
import { AskView, handOffQuestion } from './ask-view';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const PRIYA = { id: 'priya', fullName: 'Priya Shah', email: 'priya@acme.test' };
const UPDATED = new Date(Date.now() - 5 * 60_000).toISOString();

const paged = (items: unknown[]) =>
  ok({
    items,
    meta: {
      currentPage: 1,
      itemsPerPage: 3,
      totalItems: items.length,
      totalPages: 1,
      itemCount: items.length,
    },
  });

const REQUEST = {
  id: 't-1',
  ticketNumber: 1051,
  title: 'Does the allowance reset in January?',
  status: 'OPEN',
  source: 'CHAT',
  unreadCount: 1,
  updatedAt: UPDATED,
};
const ARTICLE = {
  id: 'd1',
  title: 'Remote Work Policy.pdf',
  updatedAt: '2026-10-02T09:00:00Z',
  chunkCount: 12,
};

function show({
  codes = [],
  requests = [REQUEST],
  articles = [ARTICLE],
  start = ok({ id: 't-9', ticketNumber: 1090 }, 201),
}: {
  codes?: string[];
  requests?: unknown[];
  articles?: unknown[];
  start?: Reply;
} = {}) {
  const calls = stubApi({
    'GET /api/v1/users/me': ok({
      user: PRIYA,
      permissionCodes: codes,
      departmentIds: [],
    }),
    'GET /api/v1/organizations/current': ok({ id: 'o1', name: 'Northwind' }),
    'GET /api/v1/tickets': paged(requests),
    'GET /api/v1/knowledge/articles': paged(articles),
    'POST /api/v1/chat/conversations': start,
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AskView />
    </QueryClientProvider>,
  );
  return { calls, user: userEvent.setup() };
}

const started = (calls: ReturnType<typeof stubApi>) =>
  calls.filter(({ method }) => method === 'POST');

afterEach(() => {
  push.mockReset();
  sessionStorage.clear();
});

describe('Ask', () => {
  it('shows the title it will save, sends it with the question, and opens the conversation', async () => {
    const { calls, user } = show();
    const box = screen.getByRole('textbox', { name: 'Your question' });
    await user.type(box, 'When does the allowance reset? I started in March.');

    expect(
      screen.getByText(
        'It’ll be saved as “When does the allowance reset?” in My requests.',
      ),
    ).toBeInTheDocument();
    expect(box).toHaveAccessibleDescription(
      'It’ll be saved as “When does the allowance reset?” in My requests.',
    );

    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(push).toHaveBeenCalledWith('/tickets/t-9'));
    expect(started(calls).map(({ body }) => body)).toEqual([
      {
        title: 'When does the allowance reset?',
        message: 'When does the allowance reset? I started in March.',
      },
    ]);
  });

  it('refuses a question too short to title, and sends nothing', async () => {
    const { calls, user } = show();
    const box = screen.getByRole('textbox', { name: 'Your question' });
    await user.type(box, 'Hi');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(
      screen.getByText('Ask a little more so we can help.'),
    ).toBeInTheDocument();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveFocus();
    expect(started(calls)).toEqual([]);
  });

  it('says how long to wait after too many questions, and keeps the question', async () => {
    const { user } = show({
      start: fail(429, 'Too many', { 'Retry-After': '120' }),
    });
    const box = screen.getByRole('textbox', { name: 'Your question' });
    await user.type(box, 'Where is the expenses form?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many questionsYou’ve asked several questions in a short time. Try again in 2 minutes.',
    );
    expect(box).toHaveValue('Where is the expenses form?');
    expect(push).not.toHaveBeenCalled();
  });

  it('says a failure is ours', async () => {
    const { user } = show({ start: fail(500, 'Internal server error') });
    await user.type(
      screen.getByRole('textbox', { name: 'Your question' }),
      'Where is the expenses form?',
    );
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t send your question',
    );
  });

  it('lists the latest requests and the newest articles', async () => {
    show();

    expect(
      await screen.findByRole('link', {
        name: 'Does the allowance reset in January?, 1 unread message',
      }),
    ).toHaveAttribute('href', '/tickets/t-1');
    expect(screen.getByRole('link', { name: 'All requests' })).toHaveAttribute(
      'href',
      '/requests',
    );
    expect(
      await screen.findByRole('link', { name: 'Remote Work Policy.pdf' }),
    ).toHaveAttribute('href', '/knowledge/articles/d1');
    expect(screen.getByText('2 Oct 2026')).toBeInTheDocument();
  });

  it('the first time, and with no documents yet', async () => {
    show({ requests: [], articles: [] });

    expect(
      await screen.findByText('Answers may be limited for now'),
    ).toBeInTheDocument();
    expect(screen.getByText('No articles yet.')).toBeInTheDocument();
    // With nothing to browse, nothing says "Browse articles".
    expect(screen.queryByRole('link', { name: 'Browse articles' })).toBeNull();
  });

  it('greets a first-time asker', async () => {
    show({ requests: [] });

    expect(
      await screen.findByRole('heading', {
        name: 'Your questions and requests will appear here',
      }),
    ).toBeInTheDocument();
  });

  it('for an agent: their latest questions, and their own lead', async () => {
    show({ codes: ['ticket.read.all'] });

    expect(
      await screen.findByRole('heading', { name: 'Your latest questions' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'All requests' })).toBeNull();
    expect(
      screen.getByText(
        'Answers come from Northwind’s documents. Your question becomes a ticket in Tickets, with you as the requester.',
      ),
    ).toBeInTheDocument();
  });

  it('opens with a question handed over from Knowledge', () => {
    handOffQuestion('Can I expense a standing desk?');
    show();

    expect(screen.getByRole('textbox', { name: 'Your question' })).toHaveValue(
      'Can I expense a standing desk?',
    );
  });
});
