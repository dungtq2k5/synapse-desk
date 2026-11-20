'use client';

import {
  otpControllerGetOtpStatusV1,
  otpControllerRequestEmailVerificationV1,
  otpControllerVerifyEmailV1,
} from '@synapsedesk/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { CircleCheckIcon, MailCheckIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { Button } from '@/components/ui/button';
import { useViewer } from '@/hooks/use-viewer';
import { maskEmail } from '@/lib/codes';
import { announce } from '@/lib/toast';
import { CodeEntry, SentTo } from './code-entry';
import { useCodeChallenge } from './use-code-challenge';

const status = async () =>
  (await otpControllerGetOtpStatusV1({ purpose: 'EMAIL_VERIFICATION' })).data;
const request = async () =>
  (await otpControllerRequestEmailVerificationV1()).data;
const verify = async (code: string) =>
  (await otpControllerVerifyEmailV1({ code })).data;

/**
 * Verify your email: the code already sent (at sign-up) or a new one, then
 * "Email verified" and on to `next`. "Verify later" goes there now.
 */
export function EmailVerification({ next }: { next: string }) {
  const queryClient = useQueryClient();
  const { user } = useViewer();
  const title = useRef<HTMLHeadingElement>(null);
  const state = useCodeChallenge({
    status,
    request,
    verify,
    onVerified: () => {
      announce('Email verified.');
      void queryClient.invalidateQueries({
        queryKey: ['/api/v1/users/me'],
      });
    },
  });
  const go = () => globalThis.location.assign(next);

  useEffect(() => {
    if (state.phase === 'verified') title.current?.focus();
  }, [state.phase]);

  if (state.phase === 'verified') {
    return (
      <AuthCard
        icon={<CircleCheckIcon />}
        title="Email verified"
        titleRef={title}
        lead="Thanks. You can now invite people to your organization."
      >
        <Button onClick={go}>Continue</Button>
      </AuthCard>
    );
  }

  const sending = state.phase === 'loading' || state.phase === 'sending';
  const target = user ? maskEmail(user.email) : 'your email';
  return (
    <AuthCard
      icon={<MailCheckIcon />}
      title="Verify your email"
      busy={(sending && !state.challenge) || undefined}
      lead={
        state.challenge ? (
          <SentTo challenge={state.challenge} />
        ) : (
          sending && <span role="status">Sending a code to {target}…</span>
        )
      }
    >
      <CodeEntry
        state={state}
        after={
          <Button variant="ghost" className="self-start" onClick={go}>
            Verify later
          </Button>
        }
      />
    </AuthCard>
  );
}
