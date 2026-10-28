import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { sendFile } from '@/lib/upload';
import { fail, ok, stubApi, type Reply } from '@/test/api';
import { AskView, handOffQuestion } from './ask-view';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('@/lib/upload', () => ({ sendFile: jest.fn() }));
const upload = jest.mocked(sendFile);

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
  start = ok({ id: 't-9', ticketNumber: 1090, skippedAttachments: [] }, 201),
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
    'POST /api/v1/tickets/attachments/upload-url': ok({
      uploadUrl: 'https://storage.test/put',
      uploadMethod: 'PUT',
      objectPath: 'organizations/o1/ticket-openings/priya/pending/a.png',
      expiresAt: '2026-10-28T10:00:00Z',
    }),
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
        attachments: [],
      },
    ]);
  });

  it('**attaches a file, holds Ask while it uploads**, sends its path, and leaves what didn’t attach for the thread', async () => {
    let finish = () => undefined as void;
    upload.mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const { calls, user } = show({
      start: ok(
        { id: 't-9', ticketNumber: 1090, skippedAttachments: ['old.png'] },
        201,
      ),
    });
    await user.type(
      screen.getByRole('textbox', { name: 'Your question' }),
      'Why does this screen crash?',
    );
    await user.upload(
      document.querySelector<HTMLInputElement>('input[type="file"]')!,
      new File(['png'], 'screen.png', { type: 'image/png' }),
    );

    // Uploading: the file's row shows, and Ask waits for it.
    expect(await screen.findByText('screen.png')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
    expect(calls.map(({ method, url }) => `${method} ${url}`)).toContain(
      'POST /api/v1/tickets/attachments/upload-url',
    );

    finish();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Ask' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/tickets/t-9'));
    expect(started(calls).at(-1)?.body).toMatchObject({
      attachments: [
        {
          objectPath: 'organizations/o1/ticket-openings/priya/pending/a.png',
          fileName: 'screen.png',
        },
      ],
    });
    // Left for the ticket page, which shows it under the question.
    expect(
      JSON.parse(sessionStorage.getItem('synapsedesk.opening-skipped')!),
    ).toEqual({ ticketId: 't-9', names: ['old.png'] });
  });

  it('refuses a file of a type it can’t take, without uploading it', async () => {
    const { calls } = show();
    // The picker filters by `accept`; a drop doesn't, so the check is ours.
    fireEvent.change(
      document.querySelector<HTMLInputElement>('input[type="file"]')!,
      {
        target: {
          files: [
            new File(['exe'], 'tool.exe', { type: 'application/x-msdownload' }),
          ],
        },
      },
    );

    expect(await screen.findByText('tool.exe')).toBeInTheDocument();
    expect(calls.map(({ url }) => url)).not.toContain(
      '/api/v1/tickets/attachments/upload-url',
    );
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
