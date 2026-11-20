import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi, type Reply } from '@/test/api';
import { InvitationAccept } from './invitation-accept';

const PREVIEW = 'GET /api/v1/users/invitations/token/tok-1';
const ACCEPT = 'POST /api/v1/users/invitations/accept';
const VALID = ok({
  valid: true,
  organizationName: 'Northwind Health',
  inviterName: 'Jordan Lee',
  email: 'priya@northwind.health',
  roleNames: ['Agent', 'Knowledge manager'],
  expiresAt: '2026-10-20T12:00:00Z',
});

const setup = (routes: Record<string, Reply>) => {
  const calls = stubApi(routes);
  const onAnswer = jest.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <InvitationAccept token="tok-1" onAnswer={onAnswer} />
    </QueryClientProvider>,
  );
  return { calls, onAnswer, user: userEvent.setup() };
};

const join = async (
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  password: string,
) => {
  await user.type(await screen.findByLabelText('Full name'), name);
  await user.type(screen.getByLabelText('Password', { exact: true }), password);
  await user.click(
    screen.getByRole('button', { name: 'Join Northwind Health' }),
  );
};

describe('accepting an invitation', () => {
  it('says who invited you, to what and as what, with the email fixed', async () => {
    setup({ [PREVIEW]: VALID });

    expect(
      await screen.findByText(
        'Jordan Lee invited you to join Northwind Health as Agent and Knowledge manager.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Email')).toHaveValue(
      'priya@northwind.health',
    );
    expect(
      screen.getByText('This invitation expires on Oct 20, 2026.'),
    ).toBeInTheDocument();
  });

  it('joins with the token in the body, and signs in', async () => {
    const { calls, onAnswer, user } = setup({
      [PREVIEW]: VALID,
      [ACCEPT]: ok({ requiresTwoFactor: false, user: { id: 'u1' } }),
    });

    await join(user, 'Priya Shah', 'Northwind-26');

    expect(calls.at(-1)).toMatchObject({
      url: '/api/v1/users/invitations/accept',
      body: {
        token: 'tok-1',
        fullName: 'Priya Shah',
        password: 'Northwind-26',
      },
    });
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'signed-in' });
  });

  it('says what the name and password need before sending', async () => {
    const { calls, user } = setup({ [PREVIEW]: VALID });

    await join(user, 'P', 'northwind12');

    expect(
      screen.getByText('Enter your full name (at least 2 characters).'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Your password needs an uppercase letter and a symbol.'),
    ).toBeInTheDocument();
    expect(calls).toHaveLength(1);
  });

  it.each([
    [
      'an invalid link',
      {
        [PREVIEW]: ok({
          valid: false,
          organizationName: null,
          inviterName: null,
          email: null,
          roleNames: [],
          expiresAt: null,
        }),
      },
    ],
    ['an unknown token', { [PREVIEW]: fail(404, 'Not found') }],
  ])('%s says it can’t be used, once', async (_, routes) => {
    setup(routes);

    expect(
      await screen.findByRole('heading', {
        name: 'This invitation can’t be used anymore',
      }),
    ).toBeInTheDocument();
  });

  it('a link used up meanwhile says the same on joining', async () => {
    const { user } = setup({
      [PREVIEW]: VALID,
      [ACCEPT]: fail(400, 'This invitation is no longer valid'),
    });

    await join(user, 'Priya Shah', 'Northwind-26');

    expect(
      await screen.findByRole('heading', {
        name: 'This invitation can’t be used anymore',
      }),
    ).toBeInTheDocument();
  });

  it('a workspace out of seats says so, without a countdown', async () => {
    const { user } = setup({
      [PREVIEW]: VALID,
      [ACCEPT]: fail(429, 'This workspace has no seats remaining'),
    });

    await join(user, 'Priya Shah', 'Northwind-26');

    expect(
      await screen.findByText('This workspace has no seats remaining'),
    ).toBeInTheDocument();
  });
});
