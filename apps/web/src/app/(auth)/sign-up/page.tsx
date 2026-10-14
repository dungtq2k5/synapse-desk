import type { Metadata } from 'next';
import { SignInFlow } from '@/components/auth/sign-in-flow';
import { firebaseWebConfig } from '@/lib/firebase-config';
import { HOME } from '@/lib/sign-in';

export const metadata: Metadata = {
  title: 'Create your account · SynapseDesk',
};

/**
 * Sign up. "Continue with Google" signs in at once, so its answer continues
 * through the sign-in legs on this page; a form ends on "Check your email,
 * then sign in".
 */
export default function SignUpPage() {
  return (
    <SignInFlow
      start="sign-up"
      next={HOME}
      notice={null}
      firebase={firebaseWebConfig()}
    />
  );
}
