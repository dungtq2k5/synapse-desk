import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readTwoStepWarning } from '@/lib/two-step-warning';
import { ok, stubApi, type Reply } from '@/test/api';
import '@/test/dom';
import { SignInFlow } from './sign-in-flow';

const LOGIN = 'POST /api/v1/auth/login';
const TENANT = 'POST /api/v1/auth/login/tenant';
const AUTHENTICATE = 'POST /api/v1/auth/2fa/authenticate';
const GENERATE = 'POST /api/v1/auth/2fa/setup';
const ENABLE = 'POST /api/v1/auth/2fa/enable';
const SIGNED_IN = ok({ accessTokenExpiresIn: 900 });
const CODE = ok({ requiresTwoFactor: true, requiresTwoFactorSetup: false });

// jsdom navigates only within the page, so `next` is a fragment the test can
// watch the page arrive at.
const NEXT = '#signed-in';

const setup = (routes: Record<string, Reply>) => {
  const calls = stubApi(routes);
  render(<SignInFlow next={NEXT} notice={null} />);
  return { calls, user: userEvent.setup() };
};

const signIn = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText('Email'), 'priya@acme.example');
  await user.type(screen.getByLabelText('Password'), 'hunter2');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
};

const heading = (name: string) => screen.findByRole('heading', { name });

describe('the sign-in flow', () => {
  beforeEach(() => {
    globalThis.location.hash = '';
    sessionStorage.clear();
  });

  it('a password alone signs in and goes to next', async () => {
    const { user } = setup({ [LOGIN]: SIGNED_IN });

    await signIn(user);

    expect(globalThis.location.hash).toBe(NEXT);
  });

  it('asks for a code, then signs in and keeps the backup-code warning', async () => {
    const { user } = setup({
      [LOGIN]: CODE,
      [AUTHENTICATE]: ok({ warning: 'Only 2 backup codes left.' }),
    });

    await signIn(user);
    await heading('Two-step verification');
    await user.type(screen.getByLabelText('Verification code'), '123456');

    expect(globalThis.location.hash).toBe(NEXT);
    expect(readTwoStepWarning()).toBe('Only 2 backup codes left.');
  });

  it('asks which organization, with the email typed, then signs in', async () => {
    const { user } = setup({
      [LOGIN]: ok({
        requiresTenantSelection: true,
        tenants: [
          { organizationId: 'org-acme', name: 'Acme', slug: 'acme' },
          { organizationId: 'org-globex', name: 'Globex', slug: 'globex' },
        ],
      }),
      [TENANT]: SIGNED_IN,
    });

    await signIn(user);
    await heading('Choose an organization');
    expect(
      screen.getByText(/^priya@acme\.example belongs to/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Globex/ }));

    expect(globalThis.location.hash).toBe(NEXT);
  });

  it('sets up two-step when the organization requires it, then asks for a code', async () => {
    const { user } = setup({
      [LOGIN]: ok({ requiresTwoFactor: true, requiresTwoFactorSetup: true }),
      [GENERATE]: ok({
        otpauthUri: 'otpauth://totp/SynapseDesk:priya?secret=JBSWY3DPEHPK3PXP',
        qrCodeDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      }),
      [ENABLE]: ok({ backupCodes: ['AAAAA-11111'] }),
    });

    await signIn(user);
    await screen.findByText('JBSW Y3DP EHPK 3PXP');
    await user.type(screen.getByLabelText('Verification code'), '123456');
    await user.click(
      screen.getByRole('button', { name: 'Verify and continue' }),
    );
    await heading('Save your backup codes');
    await user.click(
      screen.getByRole('checkbox', {
        name: 'I’ve saved my backup codes somewhere safe',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Two-step verification is on',
    );
    expect(globalThis.location.hash).toBe('');
  });

  it('goes back to sign-in with the email kept', async () => {
    const { user } = setup({ [LOGIN]: CODE });

    await signIn(user);
    await heading('Two-step verification');
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));

    expect(await heading('Sign in')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('priya@acme.example');
  });
});
