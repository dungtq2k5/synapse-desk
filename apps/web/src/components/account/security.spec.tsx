import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { fail, ok, stubApi, type Reply } from '@/test/api';
import '@/test/dom';
import { PasswordSection, signedOutElsewhere } from './password-section';
import { SessionsSection } from './sessions-section';
import { TwoStepSection } from './two-step-section';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

const refreshed = (calls: { url: string }[]) =>
  calls.some((call) => call.url.endsWith('/auth/refresh'));

function wrap(node: React.ReactNode, routes: Record<string, Reply> = {}) {
  const calls = stubApi(routes);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {node}
    </QueryClientProvider>,
  );
  return { calls, user: userEvent.setup() };
}

const STRONG = 'Northwind-2026';

describe('the password section', () => {
  it.each([
    [0, 'No other devices were signed in.'],
    [1, 'You were signed out on 1 other device.'],
    [2, 'You were signed out on 2 other devices.'],
  ])('after a change that ended %i sessions, says “%s”', (count, text) => {
    expect(signedOutElsewhere(count)).toBe(text);
  });

  it('says what the new password needs, and sends nothing', async () => {
    const { calls, user } = wrap(
      <PasswordSection email="maya@northwind.health" hasPassword />,
    );
    await user.type(screen.getByLabelText('Current password'), 'old-one');
    await user.type(screen.getByLabelText('New password'), 'northwind');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(
      screen.getByText(
        'Your password needs an uppercase letter, a number and a symbol.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveFocus();
    expect(calls).toHaveLength(0);
  });

  it('says when the confirmation doesn’t match', async () => {
    const { calls, user } = wrap(
      <PasswordSection email="maya@northwind.health" hasPassword />,
    );
    await user.type(screen.getByLabelText('Current password'), 'old-one');
    await user.type(screen.getByLabelText('New password'), STRONG);
    await user.type(screen.getByLabelText('Confirm new password'), 'other');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(screen.getByText('The passwords don’t match.')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  async function change(routes: Record<string, Reply>) {
    const wrapped = wrap(
      <PasswordSection email="maya@northwind.health" hasPassword />,
      routes,
    );
    const { user } = wrapped;
    await user.type(screen.getByLabelText('Current password'), 'Old-pass-1');
    await user.type(screen.getByLabelText('New password'), STRONG);
    await user.type(screen.getByLabelText('Confirm new password'), STRONG);
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    return wrapped;
  }

  it('a wrong current password (a 403) is said on that field, sent once', async () => {
    const { calls } = await change({
      'PATCH /api/v1/auth/password': fail(403, 'Current password is incorrect'),
    });
    expect(
      await screen.findByText('That’s not your current password.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveFocus();
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
    expect(refreshed(calls)).toBe(false);
  });

  it('changes it, says how many devices were signed out, and clears', async () => {
    const { calls } = await change({
      'PATCH /api/v1/auth/password': ok({ revokedSessionCount: 2 }),
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Password changedYou were signed out on 2 other devices.',
    );
    expect(calls[0].body).toEqual({
      currentPassword: 'Old-pass-1',
      newPassword: STRONG,
    });
    expect(screen.getByLabelText('New password')).toHaveValue('');
  });

  it('without a password, sends the link to set one', async () => {
    const { calls, user } = wrap(
      <PasswordSection email="maya@northwind.health" hasPassword={false} />,
      { 'POST /api/v1/auth/password/forgot': ok(null, 202) },
    );
    expect(screen.getByText('You sign in with Google')).toBeInTheDocument();
    expect(screen.queryByLabelText('Current password')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Set a password' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'We sent a link to m***a@northwind.health. Open it to set your password.',
    );
    expect(calls[0].body).toEqual({ email: 'maya@northwind.health' });
  });
});

describe('the two-step section', () => {
  const STATUS = {
    'GET /api/v1/auth/2fa/backup-codes': ok({
      remaining: 7,
      used: 3,
      expiresAt: '2027-10-12T12:00:00Z',
    }),
  };

  it('off: offers to turn it on', () => {
    wrap(
      <TwoStepSection
        hasPassword
        enabled={false}
        required={false}
        organizationName="N"
      />,
    );
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeEnabled();
  });

  it('on: the backup codes left and when they expire', async () => {
    wrap(
      <TwoStepSection
        hasPassword
        enabled
        required={false}
        organizationName="N"
      />,
      STATUS,
    );
    expect(
      await screen.findByText('7 of 10 left · They expire on Oct 12, 2027.'),
    ).toBeInTheDocument();
  });

  it('required: Turn off is disabled, with the reason', () => {
    wrap(
      <TwoStepSection
        hasPassword
        enabled
        required
        organizationName="Northwind Health"
      />,
      STATUS,
    );
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Turn off' }),
    ).toHaveAccessibleDescription(
      'Northwind Health requires two-step verification, so you can’t turn it off.',
    );
  });

  it('without a password, on: no Regenerate or Turn off, a way to set one', async () => {
    // Both need a password a Google-only account doesn't have.
    wrap(
      <TwoStepSection
        hasPassword={false}
        enabled
        required={false}
        organizationName="N"
      />,
      STATUS,
    );
    expect(
      await screen.findByText('7 of 10 left · They expire on Oct 12, 2027.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Regenerate codes' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Set a password' }),
    ).toHaveAttribute('href', '#set-password');
  });

  it('turning off when the organization now requires it is refused', async () => {
    const { user } = wrap(
      <TwoStepSection
        hasPassword
        enabled
        required={false}
        organizationName="Northwind Health"
      />,
      {
        ...STATUS,
        'DELETE /api/v1/auth/2fa': fail(
          400,
          'Your organization requires two-factor authentication',
        ),
      },
    );
    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    const dialog = screen.getByRole('alertdialog');
    await user.type(within(dialog).getByLabelText('Password'), 'Pass-word-1');
    await user.type(within(dialog).getByRole('textbox'), '204815');
    await user.click(within(dialog).getByRole('button', { name: 'Turn off' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Northwind Health requires two-step verification',
    );
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeVisible();
  });

  it('a wrong password (a 403) on regenerating is said on the field, sent once', async () => {
    const { calls, user } = wrap(
      <TwoStepSection
        hasPassword
        enabled
        required={false}
        organizationName="N"
      />,
      {
        ...STATUS,
        'POST /api/v1/auth/2fa/backup-codes': fail(403, 'Invalid credentials'),
      },
    );
    await user.click(screen.getByRole('button', { name: 'Regenerate codes' }));
    const confirm = screen.getByRole('alertdialog');
    await user.type(within(confirm).getByLabelText('Password'), 'Wrong-pass-1');
    await user.click(
      within(confirm).getByRole('button', { name: 'Regenerate codes' }),
    );

    expect(
      await within(confirm).findByText('That’s not your current password.'),
    ).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(refreshed(calls)).toBe(false);
  });

  it('a wrong password or code (a 403) on turning off says so, sent once', async () => {
    const { calls, user } = wrap(
      <TwoStepSection
        hasPassword
        enabled
        required={false}
        organizationName="N"
      />,
      {
        ...STATUS,
        'DELETE /api/v1/auth/2fa': fail(403, 'Invalid verification code'),
      },
    );
    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    const dialog = screen.getByRole('alertdialog');
    await user.type(within(dialog).getByLabelText('Password'), 'Pass-word-1');
    await user.type(within(dialog).getByRole('textbox'), '000000');
    await user.click(within(dialog).getByRole('button', { name: 'Turn off' }));

    expect(
      await within(dialog).findByText(
        'Check your password and the code, then try again.',
      ),
    ).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
    expect(refreshed(calls)).toBe(false);
  });

  it('regenerating shows the new codes, which stay until they’re saved', async () => {
    const { calls, user } = wrap(
      <TwoStepSection
        hasPassword
        enabled
        required={false}
        organizationName="N"
      />,
      {
        ...STATUS,
        'POST /api/v1/auth/2fa/backup-codes': ok({
          backupCodes: ['V8KQ2-MX7PL', 'J8KPD-4WZNC'],
        }),
      },
    );
    await user.click(screen.getByRole('button', { name: 'Regenerate codes' }));
    const confirm = screen.getByRole('alertdialog');
    await user.type(within(confirm).getByLabelText('Password'), 'Pass-word-1');
    await user.click(
      within(confirm).getByRole('button', { name: 'Regenerate codes' }),
    );

    const codes = await screen.findByRole('dialog', {
      name: 'Your new backup codes',
    });
    expect(within(codes).getByText('V8KQ2-MX7PL')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      password: 'Pass-word-1',
    });

    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const done = within(codes).getByRole('button', { name: 'Done' });
    expect(done).toBeDisabled();

    await user.click(
      within(codes).getByLabelText('I’ve saved my new backup codes'),
    );
    await user.click(done);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the sessions section', () => {
  const SESSIONS = [
    {
      id: 's1',
      deviceName: null,
      ipAddress: '203.0.113.24',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0 Safari/537.36',
      current: true,
      isTrusted: true,
      trustedUntil: '2026-11-12T12:00:00Z',
      expiresAt: '2026-11-12T12:00:00Z',
      createdAt: '2026-10-13T09:12:00Z',
    },
    {
      id: 's2',
      deviceName: 'Firefox on Windows',
      ipAddress: '192.0.2.44',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Firefox/131.0',
      current: false,
      isTrusted: false,
      trustedUntil: null,
      expiresAt: '2026-10-18T12:00:00Z',
      createdAt: '2026-10-11T14:05:00Z',
    },
  ];
  const LIST = { 'GET /api/v1/auth/sessions': ok(SESSIONS) };

  it('marks this device, which can’t be signed out from here', async () => {
    wrap(<SessionsSection />, LIST);
    const here = await screen.findByRole('listitem', {
      name: 'Chrome on macOS',
    });
    expect(within(here).getByText('This device')).toBeInTheDocument();
    expect(
      within(here).getByText('Trusted until Nov 12, 2026'),
    ).toBeInTheDocument();
    expect(within(here).queryByRole('button', { name: /Sign out/ })).toBeNull();
    expect(
      within(here).getByRole('button', {
        name: 'Remove trust from Chrome on macOS',
      }),
    ).toBeEnabled();
  });

  it('signs another session out', async () => {
    const { calls, user } = wrap(<SessionsSection />, {
      ...LIST,
      'DELETE /api/v1/auth/sessions/s2': ok({ count: 1 }),
    });
    await user.click(
      await screen.findByRole('button', {
        name: 'Sign out of Firefox on Windows',
      }),
    );
    expect(calls.some((call) => call.method === 'DELETE')).toBe(true);
    expect(toast.success).toHaveBeenCalledWith(
      'Signed out of Firefox on Windows',
    );
  });

  it('signs out everywhere only after asking, then says how many ended', async () => {
    const { calls, user } = wrap(<SessionsSection />, {
      ...LIST,
      'POST /api/v1/auth/logout/all': ok({ revokedSessionCount: 3 }),
    });
    await screen.findByRole('listitem', { name: 'Chrome on macOS' });
    await user.click(
      screen.getByRole('button', { name: 'Sign out everywhere' }),
    );
    const confirm = screen.getByRole('alertdialog');
    expect(
      within(confirm).getByRole('button', { name: 'Cancel' }),
    ).toHaveFocus();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);

    await user.click(
      within(confirm).getByRole('button', { name: 'Sign out everywhere' }),
    );
    expect(push).toHaveBeenCalledWith('/login?signed-out-everywhere=3');
  });
});

describe('the account sections’ other refusals', () => {
  async function changePassword(reply: Reply) {
    const wrapped = wrap(
      <PasswordSection email="maya@northwind.health" hasPassword />,
      { 'PATCH /api/v1/auth/password': reply },
    );
    const { user } = wrapped;
    await user.type(screen.getByLabelText('Current password'), 'Old-pass-1');
    await user.type(screen.getByLabelText('New password'), STRONG);
    await user.type(screen.getByLabelText('Confirm new password'), STRONG);
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    return wrapped;
  }

  it('a new password the server refuses (a 400) is said on that field', async () => {
    await changePassword(fail(400, 'That password was in a breach'));
    expect(
      await screen.findByText('That password was in a breach'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveFocus();
  });

  it('too many attempts (a 429) pauses changing it', async () => {
    await changePassword(fail(429, 'Too many', { 'Retry-After': '30' }));
    expect(await screen.findByText('Too many attempts')).toBeInTheDocument();
  });

  it('anything else is said in the server’s words', async () => {
    await changePassword(fail(500, 'Down'));
    expect(
      await screen.findByText('Couldn’t change your password'),
    ).toBeInTheDocument();
    expect(screen.getByText('Down')).toBeInTheDocument();
  });

  it.each([
    [fail(429, 'Too many', { 'Retry-After': '30' }), 'Too many requests'],
    [fail(500, 'Down'), 'Couldn’t send the link'],
  ])(
    'sending the set-password link, refused, says so',
    async (reply, words) => {
      const { user } = wrap(
        <PasswordSection email="maya@northwind.health" hasPassword={false} />,
        { 'POST /api/v1/auth/password/forgot': reply },
      );
      await user.click(screen.getByRole('button', { name: 'Set a password' }));
      expect(await screen.findByText(words)).toBeInTheDocument();
    },
  );

  const STATUS = {
    'GET /api/v1/auth/2fa/backup-codes': ok({
      remaining: 7,
      used: 3,
      expiresAt: '2027-10-12T12:00:00Z',
    }),
  };

  it('regenerating refused for another reason says so in the dialog', async () => {
    const { user } = wrap(
      <TwoStepSection
        hasPassword
        enabled
        required={false}
        organizationName="N"
      />,
      { ...STATUS, 'POST /api/v1/auth/2fa/backup-codes': fail(500, 'Down') },
    );
    await user.click(screen.getByRole('button', { name: 'Regenerate codes' }));
    const confirm = screen.getByRole('alertdialog');
    await user.click(
      within(confirm).getByRole('button', { name: 'Regenerate codes' }),
    );
    // No password yet: the field is asked for first.
    expect(within(confirm).getByLabelText('Password')).toHaveFocus();
    await user.type(within(confirm).getByLabelText('Password'), 'Pass-word-1');
    await user.click(
      within(confirm).getByRole('button', { name: 'Regenerate codes' }),
    );
    expect(
      await within(confirm).findByText('Something went wrong'),
    ).toBeInTheDocument();
  });

  it('turning off needs the password and the code; a 400 means the organization requires it', async () => {
    const { calls, user } = wrap(
      <TwoStepSection
        hasPassword
        enabled
        required={false}
        organizationName="N"
      />,
      {
        ...STATUS,
        'DELETE /api/v1/auth/2fa': fail(400, 'Two-step is required'),
      },
    );
    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    const dialog = screen.getByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Turn off' }));
    expect(
      within(dialog).getByText('Enter your password.'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Enter the 6-digit code.'),
    ).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);

    await user.type(within(dialog).getByLabelText('Password'), 'Pass-word-1');
    await user.type(within(dialog).getByRole('textbox'), '123456');
    await user.click(within(dialog).getByRole('button', { name: 'Turn off' }));
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });

  it('turning off refused for another reason says so', async () => {
    const { user } = wrap(
      <TwoStepSection
        hasPassword
        enabled
        required={false}
        organizationName="N"
      />,
      {
        ...STATUS,
        'DELETE /api/v1/auth/2fa': fail(429, 'Too many', {
          'Retry-After': '30',
        }),
      },
    );
    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    const dialog = screen.getByRole('alertdialog');
    await user.type(within(dialog).getByLabelText('Password'), 'Pass-word-1');
    await user.type(within(dialog).getByRole('textbox'), '123456');
    await user.click(within(dialog).getByRole('button', { name: 'Turn off' }));
    expect(
      await within(dialog).findByText('Too many attempts'),
    ).toBeInTheDocument();
  });
});
