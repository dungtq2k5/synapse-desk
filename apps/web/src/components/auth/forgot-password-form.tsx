'use client';

import {
  ApiError,
  authControllerForgotPasswordV1,
} from '@synapsedesk/api-client';
import { CircleAlertIcon, MailCheckIcon } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState, type SubmitEvent } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EMAIL } from '@/lib/sign-in';
import { AuthCard } from './auth-card';
import { Field } from './field';
import { RetryAlert } from './retry-alert';

/**
 * Request a reset link. The answer is the same for every address, so the
 * page never says whether an account exists.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<
    | { kind: 'throttled'; seconds: number | null }
    | { kind: 'other'; message: string }
    | null
  >(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const send = async (event?: SubmitEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!EMAIL.test(email.trim())) {
      setError('Enter an email address like name@company.com.');
      emailRef.current?.focus();
      return;
    }
    setError(null);
    setFailure(null);
    setBusy(true);
    try {
      await authControllerForgotPasswordV1({ email: email.trim() });
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
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title="Reset your password"
      lead="Enter your work email and we’ll send you a link to set a new password."
    >
      {failure?.kind === 'throttled' && (
        <RetryAlert
          title="Too many requests"
          what="sending is paused"
          seconds={failure.seconds}
          onOver={() => setFailure(null)}
        />
      )}
      {failure?.kind === 'other' && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Couldn’t send the link</AlertTitle>
          <AlertDescription>{failure.message}</AlertDescription>
        </Alert>
      )}

      {sent ? (
        <>
          <Alert variant="success">
            <MailCheckIcon />
            <AlertTitle>Check your email</AlertTitle>
            <AlertDescription>
              If an account uses that address, we’ve sent a link to set a new
              password.
            </AlertDescription>
          </Alert>
          <p className="text-sm text-muted-foreground">
            Didn’t get it? Check your spam folder, or send it again.
          </p>
          <Button
            variant="outline"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => void send()}
          >
            {busy ? 'Sending…' : 'Send again'}
          </Button>
        </>
      ) : (
        <form
          noValidate
          onSubmit={(event) => void send(event)}
          className="flex flex-col gap-5"
        >
          <Field id="email" label="Email" error={error}>
            {(aria) => (
              <Input
                ref={emailRef}
                id="email"
                type="email"
                autoComplete="username"
                placeholder="name@company.com"
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                {...aria}
              />
            )}
          </Field>
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            {busy ? 'Sending…' : 'Send link'}
          </Button>
        </form>
      )}

      <Link
        href="/login"
        className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        Back to sign in
      </Link>
    </AuthCard>
  );
}
