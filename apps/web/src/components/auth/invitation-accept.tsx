'use client';

import {
  ApiError,
  invitationsControllerAcceptV1,
  useInvitationsControllerPreviewByTokenV1,
} from '@synapsedesk/api-client';
import { CircleAlertIcon, LockIcon, UserPlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState, type SubmitEvent } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { andList, calendarDate } from '@/lib/format';
import { passwordNeeds } from '@/lib/password-rules';
import { deviceName, signInStep, type SignInStep } from '@/lib/sign-in';
import { cn } from '@/lib/utils';
import { AuthCard } from './auth-card';
import { Field } from './field';
import { PasswordChecklist } from './password-checklist';
import { PasswordInput } from './password-input';
import { RetryAlert } from './retry-alert';

/**
 * Accept an invitation from its emailed link: the link is checked first, then
 * a name and a password join the inviting organization and sign in. Used,
 * expired, revoked and unknown links all say one thing.
 */
export function InvitationAccept({
  token,
  onAnswer,
}: {
  token: string;
  /** Joining signs in; the sign-in legs continue from its answer. */
  onAnswer: (step: SignInStep) => void;
}) {
  const preview = useInvitationsControllerPreviewByTokenV1(token, {
    query: { enabled: token.length > 0, staleTime: 0, gcTime: 0, retry: false },
  });
  const [dead, setDead] = useState(false);
  const invitation = preview.data?.data;

  if (!token || dead || preview.isError || invitation?.valid === false) {
    return <CantBeUsed />;
  }
  if (preview.isPending || !invitation) {
    return (
      <AuthCard title="Checking your invitation…" busy>
        <p role="status" className="text-sm text-muted-foreground">
          This takes a moment.
        </p>
      </AuthCard>
    );
  }
  return (
    <JoinForm
      token={token}
      organization={invitation.organizationName ?? 'your organization'}
      inviter={invitation.inviterName}
      email={invitation.email}
      roles={invitation.roleNames}
      expiresAt={invitation.expiresAt}
      onAnswer={onAnswer}
      onDead={() => setDead(true)}
    />
  );
}

function JoinForm({
  token,
  organization,
  inviter,
  email,
  roles,
  expiresAt,
  onAnswer,
  onDead,
}: {
  token: string;
  organization: string;
  inviter: string | null;
  email: string | null;
  roles: string[];
  expiresAt: string | null;
  onAnswer: (step: SignInStep) => void;
  onDead: () => void;
}) {
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{
    fullName?: string;
    password?: string;
  }>({});
  const [failure, setFailure] = useState<
    | { kind: 'throttled'; seconds: number | null }
    | { kind: 'other'; message: string }
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = {
      fullName:
        fullName.trim().length >= 2
          ? undefined
          : 'Enter your full name (at least 2 characters).',
      password: passwordNeeds(password) ?? undefined,
    };
    setErrors(found);
    if (found.fullName) return nameRef.current?.focus();
    if (found.password) return passwordRef.current?.focus();

    setBusy(true);
    setFailure(null);
    try {
      const answer = await invitationsControllerAcceptV1({
        token,
        fullName: fullName.trim(),
        password,
        deviceName: deviceName(navigator.userAgent),
      });
      if (!answer.data) throw new Error('The answer had no data');
      onAnswer(signInStep(answer.data));
    } catch (error) {
      setBusy(false);
      if (
        error instanceof ApiError &&
        error.status === 429 &&
        error.retryAfterSeconds !== null
      ) {
        setFailure({ kind: 'throttled', seconds: error.retryAfterSeconds });
      } else if (error instanceof ApiError && error.status === 400) {
        // "This invitation is no longer valid": used, revoked or expired since
        // it was checked. (A 429 without a wait is the workspace out of seats,
        // and a 409 an address that already has an account: their messages.)
        onDead();
      } else {
        setFailure({
          kind: 'other',
          message:
            error instanceof ApiError
              ? error.message
              : 'Check your connection and try again.',
        });
      }
    }
  };

  const lead = inviter
    ? `${inviter} invited you to join ${organization}${roles.length ? ` as ${andList(roles)}` : ''}.`
    : `You’re invited to join ${organization}.`;

  return (
    <AuthCard
      icon={<UserPlusIcon />}
      title={`Join ${organization}`}
      lead={lead}
    >
      {failure?.kind === 'throttled' && (
        <RetryAlert
          title="Too many attempts"
          what="joining is paused"
          seconds={failure.seconds}
          onOver={() => setFailure(null)}
        />
      )}
      {failure?.kind === 'other' && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Couldn’t join {organization}</AlertTitle>
          <AlertDescription>{failure.message}</AlertDescription>
        </Alert>
      )}
      <form
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-5"
      >
        {email && (
          <Field
            id="email"
            label="Email"
            description="The address you were invited at. You can’t change it here."
          >
            {(aria) => (
              <div className="relative">
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  readOnly
                  value={email}
                  className="bg-muted pr-9 text-muted-foreground"
                  {...aria}
                />
                <LockIcon
                  aria-hidden
                  className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
                />
              </div>
            )}
          </Field>
        )}
        <Field id="full-name" label="Full name" error={errors.fullName}>
          {(aria) => (
            <Input
              ref={nameRef}
              id="full-name"
              autoComplete="name"
              placeholder="Your name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
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
          {busy ? 'Joining…' : `Join ${organization}`}
        </Button>
      </form>
      {expiresAt && (
        <p className="text-sm text-muted-foreground">
          This invitation expires on {calendarDate(expiresAt)}.
        </p>
      )}
    </AuthCard>
  );
}

function CantBeUsed() {
  return (
    <AuthCard
      icon={<CircleAlertIcon />}
      title="This invitation can’t be used anymore"
      lead="Ask the person who invited you to send a new one."
    >
      <Link
        href="/login"
        className={cn(buttonVariants({ variant: 'outline' }))}
      >
        Go to sign in
      </Link>
    </AuthCard>
  );
}
