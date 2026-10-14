'use client';

import {
  ApiError,
  authControllerChangePasswordV1,
  authControllerForgotPasswordV1,
} from '@synapsedesk/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { CircleCheckIcon, InfoIcon, KeyRoundIcon } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Field } from '@/components/auth/field';
import { PasswordChecklist } from '@/components/auth/password-checklist';
import { PasswordInput } from '@/components/auth/password-input';
import { RetryAlert } from '@/components/auth/retry-alert';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { maskEmail, maskedLabel } from '@/lib/codes';
import { passwordNeeds } from '@/lib/password-rules';
import { SectionCard } from './section-card';

type Failure =
  | { kind: 'throttled'; seconds: number | null }
  | { kind: 'other'; message: string };

/** "You were signed out on 2 other devices.", as a changed password says. */
export function signedOutElsewhere(count: number): string {
  if (count === 0) return 'No other devices were signed in.';
  return `You were signed out on ${count === 1 ? '1 other device' : `${count} other devices`}.`;
}

/**
 * The password: change it, or, for someone who has only signed in with
 * Google, set one through the emailed reset link.
 */
export function PasswordSection({
  email,
  hasPassword,
}: {
  email: string;
  hasPassword: boolean;
}) {
  return hasPassword ? (
    <SectionCard
      title="Password"
      lead="Changing it signs you out everywhere else."
    >
      <ChangePassword />
    </SectionCard>
  ) : (
    <SectionCard title="Password">
      <SetPassword email={email} />
    </SectionCard>
  );
}

function ChangePassword() {
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{
    current?: string;
    next?: string;
    confirm?: string;
  }>({});
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState<number | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const currentRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = {
      current: current ? undefined : 'Enter your current password.',
      next: passwordNeeds(next) ?? undefined,
      confirm: next === confirm ? undefined : 'The passwords don’t match.',
    };
    setErrors(found);
    if (found.current) return currentRef.current?.focus();
    if (found.next) return nextRef.current?.focus();
    if (found.confirm) return confirmRef.current?.focus();

    setBusy(true);
    setFailure(null);
    setChanged(null);
    try {
      const answer = await authControllerChangePasswordV1({
        currentPassword: current,
        newPassword: next,
      });
      setChanged(answer.data?.revokedSessionCount ?? 0);
      setCurrent('');
      setNext('');
      setConfirm('');
      void queryClient.invalidateQueries({
        queryKey: ['/api/v1/auth/sessions'],
      });
    } catch (failed) {
      if (failed instanceof ApiError && failed.status === 403) {
        setErrors({ current: 'That’s not your current password.' });
        currentRef.current?.focus();
      } else if (failed instanceof ApiError && failed.status === 400) {
        setErrors({ next: failed.message });
        nextRef.current?.focus();
      } else if (failed instanceof ApiError && failed.status === 429) {
        setFailure({ kind: 'throttled', seconds: failed.retryAfterSeconds });
      } else {
        setFailure({
          kind: 'other',
          message:
            failed instanceof Error ? failed.message : 'Something went wrong.',
        });
      }
    }
    setBusy(false);
  };

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      className="flex max-w-xs flex-col gap-5 sm:max-w-sm"
    >
      {changed !== null && (
        <Alert variant="success" role="status">
          <CircleCheckIcon />
          <AlertTitle>Password changed</AlertTitle>
          <AlertDescription>{signedOutElsewhere(changed)}</AlertDescription>
        </Alert>
      )}
      {failure?.kind === 'throttled' && (
        <RetryAlert
          title="Too many attempts"
          what="changing your password is paused"
          seconds={failure.seconds}
          onOver={() => setFailure(null)}
        />
      )}
      {failure?.kind === 'other' && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Couldn’t change your password</AlertTitle>
          <AlertDescription>{failure.message}</AlertDescription>
        </Alert>
      )}
      <Field
        id="current-password"
        label="Current password"
        error={errors.current}
      >
        {(aria) => (
          <PasswordInput
            ref={currentRef}
            id="current-password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            {...aria}
          />
        )}
      </Field>
      <Field
        id="new-password"
        label="New password"
        error={errors.next}
        description={<PasswordChecklist value={next} />}
      >
        {(aria) => (
          <PasswordInput
            ref={nextRef}
            id="new-password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            {...aria}
          />
        )}
      </Field>
      <Field
        id="confirm-password"
        label="Confirm new password"
        error={errors.confirm}
      >
        {(aria) => (
          <PasswordInput
            ref={confirmRef}
            id="confirm-password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            {...aria}
          />
        )}
      </Field>
      <Button
        type="submit"
        className="self-start"
        disabled={busy}
        aria-busy={busy || undefined}
      >
        {busy ? 'Changing password…' : 'Change password'}
      </Button>
    </form>
  );
}

function SetPassword({ email }: { email: string }) {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const masked = maskEmail(email);

  const send = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await authControllerForgotPasswordV1({ email });
      setSent(true);
    } catch (failed) {
      setFailure(
        failed instanceof ApiError && failed.status === 429
          ? { kind: 'throttled', seconds: failed.retryAfterSeconds }
          : {
              kind: 'other',
              message:
                failed instanceof Error
                  ? failed.message
                  : 'Something went wrong.',
            },
      );
    }
    setBusy(false);
  };

  if (sent) {
    return (
      <Alert variant="success" role="status">
        <CircleCheckIcon />
        <AlertTitle>Check your email</AlertTitle>
        <AlertDescription>
          <span>
            We sent a link to{' '}
            <span aria-label={maskedLabel(masked)}>{masked}</span>. Open it to
            set your password.
          </span>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Alert variant="info">
        <InfoIcon />
        <AlertTitle>You sign in with Google</AlertTitle>
        <AlertDescription>
          Your account doesn’t have a password yet. Set one to sign in with your
          email and password too.
        </AlertDescription>
      </Alert>
      {failure?.kind === 'throttled' && (
        <RetryAlert
          title="Too many requests"
          what="sending is paused"
          seconds={failure.seconds}
          onOver={() => setFailure(null)}
        />
      )}
      {failure?.kind === 'other' && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Couldn’t send the link</AlertTitle>
          <AlertDescription>{failure.message}</AlertDescription>
        </Alert>
      )}
      <Button
        id="set-password"
        variant="outline"
        className="self-start"
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() => void send()}
      >
        <KeyRoundIcon />
        {busy ? 'Sending link…' : 'Set a password'}
      </Button>
    </div>
  );
}
