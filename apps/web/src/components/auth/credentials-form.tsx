'use client';

import { ApiError, authControllerLoginV1 } from '@synapsedesk/api-client';
import { CircleAlertIcon, InfoIcon, CircleCheckIcon } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { deviceName, EMAIL, signInStep, type SignInStep } from '@/lib/sign-in';
import { AuthCard } from './auth-card';
import { Field } from './field';
import { PasswordInput } from './password-input';
import { RetryAlert } from './retry-alert';
import type { SignInNotice } from './sign-in-flow';

type Failure =
  | { kind: 'credentials' }
  | { kind: 'throttled'; seconds: number | null }
  | { kind: 'other'; message: string };

/** The first leg: email and password, with why the user is here. */
export function CredentialsForm({
  notice,
  email,
  onEmail,
  onAnswer,
}: {
  notice: SignInNotice;
  email: string;
  onEmail: (email: string) => void;
  onAnswer: (step: SignInStep) => void;
}) {
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>(
    {},
  );
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = {
      email: EMAIL.test(email.trim())
        ? undefined
        : 'Enter an email address like name@company.com.',
      password: password ? undefined : 'Enter your password.',
    };
    setErrors(found);
    if (found.email) return emailRef.current?.focus();
    if (found.password) return passwordRef.current?.focus();

    setBusy(true);
    setFailure(null);
    try {
      const answer = await authControllerLoginV1({
        email: email.trim(),
        password,
        deviceName: deviceName(navigator.userAgent),
      });
      if (!answer.data) throw new Error('The sign-in answer had no data');
      onAnswer(signInStep(answer.data));
    } catch (error) {
      setBusy(false);
      setFailure(failureOf(error));
      emailRef.current?.focus();
    }
  };

  return (
    <AuthCard title="Sign in" lead="Use your work email and password.">
      <NoticeAlert notice={notice} />
      {failure?.kind === 'credentials' && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Email or password is incorrect</AlertTitle>
          <AlertDescription>Check both and try again.</AlertDescription>
        </Alert>
      )}
      {failure?.kind === 'throttled' && (
        <RetryAlert
          title="Too many sign-in attempts"
          what="sign-in is paused"
          seconds={failure.seconds}
          onOver={() => setFailure(null)}
        />
      )}
      {failure?.kind === 'other' && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Couldn’t sign in</AlertTitle>
          <AlertDescription>{failure.message}</AlertDescription>
        </Alert>
      )}

      <form
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-5"
      >
        <Field id="email" label="Email" error={errors.email}>
          {(aria) => (
            <Input
              ref={emailRef}
              id="email"
              type="email"
              autoComplete="username"
              placeholder="name@company.com"
              autoFocus
              value={email}
              onChange={(event) => onEmail(event.target.value)}
              {...aria}
            />
          )}
        </Field>
        <Field
          id="password"
          label="Password"
          error={errors.password}
          labelAside={
            <Link
              href="/forgot-password"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Forgot password?
            </Link>
          }
        >
          {(aria) => (
            <PasswordInput
              ref={passwordRef}
              id="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              {...aria}
            />
          )}
        </Field>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthCard>
  );
}

function failureOf(error: unknown): Failure {
  if (error instanceof ApiError && error.status === 401) {
    return { kind: 'credentials' };
  }
  if (error instanceof ApiError && error.status === 429) {
    return { kind: 'throttled', seconds: error.retryAfterSeconds };
  }
  return {
    kind: 'other',
    message:
      error instanceof ApiError
        ? error.message
        : 'Check your connection and try again.',
  };
}

function NoticeAlert({ notice }: { notice: SignInNotice }) {
  switch (notice) {
    case 'session-ended':
      return (
        <Alert variant="info">
          <InfoIcon />
          <AlertTitle>Your session ended</AlertTitle>
          <AlertDescription>
            Sign in again to pick up where you left off.
          </AlertDescription>
        </Alert>
      );
    case 'signed-out':
      return (
        <Alert variant="info">
          <InfoIcon />
          <AlertTitle>You’ve signed out</AlertTitle>
        </Alert>
      );
    case 'reset':
    case 'reset-signed-out-elsewhere':
      return (
        <Alert variant="success">
          <CircleCheckIcon />
          <AlertTitle>Your password is changed</AlertTitle>
          <AlertDescription>
            Sign in with your new password.
            {notice === 'reset-signed-out-elsewhere' &&
              ' You’ve been signed out on your other devices.'}
          </AlertDescription>
        </Alert>
      );
    default:
      return null;
  }
}
