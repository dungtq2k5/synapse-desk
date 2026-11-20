import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi } from '@/test/api';
import { paged, renderSettings, stubMatchMedia, viewer } from '@/test/settings';
import { InvitationsView } from './invitations-view';
import { InviteButton } from './invite-dialog';
import { MembersView } from './members-view';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
  }),
  usePathname: () => '/settings/people',
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('@/components/shell/app-header', () => ({ AppHeader: () => null }));

beforeAll(stubMatchMedia);

const ADMIN = [
  'user.read',
  'user.invite',
  'user.update',
  'user.lock',
  'user.delete',
  'user.2fa.reset',
  'user.session.read',
  'user.session.revoke',
  'user.role.assign',
  'department.read',
  'role.read',
  'organization.read',
  'organization.update',
];
const LAST_ADMIN =
  'This is the last active Org Admin. Promote another before removing this one!';

const member = (
  id: string,
  fullName: string,
  user: Record<string, unknown> = {},
) => ({
  user: {
    id,
    organizationId: 'org',
    fullName,
    avatarUrl: null,
    email: `${id}@acme.test`,
    isEmailVerified: true,
    phoneNumber: null,
    isPhoneVerified: false,
    dob: null,
    gender: 'UNSPECIFIED',
    lastLoginAt: null,
    isLocked: false,
    lockedUntil: null,
    isTwoFactorEnabled: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...user,
  },
  roleIds: ['r-end'],
  roleNames: ['End User'],
  departmentIds: [],
  deletedAt: null,
  deletedByName: null,
});
const ROLES = paged(
  [
    {
      id: 'r-end',
      name: 'End User',
      isSystemRole: true,
      permissionCodes: [],
      userAssigned: 1,
    },
  ],
  1,
  100,
);
const DEPARTMENTS = paged(
  [
    {
      id: 'hr',
      name: 'HR',
      description: null,
      memberCount: 0,
      deletedAt: null,
      deletedByName: null,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'it',
      name: 'IT support',
      description: null,
      memberCount: 0,
      deletedAt: null,
      deletedByName: null,
      createdAt: '',
      updatedAt: '',
    },
  ],
  2,
  100,
);
const USAGE = ok({
  seats: { available: true, used: 18, limit: 20, unavailableReason: null },
});

describe('members: row actions', () => {
  const routes = (extra: Record<string, unknown>) => ({
    ...viewer(ADMIN),
    'GET /api/v1/users': paged([
      member('sam', 'Sam Okafor'),
      member('dana', 'Dana Novak', { isLocked: true }),
    ]),
    'GET /api/v1/users/invitations': paged([]),
    'GET /api/v1/roles': ROLES,
    'GET /api/v1/departments': DEPARTMENTS,
    ...(extra as Record<string, never>),
  });
  const act = async (name: string, item: string) => {
    const [button] = await screen.findAllByRole('button', {
      name: `Actions for ${name}`,
    });
    await userEvent.click(button);
    await userEvent.click(await screen.findByRole('menuitem', { name: item }));
  };
  const confirmIn = async (label: string) => {
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: label }));
    return dialog;
  };

  it('unlocks, and says when it couldn’t', async () => {
    stubApi(routes({ 'POST /api/v1/users/dana/unlock': ok({}) }));
    renderSettings(<MembersView />);
    await act('Dana Novak', 'Unlock');
    expect(
      await screen.findByText('Dana Novak unlocked. They can sign in again.'),
    ).toBeInTheDocument();
  });

  it('says when unlocking failed', async () => {
    stubApi(routes({ 'POST /api/v1/users/dana/unlock': fail(500, 'Down!') }));
    renderSettings(<MembersView />);
    await act('Dana Novak', 'Unlock');
    expect(await screen.findByText('Couldn’t unlock them')).toBeInTheDocument();
  });

  it('resets two-step; a refusal stays in the dialog', async () => {
    const calls = stubApi(
      routes({ 'POST /api/v1/users/sam/2fa/reset': fail(500, 'Down!') }),
    );
    renderSettings(<MembersView />);
    await act('Sam Okafor', 'Reset two-step');
    const dialog = await confirmIn('Reset two-step');
    expect(
      await within(dialog).findByText('Couldn’t reset it'),
    ).toBeInTheDocument();
    expect(
      calls.some((call) => call.url.endsWith('/users/sam/2fa/reset')),
    ).toBe(true);
  });

  it('signs them out everywhere, saying how many sessions ended', async () => {
    stubApi(
      routes({ 'DELETE /api/v1/users/sam/sessions': ok({ revokedCount: 1 }) }),
    );
    renderSettings(<MembersView />);
    await act('Sam Okafor', 'Sign out everywhere');
    await confirmIn('Sign out everywhere');
    expect(
      await screen.findByText('Signed out of 1 session.'),
    ).toBeInTheDocument();
  });

  it('says why signing out was refused', async () => {
    stubApi(
      routes({ 'DELETE /api/v1/users/sam/sessions': fail(500, 'Down!') }),
    );
    renderSettings(<MembersView />);
    await act('Sam Okafor', 'Sign out everywhere');
    const dialog = await confirmIn('Sign out everywhere');
    expect(
      await within(dialog).findByText('Couldn’t sign them out'),
    ).toBeInTheDocument();
  });

  it('refuses deleting the last active Org Admin, in words, and deletes otherwise', async () => {
    stubApi(routes({ 'DELETE /api/v1/users/sam': fail(409, LAST_ADMIN) }));
    renderSettings(<MembersView />);
    await act('Sam Okafor', 'Delete');
    const dialog = await confirmIn('Delete');
    expect(
      await within(dialog).findByText(
        'Sam Okafor is the last active Org Admin',
      ),
    ).toBeInTheDocument();
  });

  it('deletes', async () => {
    const calls = stubApi(routes({ 'DELETE /api/v1/users/sam': ok({}) }));
    renderSettings(<MembersView />);
    await act('Sam Okafor', 'Delete');
    await confirmIn('Delete');
    await waitFor(() =>
      expect(
        calls.some(
          (call) => call.method === 'DELETE' && call.url.endsWith('/users/sam'),
        ),
      ).toBe(true),
    );
  });

  it('isn’t available without user.read', async () => {
    stubApi(viewer(['organization.read']));
    renderSettings(<MembersView />);
    expect(
      await screen.findByText('This page isn’t available'),
    ).toBeInTheDocument();
  });
});

