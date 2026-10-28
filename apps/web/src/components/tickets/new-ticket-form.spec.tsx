import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { sendFile } from '@/lib/upload';
import { fail, ok, stubApi } from '@/test/api';
import { NewTicketForm } from './new-ticket-form';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('@/lib/upload', () => ({ sendFile: jest.fn() }));
const upload = jest.mocked(sendFile);

const MAYA = { id: 'maya', fullName: 'Maya Chen', email: 'maya@acme.test' };
const PRIYA = { id: 'priya', fullName: 'Priya Shah', email: 'priya@acme.test' };

function show(
  codes: string[],
  create = ok({ id: 't-9', ticketNumber: 1090, skippedAttachments: [] }, 201),
) {
  const calls = stubApi({
    'GET /api/v1/users/me': ok({
      user: MAYA,
      permissionCodes: codes,
      departmentIds: [],
    }),
    'GET /api/v1/users': ok({
      items: [{ user: PRIYA, roleIds: [], roleNames: [], departmentIds: [] }],
      meta: {},
    }),
    'POST /api/v1/tickets': create,
    'POST /api/v1/tickets/attachments/upload-url': ok({
      uploadUrl: 'https://storage.test/put',
      uploadMethod: 'PUT',
      objectPath: 'organizations/o1/ticket-openings/maya/pending/a.png',
      expiresAt: '2026-10-28T10:00:00Z',
    }),
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <NewTicketForm />
    </QueryClientProvider>,
  );
  return { calls, user: userEvent.setup() };
}

const fill = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText('Title'), 'Laptop won’t charge');
  await user.type(screen.getByLabelText('Description'), 'Stuck at 3%.');
  await user.click(screen.getByRole('button', { name: 'Create ticket' }));
};
const created = (calls: ReturnType<typeof stubApi>) =>
  calls.find(
    ({ method, url }) => method === 'POST' && url === '/api/v1/tickets',
  )?.body;

afterEach(() => {
  push.mockReset();
  sessionStorage.clear();
});

describe('a new ticket', () => {
  it('as an agent, for themselves by default: no authorId is sent', async () => {
    const { calls, user } = show(['ticket.read.all', 'user.read']);
    expect(
      await screen.findByRole('button', { name: /Maya Chen \(you\)/ }),
    ).toBeInTheDocument();

    await fill(user);

    await waitFor(() => expect(push).toHaveBeenCalledWith('/tickets/t-9'));
    expect(created(calls)).toEqual({
      title: 'Laptop won’t charge',
      description: 'Stuck at 3%.',
      attachments: [],
    });
  });

  it('as an agent, for someone else: their id goes as authorId', async () => {
    const { calls, user } = show(['ticket.read.all', 'user.read']);
    await user.click(
      await screen.findByRole('button', { name: /Maya Chen \(you\)/ }),
    );
    await user.click(await screen.findByRole('option', { name: /Priya Shah/ }));

    await fill(user);

    await waitFor(() =>
      expect(created(calls)).toMatchObject({ authorId: 'priya' }),
    );
  });

  it('an end user has no Requester', async () => {
    show([]);
    expect(
      await screen.findByText(
        'Tell us what you need. We’ll reply in the ticket.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Requester')).not.toBeInTheDocument();
  });

  it('**attaches a file, holds Create ticket while it uploads**, sends its path, and leaves what didn’t attach for the ticket', async () => {
    let finish = () => undefined as void;
    upload.mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const { calls, user } = show(
      [],
      ok(
        { id: 't-9', ticketNumber: 1090, skippedAttachments: ['old.png'] },
        201,
      ),
    );
    expect(
      screen.getByRole('group', { name: 'Attachments (optional)' }),
    ).toBeInTheDocument();
    await user.upload(
      document.querySelector<HTMLInputElement>('input[type="file"]')!,
      new File(['png'], 'dock.png', { type: 'image/png' }),
    );

    expect(await screen.findByText('dock.png')).toBeInTheDocument();
    expect(
      screen.getByText('Wait for your files to finish uploading.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create ticket' }),
    ).toBeDisabled();

    finish();
    await waitFor(() =>
      expect(
        screen.queryByText('Wait for your files to finish uploading.'),
      ).not.toBeInTheDocument(),
    );
    await fill(user);

    await waitFor(() => expect(push).toHaveBeenCalledWith('/tickets/t-9'));
    expect(created(calls)).toMatchObject({
      attachments: [
        {
          objectPath: 'organizations/o1/ticket-openings/maya/pending/a.png',
          fileName: 'dock.png',
        },
      ],
    });
    expect(
      JSON.parse(sessionStorage.getItem('synapsedesk.opening-skipped')!),
    ).toEqual({ ticketId: 't-9', names: ['old.png'] });
  });

  it('says what is missing before sending anything', async () => {
    const { calls, user } = show([]);
    await user.click(
      await screen.findByRole('button', { name: 'Create ticket' }),
    );
    expect(
      screen.getByText('Enter a title of at least 3 characters.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Describe what you need.')).toBeInTheDocument();
    expect(created(calls)).toBeUndefined();
  });

  it('a 429 says how long to wait, keeping what was written', async () => {
    const { user } = show(
      [],
      fail(429, 'Too many requests', { 'Retry-After': '300' }),
    );
    await screen.findByRole('button', { name: 'Create ticket' });
    await fill(user);

    expect(
      await screen.findByText(
        'You’ve created several tickets in a short time. Try again in 5 minutes.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Laptop won’t charge');
  });
});
