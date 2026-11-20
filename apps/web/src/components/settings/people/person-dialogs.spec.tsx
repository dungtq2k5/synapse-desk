import { ApiError } from '@synapsedesk/api-client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi } from '@/test/api';
import { paged, renderSettings, stubMatchMedia, viewer } from '@/test/settings';
import {
  EditDepartmentsDialog,
  EditRolesDialog,
  LockDialog,
  isLastAdmin,
  refusalText,
  serverRefusal,
} from './person-dialogs';

beforeAll(stubMatchMedia);

const SAM = { id: 'sam', fullName: 'Sam Okafor' };
const LAST_ADMIN =
  'This is the last active Org Admin. Promote another before removing this one!';
const department = (id: string, name: string) => ({
  id,
  name,
  description: null,
  memberCount: 1,
  deletedAt: null,
  deletedByName: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

describe('the refusals', () => {
  it('knows the last-admin 409, and puts other refusals in the server’s words', () => {
    expect(isLastAdmin(new ApiError(409, { error: LAST_ADMIN }))).toBe(true);
    expect(isLastAdmin(new ApiError(409, { error: 'Taken!' }))).toBe(false);
    expect(isLastAdmin(new Error(LAST_ADMIN))).toBe(false);
    expect(refusalText(new ApiError(400, { error: 'Too short!' }))).toBe(
      'Too short.',
    );
    expect(
      serverRefusal('Couldn’t', new ApiError(500, { error: 'Down!' })),
    ).toEqual({
      title: 'Couldn’t',
      description: 'Down.',
    });
  });
});

describe('Lock', () => {
  const open = (onDone = jest.fn()) => {
    renderSettings(
      <LockDialog
        person={SAM}
        open
        onOpenChange={() => undefined}
        onDone={onDone}
      />,
    );
    return onDone;
  };

  it('needs a reason, and a date that’s still to come', async () => {
    const calls = stubApi(viewer(['user.lock']));
    open();
    await userEvent.click(
      screen.getByRole('radio', { name: 'Until a date and time' }),
    );
    await userEvent.type(
      screen.getByLabelText('Date and time'),
      '2020-01-01T09:00',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Lock' }));
    expect(screen.getByText('Give a reason.')).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  it('locks until a date, with the reason', async () => {
    const calls = stubApi({
      ...viewer(['user.lock']),
      'POST /api/v1/users/sam/lock': ok({}),
    });
    const onDone = open();
    await userEvent.type(screen.getByLabelText('Reason'), 'Laptop stolen.');
    await userEvent.click(
      screen.getByRole('radio', { name: 'Until a date and time' }),
    );
    await userEvent.type(
      screen.getByLabelText('Date and time'),
      '2099-01-01T09:00',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Lock' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const body = calls.find((call) => call.method === 'POST')?.body as Record<
      string,
      string
    >;
    expect(body.reason).toBe('Laptop stolen.');
    expect(new Date(body.lockedUntil).getUTCFullYear()).toBe(2099);
  });

  it('says so when they’re the last active Org Admin', async () => {
    stubApi({
      ...viewer(['user.lock']),
      'POST /api/v1/users/sam/lock': fail(409, LAST_ADMIN),
    });
    open();
    await userEvent.type(screen.getByLabelText('Reason'), 'Leaving.');
    await userEvent.click(screen.getByRole('button', { name: 'Lock' }));
    expect(
      await screen.findByText('Sam Okafor is the last active Org Admin'),
    ).toBeInTheDocument();
  });
});

describe('Edit roles', () => {
  const roles = paged(
    [
      {
        id: 'r-admin',
        name: 'Org Admin',
        isSystemRole: true,
        permissionCodes: [],
      },
      {
        id: 'r-agent',
        name: 'Support Agent (Tier 2)',
        isSystemRole: true,
        permissionCodes: [],
      },
    ],
    2,
    100,
  );

  it('saves the roles chosen', async () => {
    const calls = stubApi({
      ...viewer(['user.role.assign', 'role.read']),
      'GET /api/v1/roles': roles,
      'PUT /api/v1/users/sam/roles': ok({}),
    });
    const onDone = jest.fn();
    renderSettings(
      <EditRolesDialog
        person={SAM}
        roleIds={['r-agent']}
        open
        onOpenChange={() => undefined}
        onDone={onDone}
      />,
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Save roles' }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
      roleIds: ['r-agent'],
    });
  });

  it('refuses taking the last Org Admin’s role, in words; another refusal in the server’s', async () => {
    stubApi({
      ...viewer(['user.role.assign', 'role.read']),
      'GET /api/v1/roles': roles,
      'PUT /api/v1/users/sam/roles': fail(409, LAST_ADMIN),
    });
    renderSettings(
      <EditRolesDialog
        person={SAM}
        roleIds={['r-admin']}
        open
        onOpenChange={() => undefined}
        onDone={() => undefined}
      />,
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Save roles' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sam Okafor is the last active Org Admin',
    );
  });
});

describe('Edit departments', () => {
  const routes = {
    ...viewer(['department.member.assign', 'department.read']),
    'GET /api/v1/departments': paged(
      [department('hr', 'HR'), department('it', 'IT support')],
      2,
      100,
    ),
  };
  const render = (
    memberships: { departmentId: string; isPrimary: boolean }[],
  ) => {
    const onDone = jest.fn();
    renderSettings(
      <EditDepartmentsDialog
        person={SAM}
        memberships={memberships}
        open
        onOpenChange={() => undefined}
        onDone={onDone}
      />,
    );
    return onDone;
  };

  it('needs one primary when there are departments', async () => {
    const calls = stubApi(routes);
    render([{ departmentId: 'hr', isPrimary: false }]);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Save departments' }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Choose one primary department.',
    );
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  });

  it('adds one, makes it the primary, removes another, and saves', async () => {
    const calls = stubApi({
      ...routes,
      'PUT /api/v1/users/sam/departments': ok({}),
    });
    const onDone = render([{ departmentId: 'hr', isPrimary: true }]);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Add a department' }),
    );
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'IT support' }),
    );
    await userEvent.click(
      screen.getByRole('radio', {
        name: 'IT support is their primary department',
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove HR' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Save departments' }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
      departments: [{ departmentId: 'it', isPrimary: true }],
    });
  });

  it('shows the server’s refusal', async () => {
    stubApi({
      ...routes,
      'PUT /api/v1/users/sam/departments': fail(400, 'Unknown department!'),
    });
    render([{ departmentId: 'hr', isPrimary: true }]);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Save departments' }),
    );
    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByText('Couldn’t save their departments'),
    ).toBeInTheDocument();
  });
});