describe('invite', () => {
  const routes = (extra: Record<string, unknown> = {}) => ({
    ...viewer(ADMIN),
    'GET /api/v1/roles': ROLES,
    'GET /api/v1/departments': DEPARTMENTS,
    'GET /api/v1/organizations/current/usage': USAGE,
    'GET /api/v1/organizations/current': ok({ name: 'Acme' }),
    ...(extra as Record<string, never>),
  });
  const open = async () => {
    renderSettings(<InviteButton />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Invite people' }),
    );
    return screen.getByLabelText('Email addresses');
  };
  const row = (
    email: string,
    reason: string | null = null,
    unknown: Partial<
      Record<'unknownRoleIds' | 'unknownDepartmentIds', string[]>
    > = {},
  ) => ({
    email,
    ok: reason === null,
    reason,
    unknownRoleIds: unknown.unknownRoleIds ?? [],
    unknownDepartmentIds: unknown.unknownDepartmentIds ?? [],
  });

  it('takes addresses as typed or pasted, and Backspace takes the last back', async () => {
    stubApi(routes());
    const field = await open();
    await userEvent.type(field, 'a@acme.test ');
    fireEvent.paste(field, {
      clipboardData: { getData: () => 'B@acme.test, c@acme.test\na@acme.test' },
    });
    for (const email of ['a@acme.test', 'b@acme.test', 'c@acme.test']) {
      expect(
        screen.getByRole('button', { name: `Remove ${email}` }),
      ).toBeInTheDocument();
    }
    await userEvent.type(field, '{Backspace}');
    expect(
      screen.queryByRole('button', { name: 'Remove c@acme.test' }),
    ).not.toBeInTheDocument();
  });

  it('needs an address, a real one, and a primary when departments are chosen', async () => {
    stubApi(routes());
    const field = await open();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(
      screen.getByText('Add at least one email address.'),
    ).toBeInTheDocument();
    await userEvent.type(field, 'not-an-address');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(
      screen.getByText('not-an-address isn’t an email address.'),
    ).toBeInTheDocument();
  });

  it('refuses an address with an empty domain label before sending', async () => {
    stubApi(routes());
    const field = await open();
    await userEvent.type(field, 'maya@acme..test');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(
      screen.getByText('maya@acme..test isn’t an email address.'),
    ).toBeInTheDocument();
  });

  it('explains each address the preview can’t send, and the unknown role or department', async () => {
    stubApi(
      routes({
        'POST /api/v1/users/invitations/preview': ok({
          rows: [
            row('a@acme.test', 'Already has an account here'),
            row('b@acme.test', null, { unknownRoleIds: ['r-gone'] }),
            row('c@acme.test', null, { unknownDepartmentIds: ['d-gone'] }),
            row('d@acme.test', 'Something new!'),
          ],
          seatsInUse: 18,
          maxAgentSeats: 20,
          seatOverrun: 0,
        }),
      }),
    );
    const field = await open();
    await userEvent.type(
      field,
      'a@acme.test b@acme.test c@acme.test d@acme.test{Enter}',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(
      await screen.findByText('Already has an account here.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Unknown role: r-gone.')).toBeInTheDocument();
    expect(screen.getByText('Unknown department: d-gone.')).toBeInTheDocument();
    expect(screen.getByText('Something new.')).toBeInTheDocument();
  });

  it('a failed preview says why', async () => {
    stubApi(
      routes({ 'POST /api/v1/users/invitations/preview': fail(500, 'Down!') }),
    );
    const field = await open();
    await userEvent.type(field, 'a@acme.test{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect((await screen.findAllByText('Down.'))[0]).toBeInTheDocument();
  });

  it('sending refused for seats shows the seats alert; another refusal, its words', async () => {
    const preview = ok({
      rows: [row('a@acme.test')],
      seatsInUse: 18,
      maxAgentSeats: 20,
      seatOverrun: 0,
    });
    stubApi(
      routes({
        'POST /api/v1/users/invitations/preview': preview,
        'POST /api/v1/users/invitations': fail(
          402,
          'No seats left. Revoke a pending invitation or change the plan to add people!',
        ),
      }),
    );
    const field = await open();
    await userEvent.type(field, 'a@acme.test{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Send 1 invitation' }),
    );
    expect(await screen.findByText('Not enough seats')).toBeInTheDocument();
  });

  it('sends, and lists what was sent and what wasn’t', async () => {
    stubApi(
      routes({
        'POST /api/v1/users/invitations/preview': ok({
          rows: [row('a@acme.test'), row('b@acme.test')],
          seatsInUse: 18,
          maxAgentSeats: 20,
          seatOverrun: 0,
        }),
        'POST /api/v1/users/invitations': ok(
          {
            batchId: 'b1',
            created: [
              {
                id: 'i1',
                email: 'a@acme.test',
                status: 'PENDING',
                roleIds: [],
                departmentIds: [],
                primaryDepartmentId: null,
                invitedByName: null,
                resentCount: 0,
                lastSentAt: '',
                createdAt: '',
                expiresAt: '',
              },
            ],
            failed: [
              {
                email: 'b@acme.test',
                reason: 'An invitation is already pending',
              },
            ],
          },
          201,
        ),
        'GET /api/v1/users/invitations': paged([]),
        'GET /api/v1/users': paged([]),
      }),
    );
    const field = await open();
    await userEvent.type(field, 'a@acme.test b@acme.test{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Send 2 invitations' }),
    );
    expect(
      await screen.findByRole('button', { name: 'Done' }),
    ).toBeInTheDocument();
    expect(screen.getByText('a@acme.test')).toBeInTheDocument();
    expect(screen.getByText(/already pending/)).toBeInTheDocument();
  });

  it('sends the batch’s roles and departments with a primary; too few seats holds the send', async () => {
    const calls = stubApi(
      routes({
        'POST /api/v1/users/invitations/preview': ok({
          rows: [row('a@acme.test'), row('b@acme.test')],
          seatsInUse: 19,
          maxAgentSeats: 20,
          seatOverrun: 1,
        }),
      }),
    );
    const field = await open();
    await userEvent.type(field, 'a@acme.test{Enter}b@acme.test');
    await userEvent.click(screen.getByRole('button', { name: 'Choose roles' }));
    await userEvent.click(
      await screen.findByRole('menuitemcheckbox', { name: 'End User' }),
    );
    await userEvent.keyboard('{Escape}');
    await userEvent.click(
      screen.getByRole('button', { name: 'Choose departments' }),
    );
    for (const name of ['HR', 'IT support']) {
      await userEvent.click(
        await screen.findByRole('menuitemcheckbox', { name }),
      );
    }
    await userEvent.keyboard('{Escape}');
    const primary = screen.getByRole('combobox', {
      name: 'Primary department',
    });
    expect(primary).toHaveTextContent('HR');
    await userEvent.click(screen.getByRole('button', { name: 'Remove HR' }));
    expect(primary).toHaveTextContent('IT support');
    await userEvent.click(
      screen.getByRole('button', { name: 'Choose departments' }),
    );
    await userEvent.click(
      await screen.findByRole('menuitemcheckbox', { name: 'HR' }),
    );
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Check before sending',
    });
    expect(
      within(dialog).getByText('End User · IT support (primary), HR'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        /You’re inviting 2 people and 1 seats are left\. Remove 1 address,/,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('link', { name: 'Plans and billing' }),
    ).toHaveAttribute('href', '/settings/billing');
    expect(
      within(dialog).getByRole('button', { name: 'Send 2 invitations' }),
    ).toBeDisabled();
    const sent = calls.find((call) => call.url.endsWith('/preview'))?.body as {
      invitations: unknown[];
    };
    expect(sent.invitations).toEqual(
      ['a@acme.test', 'b@acme.test'].map((email) => ({
        email,
        roleIds: ['r-end'],
        departmentIds: ['it', 'hr'],
        primaryDepartmentId: 'it',
      })),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('2 seats left')).toBeInTheDocument();
  });

  it('Cancel forgets what was typed', async () => {
    stubApi(routes());
    const field = await open();
    await userEvent.type(field, 'a@acme.test{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Invite people' }),
    );
    expect(
      screen.queryByRole('button', { name: 'Remove a@acme.test' }),
    ).not.toBeInTheDocument();
  });
});

