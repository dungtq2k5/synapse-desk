'use client';

import type { TenantOptionResponseDto } from '@synapsedesk/api-client';
import { useState } from 'react';
import type { FirebaseWebConfig } from '@/lib/firebase-config';
import { keepTwoStepWarning } from '@/lib/two-step-warning';
import { afterSignIn, type SignInStep } from '@/lib/sign-in';
import { ChooseOrganization } from './choose-organization';
import { CredentialsForm } from './credentials-form';
import { InvitationAccept } from './invitation-accept';
import { SignUpForm } from './sign-up-form';
import { TwoStepCode } from './two-step-code';
import { TwoStepSetup } from './two-step-setup';

/** Why the sign-in page was opened, shown above the form. */
export type SignInNotice =
  | 'session-ended'
  | 'signed-out'
  | 'reset'
  | 'reset-signed-out-elsewhere'
  | null;

type Step =
  | { kind: 'credentials' }
  | { kind: 'code'; justEnrolled: boolean }
  | { kind: 'setup' }
  | { kind: 'tenant'; tenants: TenantOptionResponseDto[] };

/**
 * Sign-in and every leg the server may ask for next, on one page: email and
 * password, then (as answered) a choice of organization, a two-step code, or
 * two-step setup. Signed in, it goes to `next` with a full page load, so the
 * app renders with the new cookies.
 */
export function SignInFlow({
  next,
  notice,
  firebase = null,
  start = 'sign-in',
  invitationToken = '',
}: {
  next: string;
  notice: SignInNotice;
  /** Google sign-in's config, or null when it isn't set up. */
  firebase?: FirebaseWebConfig | null;
  /**
   * The first screen: sign in, sign up (whose Google answer goes on through
   * these legs), or accept an invitation (joining signs in).
   */
  start?: 'sign-in' | 'sign-up' | 'invitation';
  invitationToken?: string;
}) {
  const [step, setStep] = useState<Step>({ kind: 'credentials' });
  const [email, setEmail] = useState('');

  const finish = async (warning?: string | null) => {
    if (warning) keepTwoStepWarning(warning);
    globalThis.location.assign(await afterSignIn(next));
  };
  const advance = (answer: SignInStep) => {
    if (answer.kind === 'signed-in') void finish();
    else if (answer.kind === 'code')
      setStep({ kind: 'code', justEnrolled: false });
    else setStep(answer);
  };
  const back = () => setStep({ kind: 'credentials' });

  switch (step.kind) {
    case 'credentials':
      if (start === 'sign-up') {
        return <SignUpForm firebase={firebase} onAnswer={advance} />;
      }
      if (start === 'invitation') {
        return <InvitationAccept token={invitationToken} onAnswer={advance} />;
      }
      return (
        <CredentialsForm
          notice={notice}
          email={email}
          onEmail={setEmail}
          onAnswer={advance}
          firebase={firebase}
        />
      );
    case 'tenant':
      return (
        <ChooseOrganization
          email={email}
          tenants={step.tenants}
          onAnswer={advance}
          onBack={back}
        />
      );
    case 'code':
      return (
        <TwoStepCode
          justEnrolled={step.justEnrolled}
          onSignedIn={(warning) => void finish(warning)}
          onBack={back}
        />
      );
    case 'setup':
      return (
        <TwoStepSetup
          onEnrolled={(signedIn) =>
            signedIn
              ? void finish()
              : setStep({ kind: 'code', justEnrolled: true })
          }
          onBack={back}
        />
      );
  }
}
