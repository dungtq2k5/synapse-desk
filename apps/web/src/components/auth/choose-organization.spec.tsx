import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi } from '@/test/api';
import { ChooseOrganization } from './choose-organization';

const TENANT = 'POST /api/v1/auth/login/tenant';
const TENANTS = [
  { organizationId: 'org-acme', name: 'Acme', slug: 'acme' },
  { organizationId: 'org-globex', name: 'Globex', slug: 'globex' },
];

const setup = () => {
  const onAnswer = jest.fn();
  const onBack = jest.fn();
  render(
    <ChooseOrganization
      email=" priya@acme.example "
      tenants={TENANTS}
      onAnswer={onAnswer}
      onBack={onBack}
    />,
  );
  return { onAnswer, onBack, user: userEvent.setup() };
};

describe('choosing an organization', () => {
  it('lists each organization for the email', () => {
    setup();
    expect(
      screen.getByText(
        'priya@acme.example belongs to more than one organization. Choose the one to sign in to.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Acme/ })).toHaveFocus();
    expect(screen.getByRole('button', { name: /Globex/ })).toBeInTheDocument();
  });

  it('signs in to the chosen one and answers with the next step', async () => {
    const calls = stubApi({ [TENANT]: ok({ accessTokenExpiresIn: 900 }) });
    const { onAnswer, user } = setup();

    await user.click(screen.getByRole('button', { name: /Globex/ }));

    expect(onAnswer).toHaveBeenCalledWith({ kind: 'signed-in' });
    expect(calls[0].body).toMatchObject({ organizationId: 'org-globex' });
  });

  it('dims the others while one signs in, and ignores a second choice', async () => {
    stubApi({
      [TENANT]: ok({
        requiresTwoFactor: true,
        requiresTwoFactorSetup: false,
        canRememberDevice: true,
      }),
    });
    // Hold the answer, to look at the page while the sign-in is in flight.
    const stubbed = globalThis.fetch;
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    globalThis.fetch = jest.fn(async (...args: Parameters<typeof fetch>) => {
      await held;
      return stubbed(...args);
    });
    const { onAnswer, user } = setup();

    await user.click(screen.getByRole('button', { name: /Acme/ }));
    expect(screen.getByRole('button', { name: /Acme/ })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('button', { name: /Globex/ })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /Acme/ }));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() =>
      expect(onAnswer).toHaveBeenCalledWith({
        kind: 'code',
        canRememberDevice: true,
      }),
    );
  });

  it('says which one failed and lets the user choose again', async () => {
    stubApi({ [TENANT]: fail(403, 'Membership suspended') });
    const { onAnswer, user } = setup();

    await user.click(screen.getByRole('button', { name: /Acme/ }));

    expect(
      await screen.findByText('Couldn’t sign in to Acme'),
    ).toBeInTheDocument();
    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Globex/ })).toBeEnabled();
  });

  it('treats an answer with no data as a failure', async () => {
    stubApi({ [TENANT]: ok(null) });
    const { user } = setup();

    await user.click(screen.getByRole('button', { name: /Globex/ }));

    expect(
      await screen.findByText('Couldn’t sign in to Globex'),
    ).toBeInTheDocument();
  });

  it('goes back to sign-in', async () => {
    const { onBack, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(onBack).toHaveBeenCalled();
  });
});
