import type { Metadata } from 'next';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';

export const metadata: Metadata = { title: 'Set a new password · SynapseDesk' };

/**
 * Opened from the reset email: `/reset-password?token=…`, the path the
 * contracts package's `WEB_ROUTES.resetPassword` gives auth-service.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await searchParams;
  return (
    <ResetPasswordForm
      token={(Array.isArray(token) ? token[0] : token) ?? ''}
    />
  );
}
