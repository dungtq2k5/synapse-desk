import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi } from '@/test/api';
import { paged, renderSettings, stubMatchMedia, viewer } from '@/test/settings';
import { RoleView } from './role-view';
import { DeleteRoleDialog, NewRoleDialog, RolesView } from './roles-view';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: jest.fn() }),
  usePathname: () => '/settings/roles',
}));
jest.mock('@/components/shell/app-header', () => ({ AppHeader: () => null }));

beforeAll(stubMatchMedia);
beforeEach(() => push.mockClear());

const ADMIN = [
  'role.read',
  'role.create',
  'role.update',
  'role.delete',
  'role.permission.assign',
  'user.role.assign',
  'user.read',
  'audit.read',
];
const role = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  name: 'Billing Lead',
  description: 'Finance reviews.',
  isSystemRole: false,
  userAssigned: 0,
  permissionCodes: ['user.read'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});
const holder = (id: string, fullName: string) => ({
  user: { id, fullName, email: `${id}@acme.test`, avatarUrl: null },
  roleIds: ['r1'],
  roleNames: ['Billing Lead'],
  departmentIds: [],
  deletedAt: null,
  deletedByName: null,
});
const CATALOG = ok(
  ['user.read', 'audit.read', 'audit.export', 'ticket.create'].map(
    (code, index) => ({
      id: `p${index}`,
      code,
      name: code,
      group: code.split('.')[0],
      isRetired: code === 'ticket.create',
    }),
  ),
);

const page = (
  extra: Record<string, unknown> = {},
  over: Record<string, unknown> = {},
) => {
  const calls = stubApi({
    ...viewer(ADMIN),
    'GET /api/v1/roles/r1': ok(role(over)),
    'GET /api/v1/permissions': CATALOG,
    // Who holds it, by role; anyone, by a search.
    'GET /api/v1/users': (_body: unknown, url: string) =>
      url.includes('roleId=')
        ? paged([holder('sam', 'Sam Okafor')])
        : paged([holder('sam', 'Sam Okafor'), holder('kai', 'Kai Brandt')]),
    'GET /api/v1/organizations/current': ok({ name: 'Acme' }),
    ...(extra as Record<string, never>),
  });
  renderSettings(<RoleView roleId="r1" />);
  return calls;
};

describe('a role', () => {
  it('saves its name and description, and says when the name is taken', async () => {
    const calls = page({ 'PATCH /api/v1/roles/r1': ok(role()) });
    const name = await screen.findByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Finance');
    await userEvent.clear(screen.getByLabelText('Description'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      name: 'Finance',
      description: null,
    });
  });

  it('a taken name is named; another refusal is in the server’s words', async () => {
    page({
      'PATCH /api/v1/roles/r1': fail(
        409,
        'A role with that name already exists!',
      ),
    });
    const name = await screen.findByLabelText('Name');
    await userEvent.type(name, ' 2');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('A role named Billing Lead 2 already exists.'),
    ).toBeInTheDocument();
  });

  it('saves the permissions ticked; a retired one only unticks', async () => {
    const calls = page({ 'PUT /api/v1/roles/r1/permissions': ok(role()) });
    expect(
      await screen.findByRole('checkbox', { name: /Open tickets/ }),
    ).toBeDisabled();
    expect(screen.getByText('Retired')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'View the audit log' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Save permissions' }),
    );
    expect(await screen.findByText('Permissions saved.')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
      permissionCodes: ['user.read', 'audit.read'],
    });
  });

  it('another refusal on permissions is in the server’s words', async () => {
    page({ 'PUT /api/v1/roles/r1/permissions': fail(500, 'Down!') });
    await userEvent.click(
      await screen.findByRole('checkbox', { name: 'View the audit log' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Save permissions' }),
    );
    expect(await screen.findByText('Couldn’t save them')).toBeInTheDocument();
  });

  it('takes it from someone, or says why it couldn’t', async () => {
    page({ 'DELETE /api/v1/roles/r1/users/sam': fail(500, 'Down!') });
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Take Billing Lead from Sam Okafor',
      }),
    );
    expect(
      await screen.findByText('Couldn’t take it away'),
    ).toBeInTheDocument();
  });

  it('gives it to people; a refusal is a toast', async () => {
    page({
      'POST /api/v1/roles/r1/users': fail(400, 'Unknown user!'),
    });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Add people' }),
    );
    const picker = screen.getByRole('combobox', { name: 'People' });
    await userEvent.type(picker, 'Ka');
    await userEvent.click(
      await screen.findByRole('option', { name: /Kai Brandt/ }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Give to 1 person' }),
    );
    expect(await screen.findByText('Couldn’t give it')).toBeInTheDocument();
  });

  it('deletes, then goes back to the list', async () => {
    page({ 'DELETE /api/v1/roles/r1': ok({}) });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Delete' }),
    );
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/settings/roles'));
  });

  it('a system role reads only, and offers a copy', async () => {
    page({}, { isSystemRole: true, name: 'End User', description: null });
    expect(
      await screen.findByText('System role · read-only'),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('checkbox', { name: 'View people' }),
    ).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Save permissions' }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: /Copy/ })[0]);
    expect(
      await screen.findByRole('dialog', { name: 'New role' }),
    ).toBeInTheDocument();
  });

  it('says when the role or its catalog couldn’t load', async () => {
    stubApi({ ...viewer(ADMIN), 'GET /api/v1/roles/r1': fail(500, 'Down!') });
    renderSettings(<RoleView roleId="r1" />);
    expect(
      await screen.findByText('Couldn’t load this role'),
    ).toBeInTheDocument();
  });

  it('isn’t available without role.read', async () => {
    stubApi(viewer(['user.read']));
    renderSettings(<RoleView roleId="r1" />);
    expect(
      await screen.findByText('This page isn’t available'),
    ).toBeInTheDocument();
  });
});

