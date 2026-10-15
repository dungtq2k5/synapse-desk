import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ok, stubApi } from '@/test/api';
import { ExportButton } from './export-dialog';

const STORED = 'synapsedesk.ticket-export';

function show(routes: Parameters<typeof stubApi>[0]) {
  const calls = stubApi({
    'GET /api/v1/users/me': ok({
      user: { id: 'u-1', fullName: 'Maya Chen', email: 'm@acme.test' },
      permissionCodes: ['ticket.export'],
      departmentIds: [],
    }),
    ...routes,
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ExportButton />
    </QueryClientProvider>,
  );
  return { calls, user: userEvent.setup() };
}

const job = (status: string) =>
  ok({
    id: 'x-1',
    status,
    kind: 'TICKETS',
    rowCount: null,
    rollupComputedAt: null,
    downloadUrl: status === 'READY' ? 'https://files.test/x.csv' : null,
    error: null,
    createdAt: '2026-10-14T00:00:00.000Z',
    completedAt: null,
  });

afterEach(() => localStorage.clear());

describe('the export', () => {
  it('refuses a start after the end, before asking the server', async () => {
    const { calls, user } = show({});
    await user.click(screen.getByRole('button', { name: 'Export' }));
    const from = screen.getByLabelText('From');
    await user.clear(from);
    await user.type(from, '2026-10-20');
    const to = screen.getByLabelText('To');
    await user.clear(to);
    await user.type(to, '2026-10-01');
    await user.click(screen.getByRole('button', { name: 'Start export' }));

    expect(
      screen.getByText('Choose a start date on or before the end date.'),
    ).toBeInTheDocument();
    expect(calls.some(({ method }) => method === 'POST')).toBe(false);
  });

  it('resumes the stored export when the dialog reopens after a reload', async () => {
    localStorage.setItem(
      STORED,
      JSON.stringify({
        id: 'x-1',
        from: '2026-10-01',
        to: '2026-10-14',
        departmentId: null,
      }),
    );
    const { user } = show({ 'GET /api/v1/tickets/export/x-1': job('READY') });

    await user.click(screen.getByRole('button', { name: 'Export' }));

    expect(await screen.findByText('Your export is ready')).toBeInTheDocument();
    expect(
      screen.getByText('Oct 1, 2026 – Oct 14, 2026 · All departments'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeVisible();
  });

  it('starts fresh when the stored export is gone', async () => {
    localStorage.setItem(
      STORED,
      JSON.stringify({
        id: 'x-1',
        from: '2026-10-01',
        to: '2026-10-14',
        departmentId: null,
      }),
    );
    const { user } = show({
      'GET /api/v1/tickets/export/x-1': {
        status: 404,
        body: { message: 'Gone' },
      },
    });

    await user.click(screen.getByRole('button', { name: 'Export' }));

    expect(
      await screen.findByRole('button', { name: 'Start export' }),
    ).toBeVisible();
    await waitFor(() => expect(localStorage.getItem(STORED)).toBeNull());
  });

  it('works without storage: it starts fresh', async () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { user } = show({});

    await user.click(screen.getByRole('button', { name: 'Export' }));

    expect(screen.getByRole('button', { name: 'Start export' })).toBeVisible();
    jest.restoreAllMocks();
  });
});
