'use client';

import { ApiError, authControllerRegisterV1 } from '@synapsedesk/api-client';
import { CircleAlertIcon, CircleCheckIcon, UserPlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { FirebaseWebConfig } from '@/lib/firebase-config';
import { passwordNeeds } from '@/lib/password-rules';
import { EMAIL, type SignInStep } from '@/lib/sign-in';
import { cn } from '@/lib/utils';
import { AuthCard } from './auth-card';
import { Field } from './field';
import { GoogleButton } from './google-button';
import { OrDivider } from './or-divider';
import { PasswordChecklist } from './password-checklist';
import { PasswordInput } from './password-input';
import { RetryAlert } from './retry-alert';
import { useGoogleSignIn } from './use-google-sign-in';

type Errors = { fullName?: string; email?: string; password?: string };

/**
 * Create an account: Google, or a name, a work email and a password. Every
 * valid form ends on the same screen, "Check your email, then sign in": the
 * server answers a taken address as it answers a new one, so this never says
 * which it was.
 */
export function SignUpForm({
  firebase = null,
  onAnswer,
}: {
  firebase?: FirebaseWebConfig | null;
  /** What a Google sign-up answered: the sign-in legs continue from here. */
  onAnswer: (step: SignInStep) => void;
}) {
  const google = useGoogleSignIn(firebase, onAnswer);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<
    | { kind: 'throttled'; seconds: number | null }
    | { kind: 'other'; message: string }
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found: Errors = {
      fullName:
        fullName.trim().length >= 2
          ? undefined
          : 'Enter your full name (at least 2 characters).',
      email: EMAIL.test(email.trim())
        ? undefined
        : 'Enter an email address like name@company.com.',
      password: passwordNeeds(password) ?? undefined,
    };
    setErrors(found);
    if (found.fullName) return nameRef.current?.focus();
    if (found.email) return emailRef.current?.focus();
    if (found.password) return passwordRef.current?.focus();

    setBusy(true);
    setFailure(null);
    try {
      await authControllerRegisterV1({
        email: email.trim(),
        password,
        fullName: fullName.trim(),
      });
      setDone(email.trim());
    } catch (error) {
      setBusy(false);
      setFailure(
        error instanceof ApiError && error.status === 429
          ? { kind: 'throttled', seconds: error.retryAfterSeconds }
          : {
              kind: 'other',
              message:
                error instanceof ApiError
                  ? error.message
                  : 'Check your connection and try again.',
            },
      );
    }
  };

  if (done) {
    return (
      <div aria-live="polite">
        <AuthCard
          icon={<CircleCheckIcon />}
          title="Check your email, then sign in"
          titleRef={doneRef}
          lead={`We’ve sent a message to ${done}. Then sign in to continue. If we need to verify your address, you’ll be asked for a code.`}
        >
          <Link href="/login" className={cn(buttonVariants())}>
            Sign in
          </Link>
        </AuthCard>
      </div>
    );
  }

  return (
    <AuthCard
      icon={<UserPlusIcon />}
      title="Create your account"
      lead="Use your work email."
    >
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
      {google.failed && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Couldn’t sign in with Google</AlertTitle>
          <AlertDescription>
            Try again, or sign in with your email and password.
          </AlertDescription>
        </Alert>
      )}
      {failure?.kind === 'throttled' && (
        <RetryAlert
          title="Too many attempts"
          what="sign-up is paused"
          seconds={failure.seconds}
          onOver={() => setFailure(null)}
        />
      )}
      {failure?.kind === 'other' && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Couldn’t create your account</AlertTitle>
          <AlertDescription>{failure.message}</AlertDescription>
        </Alert>
      )}

      <form
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-5"
      >
        <Field id="full-name" label="Full name" error={errors.fullName}>
          {(aria) => (
            <Input
              ref={nameRef}
              id="full-name"
              autoComplete="name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              {...aria}
            />
          )}
        </Field>
        <Field
          id="email"
          label="Work email"
          error={errors.email}
          // The error takes the rule's place while the address is wrong.
          description={
            errors.email
              ? undefined
              : 'If your organization already uses SynapseDesk, you’ll join it. If not, you’ll set up a new organization and be its admin.'
          }
        >
          {(aria) => (
            <Input
              ref={emailRef}
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              {...aria}
            />
          )}
        </Field>
        <Field
          id="password"
          label="Password"
          error={errors.password}
          description={<PasswordChecklist value={password} />}
        >
          {(aria) => (
            <PasswordInput
              ref={passwordRef}
              id="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              {...aria}
            />
          )}
        </Field>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link
          href="/login"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
