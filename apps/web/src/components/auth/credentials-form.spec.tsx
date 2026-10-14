import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { fail, ok, stubApi } from '@/test/api';
import { CredentialsForm } from './credentials-form';
import type { SignInNotice } from './sign-in-flow';

const LOGIN = 'POST /api/v1/auth/login';

/** The form with its email held, as the sign-in page holds it. */
function Harness({
  notice = null,
  onAnswer,
}: {
  notice?: SignInNotice;
  onAnswer: jest.Mock;
}) {
  const [email, setEmail] = useState('');
  return (
    <CredentialsForm
      notice={notice}
      email={email}
      onEmail={setEmail}
      onAnswer={onAnswer}
    />
  );
}

const setup = (notice: SignInNotice = null) => {
  const onAnswer = jest.fn();
  render(<Harness notice={notice} onAnswer={onAnswer} />);
  return { onAnswer, user: userEvent.setup() };
};

const signIn = async (
  user: ReturnType<typeof userEvent.setup>,
  email = 'priya@acme.example',
  password = 'hunter2',
) => {
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
};

describe('the sign-in form', () => {
  it('asks for an email and a password before sending anything', async () => {
    const calls = stubApi({});
    const { user } = setup();

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      screen.getByText('Enter an email address like name@company.com.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(calls).toEqual([]);
  });

  it('with a good email and no password, points at the password', async () => {
    stubApi({});
    const { user } = setup();

    await user.type(screen.getByLabelText('Email'), 'priya@acme.example');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      screen.queryByText('Enter an email address like name@company.com.'),
    ).toBeNull();
    expect(screen.getByLabelText('Password')).toHaveFocus();
  });

  it('sends the trimmed email and answers with the next step', async () => {
    const calls = stubApi({
      [LOGIN]: ok({ requiresTwoFactor: true, requiresTwoFactorSetup: false }),
    });
    const { onAnswer, user } = setup();

    await signIn(user, '  priya@acme.example  ');

    expect(onAnswer).toHaveBeenCalledWith({ kind: 'code' });
    expect(calls[0].body).toMatchObject({
      email: 'priya@acme.example',
      password: 'hunter2',
    });
  });

  it('says the email or password is wrong on a 401', async () => {
    stubApi({ [LOGIN]: fail(401, 'Invalid credentials') });
    const { onAnswer, user } = setup();

    await signIn(user);

    expect(
      await screen.findByText('Email or password is incorrect'),
    ).toBeInTheDocument();
    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('counts down the pause after too many attempts', async () => {
    stubApi({
      [LOGIN]: fail(429, 'Too many requests', { 'retry-after': '120' }),
    });
    const { user } = setup();

    await signIn(user);

    expect(
      await screen.findByText('Too many sign-in attempts'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'For your security, sign-in is paused. Try again in 2 minutes.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the gateway’s message for any other failure', async () => {
    stubApi({ [LOGIN]: fail(503, 'Auth is down for maintenance') });
    const { user } = setup();

    await signIn(user);

    expect(await screen.findByText('Couldn’t sign in')).toBeInTheDocument();
    expect(
      screen.getByText('Auth is down for maintenance'),
    ).toBeInTheDocument();
  });

  it('asks to check the connection when the request never lands', async () => {
    stubApi({});
    const { user } = setup();

    await signIn(user);

    expect(
      await screen.findByText('Check your connection and try again.'),
    ).toBeInTheDocument();
  });

  it('treats an answer with no data as a failure', async () => {
    stubApi({ [LOGIN]: ok(null) });
    const { onAnswer, user } = setup();

    await signIn(user);

    expect(await screen.findByText('Couldn’t sign in')).toBeInTheDocument();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('shows and hides the password', async () => {
    const { user } = setup();
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');

    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('links to the reset page', () => {
    setup();
    expect(
      screen.getByRole('link', { name: 'Forgot password?' }),
    ).toHaveAttribute('href', '/forgot-password');
  });

  it.each<[SignInNotice, string]>([
    ['session-ended', 'Your session ended'],
    ['signed-out', 'You’ve signed out'],
    ['reset', 'Your password is changed'],
  ])('with the %s notice, says “%s”', (notice, title) => {
    setup(notice);
    expect(screen.getByRole('status')).toHaveTextContent(title);
  });

  it('after a reset that ended other sessions, says so', () => {
    setup('reset-signed-out-elsewhere');
    expect(screen.getByRole('status')).toHaveTextContent(
      'You’ve been signed out on your other devices.',
    );
  });

  it.each([
    [1, '1 session ended. Sign in again to continue.'],
    [3, '3 sessions ended. Sign in again to continue.'],
  ])(
    'after signing out everywhere (%i), says how many ended',
    (count, text) => {
      setup({ everywhere: count });
      expect(screen.getByRole('status')).toHaveTextContent(
        `You’ve signed out everywhere${text}`,
      );
    },
  );

  it('with no notice, shows no alert', () => {
    setup();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
