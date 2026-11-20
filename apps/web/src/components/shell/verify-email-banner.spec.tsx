import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ok, stubApi } from '@/test/api';
import { VerifyEmailBanner } from './verify-email-banner';

jest.mock('next/navigation', () => ({ usePathname: () => '/tickets/42' }));

const me = (isEmailVerified: boolean) =>
  ok({
    user: { email: 'priya@northwind.health', isEmailVerified },
    permissionCodes: [],
    departmentIds: [],
    hasPassword: true,
  });

const setup = (isEmailVerified: boolean) => {
  stubApi({ 'GET /api/v1/users/me': me(isEmailVerified) });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <VerifyEmailBanner />
    </QueryClientProvider>,
  );
};

describe('the verify-email banner', () => {
  beforeEach(() => sessionStorage.clear());

  it('asks an unverified person to verify, coming back here after', async () => {
    setup(false);

    const banner = await screen.findByRole('region', {
      name: 'Email verification',
    });
    expect(banner).toHaveTextContent('Verify your email to invite people');
    expect(screen.getByRole('link', { name: 'Verify now' })).toHaveAttribute(
      'href',
      '/verify-email?next=%2Ftickets%2F42',
    );
  });

  it('isn’t shown once the email is verified', async () => {
    const { container } = setup(true);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(container).toBeEmptyDOMElement();
  });

  it('stays dismissed for the session', async () => {
    setup(false);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole('button', { name: 'Dismiss for now' }),
    );
    expect(screen.queryByRole('region')).toBeNull();

    setup(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('region')).toBeNull();
  });
});
