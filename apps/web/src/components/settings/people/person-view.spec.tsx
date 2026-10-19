import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi } from '@/test/api';
import { renderSettings, stubMatchMedia, viewer } from '@/test/settings';
import { PersonView } from './person-view';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/settings/people/sam',
}));
jest.mock('@/components/shell/app-header', () => ({ AppHeader: () => null }));

beforeAll(stubMatchMedia);

const ADMIN = [
  'user.read',
  'user.update',
  'user.lock',
  'user.delete',
  'user.2fa.reset',
  'user.session.read',
  'user.session.revoke',
];
const LAST_ADMIN =
  'This is the last active Org Admin. Promote another before removing this one!';

const summary = (
  over: Record<string, unknown> = {},
  user: Record<string, unknown> = {},
) => ({
  user: {
    id: 'sam',
    organizationId: 'org',
    fullName: 'Sam Okafor',
    avatarUrl: null,
    email: 'sam@acme.test',
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
  roleIds: [],
  roleNames: ['End User'],
  departmentIds: [],
  deletedAt: null,
  deletedByName: null,
  ...over,
});

const SESSIONS = ['s1', 's2'].map((id) => ({
  id,
  deviceName: null,
  ipAddress: '10.0.0.1',
  userAgent: 'Mozilla/5.0 (Macintosh) Chrome/141.0.0.0',
  current: false,
  isTrusted: false,
  trustedUntil: null,
  expiresAt: '2099-01-01T00:00:00Z',
  createdAt: '2026-10-01T00:00:00Z',
}));

function open(routes: Record<string, unknown>, person = summary()) {
  const calls = stubApi({
    ...viewer(ADMIN),
    'GET /api/v1/users/sam': ok(person),
    'GET /api/v1/users/sam/sessions': ok(SESSIONS),
    'GET /api/v1/users/sam/permissions': ok({
      permissionCodes: ['ticket.create'],
    }),
    ...(routes as Record<string, never>),
  });
  renderSettings(<PersonView userId="sam" />);
  return calls;
}

const confirm = async (
  button: string | RegExp,
  confirmLabel = String(button),
) => {
  await userEvent.click(await screen.findByRole('button', { name: button }));
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.click(
    within(dialog).getByRole('button', { name: confirmLabel }),
  );
  return dialog;
};

describe('details', () => {
  it('refuses a date that isn’t one, then saves the trimmed details', async () => {
    const calls = open({ 'PATCH /api/v1/users/sam': ok(summary()) });
    const name = await screen.findByLabelText('Full name');
    await userEvent.clear(name);
    await userEvent.type(name, ' Samuel Okafor ');
    await userEvent.type(screen.getByLabelText('Date of birth'), '13/45/1990');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      screen.getByText('Enter a date like 03/14/1990.'),
    ).toBeInTheDocument();

    const dob = screen.getByLabelText('Date of birth');
    await userEvent.clear(dob);
    await userEvent.type(dob, '03/14/1990');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
        fullName: 'Samuel Okafor',
        phoneNumber: null,
        dob: '1990-03-14',
        gender: 'UNSPECIFIED',
      }),
    );
  });

  it('says when saving failed', async () => {
    open({ 'PATCH /api/v1/users/sam': fail(500, 'Down!') });
    await userEvent.type(
      await screen.findByLabelText('Phone number'),
      '+49301234',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('Couldn’t save their details'),
    ).toBeInTheDocument();
  });

  it('reads as text without user.update', async () => {
    stubApi({
      ...viewer(['user.read']),
      'GET /api/v1/users/sam': ok(
        summary({}, { phoneNumber: '+49301234', gender: 'FEMALE' }),
      ),
    });
    renderSettings(<PersonView userId="sam" />);
    expect(await screen.findByText('+49301234')).toBeInTheDocument();
    expect(screen.getByText('Female')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Save changes' }),
    ).not.toBeInTheDocument();
  });
});

describe('security and sessions', () => {
  it('resets two-step', async () => {
    const calls = open({ 'POST /api/v1/users/sam/2fa/reset': ok({}) });
    await confirm('Reset two-step');
    await waitFor(() =>
      expect(
        calls.some((call) => call.url.endsWith('/users/sam/2fa/reset')),
      ).toBe(true),
    );
  });

  it('says why a reset was refused', async () => {
    open({ 'POST /api/v1/users/sam/2fa/reset': fail(500, 'Down!') });
    const dialog = await confirm('Reset two-step');
    expect(
      await within(dialog).findByText('Couldn’t reset it'),
    ).toBeInTheDocument();
  });

  it('signs them out everywhere, saying how many sessions ended', async () => {
    open({ 'DELETE /api/v1/users/sam/sessions': ok({ revokedCount: 2 }) });
    await confirm(/Sign out everywhere/, 'Sign out everywhere');
    expect(
      await screen.findByText('Signed out of 2 sessions.'),
    ).toBeInTheDocument();
  });

  it('says why signing out was refused', async () => {
    open({ 'DELETE /api/v1/users/sam/sessions': fail(500, 'Down!') });
    const dialog = await confirm(/Sign out everywhere/, 'Sign out everywhere');
    expect(
      await within(dialog).findByText('Couldn’t sign them out'),
    ).toBeInTheDocument();
  });

  it('says when unlocking failed', async () => {
    open(
      { 'POST /api/v1/users/sam/unlock': fail(500, 'Down!') },
      summary({}, { isLocked: true }),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Unlock' }),
    );
    expect(await screen.findByText('Couldn’t unlock them')).toBeInTheDocument();
  });
});

describe('delete and restore', () => {
  it('refuses deleting the last active Org Admin, in words', async () => {
    open({ 'DELETE /api/v1/users/sam': fail(409, LAST_ADMIN) });
    const dialog = await confirm('Delete');
    expect(
      await within(dialog).findByText(
        'Sam Okafor is the last active Org Admin',
      ),
    ).toBeInTheDocument();
  });

  it('deletes', async () => {
    const calls = open({ 'DELETE /api/v1/users/sam': ok({}) });
    await confirm('Delete');
    await waitFor(() =>
      expect(
        calls.some(
          (call) => call.method === 'DELETE' && call.url.endsWith('/users/sam'),
        ),
      ).toBe(true),
    );
  });

  it('restores a deleted member', async () => {
    open(
      { 'POST /api/v1/users/sam/restore': ok(summary()) },
      summary({
        deletedAt: '2026-09-12T09:00:00Z',
        deletedByName: 'Maya Chen',
      }),
    );
    expect(await screen.findByText(/by Maya Chen/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText('Sam Okafor restored.')).toBeInTheDocument();
  });

  it('says why a restore was refused when it isn’t the seats', async () => {
    open(
      { 'POST /api/v1/users/sam/restore': fail(409, 'That address is taken!') },
      summary({ deletedAt: '2026-09-12T09:00:00Z' }),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Restore' }),
    );
    expect(
      await screen.findByText('Couldn’t restore them'),
    ).toBeInTheDocument();
  });
});

it('isn’t available when the person can’t be read', async () => {
  open({ 'GET /api/v1/users/sam': fail(404, 'No user with that id!') });
  expect(
    await screen.findByText('This page isn’t available'),
  ).toBeInTheDocument();
});
