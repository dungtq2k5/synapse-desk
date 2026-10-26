import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi } from '@/test/api';
import { paged, renderSettings, stubMatchMedia, viewer } from '@/test/settings';
import { AuditView, changes } from './audit-view';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/settings/audit-log',
}));
jest.mock('@/components/shell/app-header', () => ({ AppHeader: () => null }));

beforeAll(stubMatchMedia);
afterEach(() => localStorage.clear());

const AUDITOR = [
  'audit.read',
  'audit.export',
  'user.read',
  'department.read',
  'role.read',
];
const STORED = 'synapsedesk.audit-export';

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  organizationId: 'org',
  userId: 'sam',
  action: 'USER_LOCKED',
  resourceType: 'USER',
  resourceId: 'kai',
  ipAddress: '10.0.0.1',
  userAgent: 'Chrome',
  metadata: {
    before: { locked: false },
    after: { locked: true },
    note: { nested: 1 },
  },
  createdAt: '2026-10-18T09:00:00Z',
  // Named by the gateway, whoever they are and however long ago they left.
  actorName: 'Sam Okafor',
  resourceName: 'Kai Brandt',
  ...over,
});
const person = (id: string, fullName: string) => ({
  user: { id, fullName, email: `${id}@acme.test`, avatarUrl: null },
  roleIds: [],
  roleNames: [],
  departmentIds: [],
  deletedAt: null,
  deletedByName: null,
});

function open(extra: Record<string, unknown> = {}, codes = AUDITOR) {
  const calls = stubApi({
    ...viewer(codes),
    'GET /api/v1/audit-logs': paged([
      entry(),
      entry({
        id: 'a2',
        userId: null,
        action: null,
        resourceType: null,
        resourceId: null,
        ipAddress: null,
        userAgent: null,
        metadata: null,
        actorName: null,
        resourceName: null,
      }),
      entry({
        id: 'a3',
        userId: 'gone',
        resourceType: 'WEBHOOK_ENDPOINT',
        resourceId: 'w1',
        metadata: { url: 'https://hooks.test/x' },
        actorName: null,
        resourceName: null,
      }),
    ]),
    'GET /api/v1/audit-logs/actions': ok({
      actions: ['USER_LOCKED', 'ROLE_CREATED'],
    }),
    'GET /api/v1/users': paged([
      person('sam', 'Sam Okafor'),
      person('kai', 'Kai Brandt'),
    ]),
    'GET /api/v1/departments': paged([]),
    'GET /api/v1/roles': paged([]),
    'GET /api/v1/organizations/current': ok({ name: 'Acme' }),
    ...(extra as Record<string, never>),
  });
  renderSettings(<AuditView />);
  return calls;
}

describe('the log', () => {
  it('names who, what and the resource as the log does; Someone when it can’t, and SynapseDesk', async () => {
    open();
    expect(
      (await screen.findAllByText('Person · Kai Brandt'))[0],
    ).toBeInTheDocument();
    expect(
      screen.getAllByText('Webhook endpoint · https://hooks.test/x')[0],
    ).toBeInTheDocument();
    expect(screen.getAllByText('SynapseDesk')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Someone')[0]).toBeInTheDocument();
  });

  it('filters by person and resource type, then clears', async () => {
    const calls = open();
    await screen.findAllByText('Person · Kai Brandt');
    // Found by search, people who have left included: not a first page.
    await userEvent.click(screen.getByRole('button', { name: 'Person' }));
    await userEvent.type(
      await screen.findByRole('combobox', { name: 'Person' }),
      'Sam',
    );
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.url.startsWith('/api/v1/users?') &&
            call.url.includes('searchTerm=Sam') &&
            call.url.includes('includeDeleted=true'),
        ),
      ).toBe(true),
    );
    await userEvent.click(
      await screen.findByRole('option', { name: /Sam Okafor/ }),
    );
    await userEvent.click(
      screen.getByRole('combobox', { name: 'Resource type' }),
    );
    await userEvent.click(await screen.findByRole('option', { name: 'Role' }));
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.url.includes('userId=sam') &&
            call.url.includes('resourceType=ROLE'),
        ),
      ).toBe(true),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Clear filters' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Clear filters' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('opens an entry in a sheet, and one with nothing to show', async () => {
    open();
    const [locked] = await screen.findAllByRole('button', {
      name: 'Locked a person',
    });
    await userEvent.click(locked);
    const sheet = await screen.findByRole('dialog', {
      name: 'Locked a person',
    });
    expect(within(sheet).getByText('USER_LOCKED')).toBeInTheDocument();
    expect(within(sheet).getByText('{"nested":1}')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    const [blank] = await screen.findAllByRole('button', { name: '—' });
    await userEvent.click(blank);
    const empty = await screen.findByRole('dialog', { name: 'Entry' });
    expect(within(empty).getAllByText('—').length).toBeGreaterThan(2);
  });

  it('says when nothing matches, and when the log couldn’t load', async () => {
    open({ 'GET /api/v1/audit-logs': paged([]) });
    expect(await screen.findByText('No entries match')).toBeInTheDocument();
  });

  it('says when the log couldn’t load', async () => {
    open({ 'GET /api/v1/audit-logs': fail(500, 'Down!') });
    expect(
      await screen.findByText('Couldn’t load the audit log'),
    ).toBeInTheDocument();
  });

  it('isn’t available without audit.read', async () => {
    stubApi(viewer(['user.read']));
    renderSettings(<AuditView />);
    expect(
      await screen.findByText('This page isn’t available'),
    ).toBeInTheDocument();
  });
});

