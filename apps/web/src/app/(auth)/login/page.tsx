import type { Metadata } from 'next';
import { SignInFlow, type SignInNotice } from '@/components/auth/sign-in-flow';
import { safeNext } from '@/lib/sign-in';

export const metadata: Metadata = { title: 'Sign in · SynapseDesk' };

type Search = Record<string, string | string[] | undefined>;

/**
 * Sign-in, with every leg after it on the same page. The query says why the
 * user is here: `next` (sent back from inside the app: the session ended),
 * `signed-out`, or `reset` (a new password, `others=1` when other devices
 * were signed out).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const search = await searchParams;
  const one = (key: string) => {
    const value = search[key];
    return Array.isArray(value) ? value[0] : value;
  };

  return <SignInFlow next={safeNext(one('next'))} notice={noticeOf(one)} />;
}

function noticeOf(one: (key: string) => string | undefined): SignInNotice {
  if (one('reset') !== undefined) {
    return one('others') === '1' ? 'reset-signed-out-elsewhere' : 'reset';
  }
  if (one('signed-out') !== undefined) return 'signed-out';
  if (one('next') !== undefined) return 'session-ended';
  return null;
}
