'use client';

import {
  ApiError,
  authControllerResetPasswordV1,
  useAuthControllerValidatePasswordResetTokenV1,
} from '@synapsedesk/api-client';
import { CircleAlertIcon, CircleCheckIcon, CircleXIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { PASSWORD_RULES } from '@/lib/password-rules';
import { announce } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { AuthCard } from './auth-card';
import { Field } from './field';
import { PasswordInput } from './password-input';
import { RetryAlert } from './retry-alert';

/**
 * Set a new password from the emailed link. The link is checked first, so a
 * used or expired one says so before anything is typed. The checklist ticks
 * as the user types; success goes to sign-in.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const check = useAuthControllerValidatePasswordResetTokenV1(token, {
    query: { enabled: token.length > 0, staleTime: 0, gcTime: 0 },
  });
  const [linkDead, setLinkDead] = useState(false);

  if (
    !token ||
    linkDead ||
    check.isError ||
    check.data?.data?.valid === false
  ) {
    return <LinkNoLongerWorks />;
  }
  if (check.isPending) {
    return (
      <AuthCard title="Set a new password" busy>
        <p role="status" className="text-sm text-muted-foreground">
          Checking your link…
        </p>
      </AuthCard>
    );
  }
  return (
    <NewPasswordForm
      token={token}
      email={check.data.data?.email ?? null}
      onLinkDead={() => setLinkDead(true)}
    />
  );
}

function NewPasswordForm({
  token,
  email,
  onLinkDead,
}: {
  token: string;
  email: string | null;
  onLinkDead: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<
    | { kind: 'throttled'; seconds: number | null }
    | { kind: 'other'; message: string }
    | null
  >(null);
  const router = useRouter();
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const met = PASSWORD_RULES.filter((rule) => rule.test(password)).length;

  // One summary once typing pauses, not one per keystroke.
  useEffect(() => {
    if (!password) return;
    const timer = globalThis.setTimeout(
      () => announce(`${met} of ${PASSWORD_RULES.length} rules met`),
      800,
    );
    return () => globalThis.clearTimeout(timer);
  }, [password, met]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (met < PASSWORD_RULES.length) return passwordRef.current?.focus();
    if (password !== confirm) {
      setMismatch(true);
      return confirmRef.current?.focus();
    }
    setMismatch(false);
    setFailure(null);
    setBusy(true);
    try {
      const answer = await authControllerResetPasswordV1({
        token,
        newPassword: password,
      });
      const others = (answer.data?.revokedSessionCount ?? 0) > 0;
      router.push(`/login?reset${others ? '&others=1' : ''}`);
    } catch (failed) {
      setBusy(false);
      if (failed instanceof ApiError && failed.status === 429) {
        setFailure({ kind: 'throttled', seconds: failed.retryAfterSeconds });
      } else if (failed instanceof ApiError && failed.status < 500) {
        onLinkDead();
      } else {
        setFailure({
          kind: 'other',
          message:
            failed instanceof Error ? failed.message : 'Something went wrong.',
        });
      }
    }
  };

  return (
    <AuthCard
      title="Set a new password"
      lead={email ? `For ${email}` : undefined}
    >
      {failure?.kind === 'throttled' && (
        <RetryAlert
          title="Too many attempts"
          what="this is paused"
          seconds={failure.seconds}
          onOver={() => setFailure(null)}
        />
      )}
      {failure?.kind === 'other' && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Couldn’t set the password</AlertTitle>
          <AlertDescription>{failure.message}</AlertDescription>
        </Alert>
      )}
      <form
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-5"
      >
        {/* The account's email, for password managers. */}
        {email && (
          <input
            type="email"
            autoComplete="username"
            value={email}
            readOnly
            hidden
          />
        )}
        <Field
          id="new-password"
          label="New password"
          description={
            <ul className="flex flex-col gap-1">
              {PASSWORD_RULES.map((rule) => {
                const ok = rule.test(password);
                return (
                  <li
                    key={rule.label}
                    aria-label={`${rule.label}, ${ok ? 'met' : 'not met'}`}
                    className="flex items-center gap-2"
                  >
                    {ok ? (
                      <CircleCheckIcon
                        aria-hidden
                        className="size-4 text-success"
                      />
                    ) : (
                      <CircleXIcon aria-hidden className="size-4" />
                    )}
                    {rule.label}
                  </li>
                );
              })}
            </ul>
          }
        >
          {(aria) => (
            <PasswordInput
              ref={passwordRef}
              id="new-password"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              {...aria}
            />
          )}
        </Field>
        <Field
          id="confirm-password"
          label="Confirm new password"
          error={mismatch ? 'The passwords don’t match.' : null}
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
        {mismatch && (
          <span role="alert" className="sr-only">
            The passwords don’t match.
          </span>
        )}
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Setting password…' : 'Set password'}
        </Button>
      </form>
    </AuthCard>
  );
}

function LinkNoLongerWorks() {
  return (
    <AuthCard title="This link no longer works">
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>This link no longer works</AlertTitle>
        <AlertDescription>
          Reset links work once and expire after a while. Send yourself a new
          one.
        </AlertDescription>
      </Alert>
      <Link href="/forgot-password" className={cn(buttonVariants())}>
        Send a new link
      </Link>
      <Link
        href="/login"
        className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        Back to sign in
      </Link>
    </AuthCard>
  );
}