describe('the list, New role and Delete', () => {
  it('isn’t available without role.read', async () => {
    stubApi(viewer(['user.read']));
    renderSettings(<RolesView />);
    expect(
      await screen.findByText('This page isn’t available'),
    ).toBeInTheDocument();
  });

  it('creates a role from another’s permissions, then opens it', async () => {
    const calls = stubApi({
      ...viewer(ADMIN),
      'GET /api/v1/roles': paged(
        [
          role({
            id: 'r-agent',
            name: 'Support Agent (Tier 2)',
            isSystemRole: true,
            permissionCodes: ['ticket.create'],
          }),
        ],
        1,
        100,
      ),
      'POST /api/v1/roles': ok(role({ id: 'r-new' }), 201),
    });
    renderSettings(<NewRoleDialog open onOpenChange={() => undefined} />);
    await userEvent.type(screen.getByLabelText('Name'), 'Night shift');
    await userEvent.click(screen.getByRole('combobox', { name: 'Start from' }));
    await userEvent.click(
      await screen.findByRole('option', { name: 'Support Agent (Tier 2)' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create role' }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/settings/roles/r-new'),
    );
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      name: 'Night shift',
      description: null,
      permissionCodes: ['ticket.create'],
    });
  });

  it('New role names the escalation, and any other refusal, in words', async () => {
    stubApi({
      ...viewer(ADMIN),
      'GET /api/v1/roles': paged([]),
      'POST /api/v1/roles': fail(
        403,
        'You cannot grant permission(s) you do not hold: audit.export!',
      ),
    });
    renderSettings(<NewRoleDialog open onOpenChange={() => undefined} />);
    await userEvent.type(screen.getByLabelText('Name'), 'Auditor');
    await userEvent.click(screen.getByRole('button', { name: 'Create role' }));
    expect(
      await screen.findByText('You can’t grant permissions you don’t hold'),
    ).toBeInTheDocument();
  });

  it('New role: any other refusal', async () => {
    stubApi({
      ...viewer(ADMIN),
      'GET /api/v1/roles': paged([]),
      'POST /api/v1/roles': fail(500, 'Down!'),
    });
    renderSettings(<NewRoleDialog open onOpenChange={() => undefined} />);
    await userEvent.type(screen.getByLabelText('Name'), 'Auditor');
    await userEvent.click(screen.getByRole('button', { name: 'Create role' }));
    expect(await screen.findByText('Couldn’t create it')).toBeInTheDocument();
  });

  it.each([
    [
      3,
      ['Sam Okafor', 'Kai Brandt'],
      'Take it away from Sam Okafor, Kai Brandt and 1 other first',
    ],
    [4, ['Sam Okafor', 'Kai Brandt'], 'and 2 others'],
    [1, ['Sam Okafor'], 'Take it away from Sam Okafor first'],
    [
      2,
      ['Sam Okafor', 'Kai Brandt'],
      'Take it away from Sam Okafor and Kai Brandt first',
    ],
  ])(
    'a refused delete names who holds it (%i)',
    async (count, names, words) => {
      const calls = stubApi({
        ...viewer(ADMIN),
        'GET /api/v1/users': paged(
          names.map((name, index) => holder(`u${index}`, name)),
          count,
        ),
        'DELETE /api/v1/roles/r1': fail(
          409,
          `This role is assigned to ${count} user(s). Reassign them before deleting it!`,
        ),
      });
      renderSettings(
        <DeleteRoleDialog
          role={role({ userAssigned: count }) as never}
          open
          onOpenChange={() => undefined}
        />,
      );
      // The names come from who holds it: wait until that list has answered.
      await waitFor(() =>
        expect(calls.some((call) => call.url.includes('/api/v1/users?'))).toBe(
          true,
        ),
      );
      await act(() => Promise.resolve());
      await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
      expect(await screen.findByText(new RegExp(words))).toBeInTheDocument();
    },
  );

  it('a delete refused for another reason says so', async () => {
    stubApi({
      ...viewer(ADMIN),
      'DELETE /api/v1/roles/r1': fail(500, 'Down!'),
    });
    renderSettings(
      <DeleteRoleDialog
        role={role() as never}
        open
        onOpenChange={() => undefined}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Couldn’t delete it')).toBeInTheDocument();
  });
});
