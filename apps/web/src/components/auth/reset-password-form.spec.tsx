import { createQueryClient } from '@synapsedesk/api-client';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi, type Reply } from '@/test/api';
import { ResetPasswordForm } from './reset-password-form';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const CHECK = 'GET /api/v1/auth/password/reset/tok-1';
const RESET = 'POST /api/v1/auth/password/reset';
const VALID = ok({ valid: true, email: 'priya@acme.example' });
const GOOD = 'Correct-Horse1';

const setup = (routes: Record<string, Reply>, token = 'tok-1') => {
  const calls = stubApi(routes);
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ResetPasswordForm token={token} />
    </QueryClientProvider>,
  );
  return { calls, user: userEvent.setup() };
};

const fill = async (
  user: ReturnType<typeof userEvent.setup>,
  password: string,
  confirm = password,
) => {
  await user.type(await screen.findByLabelText('New password'), password);
  await user.type(screen.getByLabelText('Confirm new password'), confirm);
  await user.click(screen.getByRole('button', { name: 'Set password' }));
};

const deadLink = () =>
  screen.findByRole('heading', { name: 'This link no longer works' });

describe('the reset-password form', () => {
  beforeEach(() => push.mockReset());
  afterEach(() => jest.useRealTimers());

  it('checks the link first', async () => {
    setup({ [CHECK]: VALID });
    expect(screen.getByRole('status')).toHaveTextContent('Checking your link…');
    expect(
      await screen.findByText('For priya@acme.example'),
    ).toBeInTheDocument();
  });

  it('says a link with no token no longer works, without asking', async () => {
    const { calls } = setup({}, '');
    expect(await deadLink()).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Send a new link' }),
    ).toHaveAttribute('href', '/forgot-password');
    expect(calls).toEqual([]);
  });

  it('says a used or expired link no longer works', async () => {
    setup({ [CHECK]: ok({ valid: false }) });
    expect(await deadLink()).toBeInTheDocument();
  });

  it('says so when the link can’t be checked', async () => {
    setup({ [CHECK]: fail(404, 'Not found') });
    expect(await deadLink()).toBeInTheDocument();
  });

  it('ticks each rule as the password meets it', async () => {
    const { user } = setup({ [CHECK]: VALID });

    await user.type(await screen.findByLabelText('New password'), 'abc');

    expect(
      screen.getByLabelText('A lowercase letter, met'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('At least 8 characters, not met'),
    ).toBeInTheDocument();
  });

  it('announces the rules met once typing pauses', async () => {
    jest.useFakeTimers();
    const announcer = document.createElement('div');
    announcer.id = 'announcer-polite';
    document.body.append(announcer);
    setup({ [CHECK]: VALID });
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    await user.type(await screen.findByLabelText('New password'), 'abc');
    act(() => jest.advanceTimersByTime(800 + 50));

    expect(announcer).toHaveTextContent('1 of 5 rules met');
    announcer.remove();
  });

  it('sends nothing until every rule is met', async () => {
    const { calls, user } = setup({ [CHECK]: VALID });

    await fill(user, 'short');

    expect(screen.getByLabelText('New password')).toHaveFocus();
    expect(calls).toHaveLength(1);
  });

  it('says when the two passwords don’t match', async () => {
    const { calls, user } = setup({ [CHECK]: VALID });

    await fill(user, GOOD, 'Correct-Horse2');

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The passwords don’t match.',
    );
    expect(screen.getByLabelText('Confirm new password')).toHaveFocus();
    expect(calls).toHaveLength(1);
  });

  it('sets the password and goes to sign-in', async () => {
    const { calls, user } = setup({
      [CHECK]: VALID,
      [RESET]: ok({ revokedSessionCount: 0 }),
    });

    await fill(user, GOOD);

    expect(push).toHaveBeenCalledWith('/login?reset');
    expect(calls[1].body).toEqual({ token: 'tok-1', newPassword: GOOD });
  });

  it('tells sign-in when other devices were signed out', async () => {
    const { user } = setup({
      [CHECK]: VALID,
      [RESET]: ok({ revokedSessionCount: 2 }),
    });

    await fill(user, GOOD);

    expect(push).toHaveBeenCalledWith('/login?reset&others=1');
  });

  it('a link refused on submit no longer works', async () => {
    const { user } = setup({
      [CHECK]: VALID,
      [RESET]: fail(400, 'Token expired'),
    });

    await fill(user, GOOD);

    expect(await deadLink()).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('counts down the pause after too many attempts', async () => {
    const { user } = setup({
      [CHECK]: VALID,
      [RESET]: fail(429, 'Too many requests', { 'retry-after': '60' }),
    });

    await fill(user, GOOD);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'For your security, this is paused. Try again in 1 minute.',
    );
  });

  it('shows the server’s message when it fails on its side', async () => {
    const { user } = setup({
      [CHECK]: VALID,
      [RESET]: fail(503, 'Auth is down for maintenance'),
    });

    await fill(user, GOOD);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t set the password',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Auth is down for maintenance',
    );
  });
});
