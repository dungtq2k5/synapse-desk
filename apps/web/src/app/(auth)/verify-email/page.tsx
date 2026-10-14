import type { Metadata } from 'next';
import { EmailVerification } from '@/components/account/email-verification';
import { safeNext } from '@/lib/sign-in';

export const metadata: Metadata = { title: 'Verify your email · SynapseDesk' };

/**
 * Verify your email, after a sign-in with a code still out, or from the
 * banner. `next` is where "Continue" and "Verify later" go.
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  return (
    <EmailVerification next={safeNext(Array.isArray(next) ? next[0] : next)} />
  );
}
