import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi } from '@/test/api';
import { paged, renderSettings, stubMatchMedia, viewer } from '@/test/settings';
import { DepartmentView } from './departments/department-view';
import {
  DepartmentDialog,
  DepartmentsView,
} from './departments/departments-view';
import { EndpointView } from './webhooks/endpoint-view';
import { EndpointDialog, WebhooksView } from './webhooks/webhooks-view';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: jest.fn() }),
  usePathname: () => '/settings',
}));
jest.mock('@/components/shell/app-header', () => ({ AppHeader: () => null }));

beforeAll(stubMatchMedia);
beforeEach(() => push.mockClear());

const department = (over: Record<string, unknown> = {}) => ({
  id: 'hr',
  name: 'HR',
  description: 'People operations.',
  memberCount: 1,
  deletedAt: null,
  deletedByName: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});
const user = (id: string, fullName: string) => ({
  user: { id, fullName, email: `${id}@acme.test`, avatarUrl: null },
  roleIds: [],
  roleNames: [],
  departmentIds: [],
  deletedAt: null,
  deletedByName: null,
});
const ENDPOINT = {
  id: 'w1',
  url: 'https://hooks.test/x',
  description: 'Ops',
  eventTypes: ['ticket.assigned', 'not.a.type'],
  isActive: true,
  disabledReason: null,
  disabledCode: null,
  consecutiveFailures: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('departments', () => {
  const DEPT = [
    'department.read',
    'department.create',
    'department.update',
    'department.delete',
    'department.member.assign',
    'user.read',
  ];

  it('isn’t available without department.read; the list says when it couldn’t load', async () => {
    stubApi(viewer(['user.read']));
    const { unmount } = renderSettings(<DepartmentsView />);
    expect(
      await screen.findByText('This page isn’t available'),
    ).toBeInTheDocument();
    unmount();
    stubApi({ ...viewer(DEPT), 'GET /api/v1/departments': fail(500, 'Down!') });
    renderSettings(<DepartmentsView />);
    expect(
      await screen.findByText('Couldn’t load the departments'),
    ).toBeInTheDocument();
  });

  it('says when restoring failed', async () => {
    stubApi({
      ...viewer(DEPT),
      'GET /api/v1/departments': paged([
        department({ deletedAt: '2026-10-01T00:00:00Z' }),
      ]),
      'POST /api/v1/departments/hr/restore': fail(500, 'Down!'),
    });
    renderSettings(<DepartmentsView />);
    const [restore] = await screen.findAllByRole('button', {
      name: 'Restore HR',
    });
    await userEvent.click(restore);
    expect(await screen.findByText('Couldn’t restore it')).toBeInTheDocument();
  });

  it('edits a department, and says what the server refused', async () => {
    const calls = stubApi({
      ...viewer(DEPT),
      'PATCH /api/v1/departments/hr': ok(department()),
    });
    const onOpenChange = jest.fn();
    const { unmount } = renderSettings(
      <DepartmentDialog
        department={department()}
        open
        onOpenChange={onOpenChange}
      />,
    );
    const name = screen.getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'People');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      name: 'People',
      description: 'People operations.',
    });
    unmount();

    stubApi({
      ...viewer(DEPT),
      'POST /api/v1/departments': fail(400, 'Too long!'),
    });
    renderSettings(<DepartmentDialog open onOpenChange={() => undefined} />);
    await userEvent.type(screen.getByLabelText('Name'), 'Payroll');
    await userEvent.click(
      screen.getByRole('button', { name: 'Create department' }),
    );
    expect(await screen.findByText('Too long.')).toBeInTheDocument();
  });

  const page = (extra: Record<string, unknown> = {}, codes = DEPT) =>
    stubApi({
      ...viewer(codes),
      'GET /api/v1/departments/hr': ok(department()),
      'GET /api/v1/departments/hr/members': paged([]),
      'GET /api/v1/users': paged([user('sam', 'Sam Okafor')]),
      ...(extra as Record<string, never>),
    });

  it('adds people as their primary', async () => {
    const calls = page({
      'POST /api/v1/departments/hr/members': ok({
        addedCount: 1,
        updatedCount: 0,
      }),
    });
    renderSettings(<DepartmentView departmentId="hr" />);
    expect(await screen.findByText('No members yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add people' }));
    await userEvent.type(
      screen.getByRole('combobox', { name: 'People' }),
      'Sa',
    );
    await userEvent.click(
      await screen.findByRole('option', { name: /Sam Okafor/ }),
    );
    await userEvent.click(
      screen.getByLabelText('Make HR their primary department'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add 1 person' }));
    await waitFor(() =>
      expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
        userIds: ['sam'],
        isPrimary: true,
      }),
    );
  });

  it('says when adding failed', async () => {
    page({ 'POST /api/v1/departments/hr/members': fail(500, 'Down!') });
    renderSettings(<DepartmentView departmentId="hr" />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Add people' }),
    );
    await userEvent.type(
      screen.getByRole('combobox', { name: 'People' }),
      'Sa',
    );
    await userEvent.click(
      await screen.findByRole('option', { name: /Sam Okafor/ }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add 1 person' }));
    expect(await screen.findByText('Couldn’t add them')).toBeInTheDocument();
  });

  it('says when the department or its members couldn’t load, and without department.read', async () => {
    page({ 'GET /api/v1/departments/hr': fail(500, 'Down!') });
    const first = renderSettings(<DepartmentView departmentId="hr" />);
    expect(
      await screen.findByText('Couldn’t load this department'),
    ).toBeInTheDocument();
    first.unmount();
    page({ 'GET /api/v1/departments/hr/members': fail(500, 'Down!') });
    const second = renderSettings(<DepartmentView departmentId="hr" />);
    expect(
      await screen.findByText('Couldn’t load the members'),
    ).toBeInTheDocument();
    second.unmount();
    stubApi(viewer(['user.read']));
    renderSettings(<DepartmentView departmentId="hr" />);
    expect(
      await screen.findByText('This page isn’t available'),
    ).toBeInTheDocument();
  });
});

