import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi, type Reply } from '@/test/api';
import '@/test/dom';
import { EmailVerification } from './email-verification';

const STATUS = 'GET /api/v1/auth/otp/status';
const REQUEST = 'POST /api/v1/auth/email/verify/request';
const VERIFY = 'POST /api/v1/auth/email/verify';

const ME = ok({
  user: { email: 'maya@northwind.health', isEmailVerified: false },
  permissionCodes: [],
  departmentIds: [],
  hasPassword: true,
});
const PENDING = ok({
  pending: true,
  target: 'm***a@northwind.health',
  expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  attemptsRemaining: 5,
  codeLength: 6,
});
const NONE = ok({
  pending: false,
  target: null,
  expiresAt: null,
  attemptsRemaining: 0,
  codeLength: 6,
});
const SENT = ok(
  { target: 'm***a@northwind.health', expiresInMinutes: 10, codeLength: 6 },
  202,
);

const setup = (routes: Record<string, Reply>) => {
  const calls = stubApi({ 'GET /api/v1/users/me': ME, ...routes });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <EmailVerification next="/tickets" />
    </QueryClientProvider>,
  );
  return { calls, user: userEvent.setup() };
};

const code = () => screen.getByLabelText('Verification code');
const LEAD =
  /^We sent a 6-digit code to m\*\*\*a@northwind\.health\. It expires in 10 minutes\.$/;
/** The lead, whose masked address is its own element. */
const lead = () =>
  screen.findByText((_, element) =>
    element?.tagName === 'P' ? LEAD.test(element.textContent ?? '') : false,
  );

describe('verify your email', () => {
  it('uses the code already sent, without sending another', async () => {
    const { calls } = setup({ [STATUS]: PENDING });

    expect(await lead()).toBeInTheDocument();
    expect(calls.some(({ url }) => url.includes('/verify/request'))).toBe(
      false,
    );
  });

  it('sends a code when none is out, then waits a minute before another', async () => {
    const { calls } = setup({ [STATUS]: NONE, [REQUEST]: SENT });

    expect(await lead()).toBeInTheDocument();
    expect(
      calls.filter(({ url }) => url.includes('/verify/request')),
    ).toHaveLength(1);
    expect(screen.getByText(/Resend code in (1:00|0:59)/)).toBeInTheDocument();
  });

  it('a wrong code says how many attempts are left', async () => {
    const { user } = setup({
      [STATUS]: PENDING,
      [VERIFY]: ok({
        verified: false,
        attemptsRemaining: 3,
        mustRequestNewCode: false,
      }),
    });
    await lead();

    await user.type(code(), '481920');

    expect(
      await screen.findByText('That code is wrong. You have 3 attempts left.'),
    ).toBeInTheDocument();
  });

  it('too many incorrect attempts offers a new code at once', async () => {
    const { user } = setup({
      [STATUS]: PENDING,
      [VERIFY]: fail(429, 'Too many incorrect attempts. Request a new code.'),
    });
    await lead();

    await user.type(code(), '481920');

    expect(
      await screen.findByText(
        'Too many incorrect attempts. Request a new code.',
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Request a new code' }),
      ).toHaveFocus(),
    );
    expect(code()).toBeDisabled();
  });

  it('an expired code asks for a new one', async () => {
    const { user } = setup({
      [STATUS]: PENDING,
      [VERIFY]: fail(
        400,
        'No verification code is pending. Request a new one.',
      ),
    });
    await lead();

    await user.type(code(), '481920');

    expect(
      await screen.findByText(
        'That code has expired. Send yourself a new one.',
      ),
    ).toBeInTheDocument();
  });

  it('too many code requests keeps the last code usable and waits as told', async () => {
    const { user } = setup({
      [STATUS]: PENDING,
      [REQUEST]: fail(429, 'Too many requests', { 'retry-after': '480' }),
    });
    await lead();

    await user.click(screen.getByRole('button', { name: 'Resend code' }));

    expect(
      await screen.findByText('Too many code requests'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'You can request another code in 8 minutes. The last code we sent still works.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Resend code in (8:00|7:59)/)).toBeInTheDocument();
    expect(code()).toBeEnabled();
  });

  it('verified: says so, with focus on the heading', async () => {
    const { user } = setup({
      [STATUS]: PENDING,
      [VERIFY]: ok({
        verified: true,
        attemptsRemaining: 4,
        mustRequestNewCode: false,
      }),
    });
    await lead();

    await user.type(code(), '481920');

    expect(
      await screen.findByRole('heading', { name: 'Email verified' }),
    ).toHaveFocus();
    expect(
      screen.getByRole('button', { name: 'Continue' }),
    ).toBeInTheDocument();
  });
});
