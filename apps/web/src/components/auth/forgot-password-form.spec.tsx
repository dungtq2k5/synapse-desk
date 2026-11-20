import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi, type Reply } from '@/test/api';
import { ForgotPasswordForm } from './forgot-password-form';

const FORGOT = 'POST /api/v1/auth/password/forgot';

const setup = (reply?: Reply) => {
  const calls = stubApi(reply ? { [FORGOT]: reply } : {});
  render(<ForgotPasswordForm />);
  return { calls, user: userEvent.setup() };
};

const send = async (
  user: ReturnType<typeof userEvent.setup>,
  email = 'priya@acme.example',
) => {
  await user.type(screen.getByLabelText('Email'), email);
  await user.click(screen.getByRole('button', { name: 'Send link' }));
};

describe('the forgot-password form', () => {
  it('asks for a real email address before sending', async () => {
    const { calls, user } = setup();

    await send(user, 'priya');

    expect(
      screen.getByText('Enter an email address like name@company.com.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(calls).toEqual([]);
  });

  it('says to check the email, whatever the address, and can send again', async () => {
    const { calls, user } = setup(ok(null, 202));

    await send(user, ' priya@acme.example ');

    expect(await screen.findByText('Check your email')).toBeInTheDocument();
    expect(calls[0].body).toEqual({ email: 'priya@acme.example' });

    await user.click(screen.getByRole('button', { name: 'Send again' }));
    expect(calls).toHaveLength(2);
  });

  it('counts down the pause after too many requests', async () => {
    const { user } = setup(
      fail(429, 'Too many requests', { 'retry-after': '300' }),
    );

    await send(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'For your security, sending is paused. Try again in 5 minutes.',
    );
    expect(screen.queryByText('Check your email')).toBeNull();
  });

  it('shows why the link couldn’t be sent', async () => {
    const { user } = setup(fail(503, 'Mail is down for maintenance'));

    await send(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t send the link',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Mail is down for maintenance',
    );
    expect(screen.getByRole('button', { name: 'Send link' })).toBeEnabled();
  });

  it('links back to sign-in', () => {
    setup();
    expect(
      screen.getByRole('link', { name: 'Back to sign in' }),
    ).toHaveAttribute('href', '/login');
  });
});
