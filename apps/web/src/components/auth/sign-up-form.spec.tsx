import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi } from '@/test/api';
import { SignUpForm } from './sign-up-form';

const REGISTER = 'POST /api/v1/auth/register';

const setup = () => {
  render(<SignUpForm onAnswer={jest.fn()} />);
  return userEvent.setup();
};

const fillIn = async (
  user: ReturnType<typeof userEvent.setup>,
  {
    name = 'Maya Chen',
    email = 'maya@northwind.health',
    password = 'Str0ng!pass',
  } = {},
) => {
  if (name) await user.type(screen.getByLabelText('Full name'), name);
  if (email) await user.type(screen.getByLabelText('Work email'), email);
  if (password)
    await user.type(
      screen.getByLabelText('Password', { exact: true }),
      password,
    );
  await user.click(screen.getByRole('button', { name: 'Create account' }));
};

describe('the sign-up form', () => {
  it('says what each field needs before sending anything', async () => {
    const calls = stubApi({});
    const user = setup();

    await fillIn(user, {
      name: 'M',
      email: 'maya@northwind',
      password: 'abcdefg1',
    });

    expect(
      screen.getByText('Enter your full name (at least 2 characters).'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Enter an email address like name@company.com.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Your password needs an uppercase letter and a symbol.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Full name')).toHaveFocus();
    expect(calls).toEqual([]);
  });

  it('ticks the checklist as the password is typed', async () => {
    stubApi({});
    const user = setup();

    await user.type(screen.getByLabelText('Password', { exact: true }), 'Abc');

    expect(
      screen.getByLabelText('An uppercase letter, met'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('A symbol, not met')).toBeInTheDocument();
  });

  it('ends on one screen for every valid form, with focus on its heading', async () => {
    const calls = stubApi({
      [REGISTER]: ok(
        { email: 'maya@northwind.health', requiresEmailVerification: true },
        201,
      ),
    });
    const user = setup();

    await fillIn(user);

    const heading = await screen.findByRole('heading', {
      name: 'Check your email, then sign in',
    });
    expect(heading).toHaveFocus();
    expect(
      screen.getByText(/We’ve sent a message to maya@northwind\.health\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(calls[0].body).toEqual({
      email: 'maya@northwind.health',
      password: 'Str0ng!pass',
      fullName: 'Maya Chen',
    });
  });

  it('a 429 pauses sign-up for the minutes the server says', async () => {
    stubApi({
      [REGISTER]: fail(429, 'Too many requests', { 'retry-after': '300' }),
    });
    const user = setup();

    await fillIn(user);

    expect(
      await screen.findByText(
        'For your security, sign-up is paused. Try again in 5 minutes.',
      ),
    ).toBeInTheDocument();
  });
});