describe('invitations', () => {
  const invitation = (id: string, email: string, status: string) => ({
    id,
    email,
    status,
    roleIds: ['r-end', 'r-gone'],
    departmentIds: ['hr', 'd-gone'],
    primaryDepartmentId: 'hr',
    invitedByName: 'Maya Chen',
    resentCount: 0,
    lastSentAt: '2026-10-01T00:00:00Z',
    createdAt: '2026-10-01T00:00:00Z',
    expiresAt: new Date(Date.now() + 86_400_000 / 2).toISOString(),
  });
  const routes = (extra: Record<string, unknown> = {}) => ({
    ...viewer(ADMIN),
    'GET /api/v1/users/invitations': paged([
      invitation('i1', 'omar@acme.test', 'PENDING'),
      invitation('i2', 'kim@acme.test', 'UNKNOWN'),
    ]),
    'GET /api/v1/roles': ROLES,
    'GET /api/v1/departments': DEPARTMENTS,
    ...(extra as Record<string, never>),
  });

  it('names each invitation’s roles and departments, the unknown ones as such', async () => {
    stubApi(routes());
    renderSettings(<InvitationsView />);
    expect(
      (
        await screen.findAllByText(
          'End User, r-gone · HR (primary), Unknown department',
        )
      )[0],
    ).toBeInTheDocument();
    expect(screen.getAllByText('Expires in 1 day')[0]).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('resends, and says when it couldn’t', async () => {
    stubApi(
      routes({
        'POST /api/v1/users/invitations/i1/resend': fail(500, 'Down!'),
      }),
    );
    renderSettings(<InvitationsView />);
    const [resend] = await screen.findAllByRole('button', {
      name: 'Resend to omar@acme.test',
    });
    await userEvent.click(resend);
    expect(await screen.findByText('Couldn’t resend it')).toBeInTheDocument();
  });

  it('resends', async () => {
    stubApi(routes({ 'POST /api/v1/users/invitations/i1/resend': ok({}) }));
    renderSettings(<InvitationsView />);
    const [resend] = await screen.findAllByRole('button', {
      name: 'Resend to omar@acme.test',
    });
    await userEvent.click(resend);
    expect(
      await screen.findByText(
        'A new link went to omar@acme.test. The old one no longer works.',
      ),
    ).toBeInTheDocument();
  });

  it('revokes; a refusal stays in the dialog', async () => {
    stubApi(
      routes({ 'DELETE /api/v1/users/invitations/i1': fail(500, 'Down!') }),
    );
    renderSettings(<InvitationsView />);
    const [revoke] = await screen.findAllByRole('button', {
      name: 'Revoke the invitation to omar@acme.test',
    });
    await userEvent.click(revoke);
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Revoke' }),
    );
    expect(
      await within(dialog).findByText('Couldn’t revoke it'),
    ).toBeInTheDocument();
  });

  it('says when the list couldn’t load', async () => {
    stubApi({
      ...routes(),
      'GET /api/v1/users/invitations': fail(500, 'Down!'),
    });
    renderSettings(<InvitationsView />);
    expect(
      await screen.findByText('Couldn’t load the invitations'),
    ).toBeInTheDocument();
  });

  it('isn’t available without user.read', async () => {
    stubApi(viewer(['organization.read']));
    renderSettings(<InvitationsView />);
    expect(
      await screen.findByText('This page isn’t available'),
    ).toBeInTheDocument();
  });
});
