import type { Metadata } from 'next';
import { SignInFlow } from '@/components/auth/sign-in-flow';
import { firebaseWebConfig } from '@/lib/firebase-config';
import { safeNext } from '@/lib/sign-in';

export const metadata: Metadata = {
  title: 'Create your account · SynapseDesk',
};

type Search = Record<string, string | string[] | undefined>;

/**
 * Sign up. "Continue with Google" signs in at once, so its answer continues
 * through the sign-in legs on this page and lands on `next` (the landing
 * page's Choose {plan} sends `/settings/billing?choose=…`). A form ends on
 * "Check your email, then sign in", and its sign-in link carries no `next`:
 * on `/login` one reads as "Your session ended".
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const next = (await searchParams).next;

  return (
    <SignInFlow
      start="sign-up"
      next={safeNext(Array.isArray(next) ? next[0] : next)}
      notice={null}
      firebase={firebaseWebConfig()}
    />
  );
}