describe('webhooks', () => {
  const HOOKS = ['organization.read', 'organization.update'];

  it('isn’t available without organization.read; the list says when it couldn’t load', async () => {
    stubApi(viewer(['user.read']));
    const { unmount } = renderSettings(<WebhooksView />);
    expect(
      await screen.findByText('This page isn’t available'),
    ).toBeInTheDocument();
    unmount();
    stubApi({
      ...viewer(HOOKS),
      'GET /api/v1/webhook-endpoints': fail(500, 'Down!'),
    });
    renderSettings(<WebhooksView />);
    expect(
      await screen.findByText('Couldn’t load the endpoints'),
    ).toBeInTheDocument();
  });

  it('edits an endpoint; a URL past 2,000 characters and a server refusal are said', async () => {
    const calls = stubApi({
      ...viewer(HOOKS),
      'GET /api/v1/webhook-endpoints/event-types': ok({
        types: ['ticket.assigned'],
      }),
      'PATCH /api/v1/webhook-endpoints/w1': fail(400, 'Bad address!'),
    });
    renderSettings(
      <EndpointDialog
        endpoint={ENDPOINT as never}
        open
        onOpenChange={() => undefined}
      />,
    );
    const url = screen.getByLabelText('URL');
    await userEvent.clear(url);
    await userEvent.click(url);
    await userEvent.paste(`https://hooks.test/${'x'.repeat(2000)}`);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      screen.getByText('Use 2,000 characters or fewer.'),
    ).toBeInTheDocument();
    await userEvent.clear(url);
    await userEvent.type(url, 'https://hooks.test/y');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Bad address.')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'PATCH')?.body).toMatchObject({
      url: 'https://hooks.test/y',
      eventTypes: ['ticket.assigned'],
    });
  });

  const endpoint = (
    extra: Record<string, unknown> = {},
    over: Record<string, unknown> = {},
  ) => {
    stubApi({
      ...viewer(HOOKS),
      'GET /api/v1/webhook-endpoints/w1': ok({ ...ENDPOINT, ...over }),
      'GET /api/v1/webhook-endpoints/w1/deliveries': ok({ items: [] }),
      ...(extra as Record<string, never>),
    });
    renderSettings(<EndpointView endpointId="w1" />);
  };

  it('turns an endpoint off and on, and says when it couldn’t', async () => {
    endpoint({ 'PATCH /api/v1/webhook-endpoints/w1': ok(ENDPOINT) });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Turn off' }),
    );
    expect(await screen.findByText('Endpoint turned off.')).toBeInTheDocument();
  });

  it('says when turning it on failed, and when a test couldn’t be sent', async () => {
    endpoint(
      {
        'PATCH /api/v1/webhook-endpoints/w1': fail(500, 'Down!'),
        'POST /api/v1/webhook-endpoints/w1/test': fail(500, 'Down!'),
      },
      { isActive: false },
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Turn on' }),
    );
    expect(await screen.findByText('Couldn’t change it')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send test' }));
    expect(await screen.findByText('Couldn’t send it')).toBeInTheDocument();
  });

  it('says why a rotation or a delete was refused', async () => {
    endpoint({
      'POST /api/v1/webhook-endpoints/w1/rotate-secret': fail(500, 'Down!'),
      'DELETE /api/v1/webhook-endpoints/w1': fail(500, 'Down!'),
    });
    await userEvent.click(
      await screen.findByRole('button', { name: 'More actions' }),
    );
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Rotate secret' }),
    );
    let dialog = await screen.findByRole('alertdialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Rotate secret' }),
    );
    expect(
      await within(dialog).findByText('Couldn’t rotate it'),
    ).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    );

    await userEvent.click(
      screen.getAllByRole('button', { name: 'Delete' }).at(-1)!,
    );
    dialog = await screen.findByRole('alertdialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Delete' }),
    );
    expect(
      await within(dialog).findByText('Couldn’t delete it'),
    ).toBeInTheDocument();
  });

  it('names an unknown event as itself', async () => {
    endpoint();
    expect(await screen.findByText('not.a.type')).toBeInTheDocument();
  });

  it('says when the endpoint or its deliveries couldn’t load, and without organization.read', async () => {
    endpoint({ 'GET /api/v1/webhook-endpoints/w1': fail(500, 'Down!') });
    expect(
      await screen.findByText('Couldn’t load this endpoint'),
    ).toBeInTheDocument();
  });

  it('says when the deliveries couldn’t load', async () => {
    endpoint({
      'GET /api/v1/webhook-endpoints/w1/deliveries': fail(500, 'Down!'),
    });
    expect(
      await screen.findByText('Couldn’t load the deliveries'),
    ).toBeInTheDocument();
  });

  it('isn’t available without organization.read', async () => {
    stubApi(viewer(['user.read']));
    renderSettings(<EndpointView endpointId="w1" />);
    expect(
      await screen.findByText('This page isn’t available'),
    ).toBeInTheDocument();
  });
});