describe('export', () => {
  it('asks for the days with no filters, and remembers the export', async () => {
    const calls = open({
      'POST /api/v1/audit-logs/export': ok({ id: 'x1' }, 202),
      'GET /api/v1/audit-logs/export/x1': ok({
        id: 'x1',
        status: 'PENDING',
        kind: 'AUDIT_LOG',
        rowCount: null,
        rollupComputedAt: null,
        downloadUrl: null,
        error: null,
        createdAt: '',
        completedAt: null,
      }),
    });
    await userEvent.click(
      await screen.findByRole('button', { name: /^Export/ }),
    );
    fireEvent.change(screen.getByLabelText('From', { exact: true }), {
      target: { value: '2026-10-01' },
    });
    fireEvent.change(screen.getByLabelText('To', { exact: true }), {
      target: { value: '2026-10-18' },
    });
    await userEvent.click(
      screen.getByRole('button', { name: 'Request export' }),
    );
    expect(
      await screen.findByText('Preparing your export'),
    ).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      from: '2026-10-01',
      to: '2026-10-18',
      filters: null,
    });
    expect(JSON.parse(localStorage.getItem(STORED) ?? '{}')).toMatchObject({
      id: 'x1',
    });
  });

  it('a refused request says why in the dialog', async () => {
    open({
      'POST /api/v1/audit-logs/export': fail(
        400,
        'An export may cover at most 92 days; this range is 200!',
      ),
    });
    await userEvent.click(
      await screen.findByRole('button', { name: /^Export/ }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Request export' }),
    );
    expect(await screen.findByText(/at most 92 days/)).toBeInTheDocument();
  });

  it('a failed export offers to try again, and forgets the old one', async () => {
    localStorage.setItem(
      STORED,
      JSON.stringify({
        id: 'x2',
        from: '2026-10-01T00:00:00',
        to: '2026-10-18T00:00:00',
        filters: [],
      }),
    );
    open({
      'GET /api/v1/audit-logs/export/x2': ok({
        id: 'x2',
        status: 'FAILED',
        kind: 'AUDIT_LOG',
        rowCount: null,
        rollupComputedAt: null,
        downloadUrl: null,
        error: 'Failed',
        createdAt: '',
        completedAt: '',
      }),
    });
    expect(await screen.findByText('The export failed')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(localStorage.getItem(STORED)).toBeNull();
    expect(
      await screen.findByRole('dialog', { name: 'Export the audit log' }),
    ).toBeInTheDocument();
  });

  it('forgets an export that can’t be read any more, or a stored one that isn’t JSON', async () => {
    localStorage.setItem(STORED, '{not json');
    open();
    await screen.findAllByText('Person · Kai Brandt');
    expect(screen.queryByText(/your export/i)).not.toBeInTheDocument();
  });

  it('opens a ready export’s file', async () => {
    const opened = jest.spyOn(window, 'open').mockReturnValue(null);
    localStorage.setItem(
      STORED,
      JSON.stringify({
        id: 'x3',
        from: '2026-10-01T00:00:00',
        to: '2026-10-18T00:00:00',
        filters: ['Action: Locked a person'],
      }),
    );
    open({
      'GET /api/v1/audit-logs/export/x3': ok({
        id: 'x3',
        status: 'READY',
        kind: 'AUDIT_LOG',
        rowCount: 1,
        rollupComputedAt: null,
        downloadUrl: 'https://files.test/a.csv',
        error: null,
        createdAt: '',
        completedAt: '',
      }),
    });
    expect(
      await screen.findByText(/Locked a person · 1 entry\./),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(opened).toHaveBeenCalledWith('https://files.test/a.csv');
  });
});

describe('what changed', () => {
  it('reads values in words', () => {
    expect(changes({ after: { at: 3, gone: undefined, list: [1] } })).toEqual([
      { field: 'At', before: '—', after: '3' },
      { field: 'Gone', before: '—', after: '—' },
      { field: 'List', before: '—', after: '[1]' },
    ]);
    expect(changes({ before: 'odd', after: null, flag: false })).toEqual([
      { field: 'Flag', before: '—', after: 'No' },
    ]);
  });
});
