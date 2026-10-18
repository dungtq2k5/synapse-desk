import { ApiError, authControllerLoginV1 } from '@synapsedesk/api-client';
import { CircleAlertIcon, InfoIcon, CircleCheckIcon } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState, type SubmitEvent } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { FirebaseWebConfig } from '@/lib/firebase-config';
import { deviceName, EMAIL, signInStep, type SignInStep } from '@/lib/sign-in';
import { AuthCard } from './auth-card';
import { Field } from './field';
import { GoogleButton } from './google-button';
import { OrDivider } from './or-divider';
import { PasswordInput } from './password-input';
import { RetryAlert } from './retry-alert';
import type { SignInNotice } from './sign-in-flow';
import { useGoogleSignIn } from './use-google-sign-in';

type Failure =
  | { kind: 'credentials' }
  | { kind: 'throttled'; seconds: number | null }
  | { kind: 'frozen' }
  | { kind: 'other'; message: string };

/**
 * The first leg: Google (when it's configured), or email and password, with
 * why the user is here.
 */
export function CredentialsForm({
  notice,
  email,
  onEmail,
  onAnswer,
  firebase = null,
}: {
  notice: SignInNotice;
  email: string;
  onEmail: (email: string) => void;
  onAnswer: (step: SignInStep) => void;
  firebase?: FirebaseWebConfig | null;
}) {
  const google = useGoogleSignIn(firebase, onAnswer);
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>(
    {},
  );
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
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
      {google.available && (
        <>
          <GoogleButton
            disabled={google.busy || busy}
            aria-busy={google.busy || undefined}
            onClick={() => void google.start()}
          />
          <OrDivider />
        </>
      )}
      <NoticeAlert notice={notice} />
      {google.failed && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Couldn’t sign in with Google</AlertTitle>
          <AlertDescription>
            Try again, or sign in with your email and password.
          </AlertDescription>
        </Alert>
      )}
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
      {failure?.kind === 'frozen' && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Your organization is closed for now</AlertTitle>
          <AlertDescription>
            Its administrator asked to delete it. If that’s a surprise, contact
            them or SynapseDesk support.
          </AlertDescription>
        </Alert>
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
      <p className="text-sm text-muted-foreground">
        Don’t have an account?{' '}
        <Link
          href="/sign-up"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Sign up
        </Link>
      </p>
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
  // The server's answer for a frozen organization names neither it nor why.
  if (
    error instanceof ApiError &&
    error.status === 403 &&
    /frozen|temporarily disabled/i.test(error.message)
  ) {
    return { kind: 'frozen' };
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
  if (
    typeof notice === 'object' &&
    notice !== null &&
    'organizationDeleted' in notice
  ) {
    return (
      <Alert variant="info">
        <InfoIcon />
        <AlertTitle>{notice.organizationDeleted} is being deleted</AlertTitle>
        <AlertDescription>
          Everyone was signed out, you included. A platform administrator will
          finish the deletion, or reverse it if it was a mistake.
        </AlertDescription>
      </Alert>
    );
  }
  if (typeof notice === 'object' && notice !== null) {
    const ended =
      notice.everywhere === 1 ? '1 session' : `${notice.everywhere} sessions`;
    return (
      <Alert variant="info">
        <InfoIcon />
        <AlertTitle>You’ve signed out everywhere</AlertTitle>
        <AlertDescription>
          {ended} ended. Sign in again to continue.
        </AlertDescription>
      </Alert>
    );
  }
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
