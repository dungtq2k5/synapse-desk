'use client';

import {
  CircleAlertIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useEffect, useRef, type FormEvent } from 'react';
import { CodeSlots } from '@/components/auth/two-step-code';
import { RetryAlert } from '@/components/auth/retry-alert';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { countdown, maskedLabel, wrongCode } from '@/lib/codes';
import { minutesFrom } from '@/lib/sign-in';
import type { CodeProblem, useCodeChallenge } from './use-code-challenge';

/** "We sent a 6-digit code to m***a@northwind.health. It expires in 10 minutes." */
export function SentTo({
  challenge,
}: {
  challenge: NonNullable<ReturnType<typeof useCodeChallenge>['challenge']>;
}) {
  return (
    <>
      We sent a {challenge.codeLength}-digit code to{' '}
      <span aria-label={maskedLabel(challenge.target)}>{challenge.target}</span>
      . It expires in {challenge.expiresInMinutes} minutes.
    </>
  );
}

function problemText(problem: CodeProblem | null): string | null {
  switch (problem?.kind) {
    case 'wrong':
      return wrongCode(problem.attemptsRemaining);
    case 'out-of-attempts':
      return 'Too many incorrect attempts. Request a new code.';
    case 'expired':
      return 'That code has expired. Send yourself a new one.';
    default:
      return null;
  }
}

/**
 * The code field and everything around it, for an emailed or texted code: the
 * slots (as many as the code has digits), what went wrong, Verify or "Request
 * a new code", and the resend line with its wait.
 */
export function CodeEntry({
  state,
  after,
}: {
  state: ReturnType<typeof useCodeChallenge>;
  /** Below the resend line, e.g. "Verify later". */
  after?: React.ReactNode;
}) {
  const codeRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<HTMLButtonElement>(null);
  const { challenge, problem, spent, limited } = state;
  const busy = state.phase === 'verifying' || state.phase === 'sending';
  const message = problemText(problem);

  // The slots wait for the code to be known, so they take focus when it is.
  const known = Boolean(challenge);
  useEffect(() => {
    if (known) codeRef.current?.focus();
  }, [known]);

  // A wrong code: back to the first slot. A spent one: to "Request a new code".
  useEffect(() => {
    if (problem?.kind === 'wrong') codeRef.current?.focus();
    if (spent) requestRef.current?.focus();
  }, [problem, spent]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (challenge && state.code.length === challenge.codeLength) {
      void state.check(state.code);
    }
  };

  return (
    <>
      {limited && (
        <Alert variant="warning" role="alert">
          <TriangleAlertIcon />
          <AlertTitle>Too many code requests</AlertTitle>
          <AlertDescription>
            You can request another code in {minutesFrom(limited.seconds)}{' '}
            minutes. The last code we sent still works.
          </AlertDescription>
        </Alert>
      )}
      {problem?.kind === 'paused' && (
        <RetryAlert
          title="Too many attempts"
          what="verification is paused"
          seconds={problem.seconds}
          onOver={() => undefined}
        />
      )}
      {problem?.kind === 'failed' && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{problem.message}</AlertDescription>
        </Alert>
      )}
      <form noValidate onSubmit={submit} className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <CodeSlots
            spaced
            inputRef={codeRef}
            length={challenge?.codeLength ?? 6}
            value={state.code}
            onChange={state.setCode}
            onComplete={(value) => void state.check(value)}
            invalid={Boolean(message)}
            disabled={spent || !challenge}
            describedBy={message ? 'code-error' : undefined}
          />
          {message && (
            <p
              id="code-error"
              role="alert"
              className="flex items-start gap-1.5 text-sm text-destructive"
            >
              <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              {message}
            </p>
          )}
        </div>
        {spent ? (
          <Button
            ref={requestRef}
            type="button"
            disabled={busy}
            onClick={() => void state.send()}
          >
            <RefreshCwIcon />
            Request a new code
          </Button>
        ) : (
          <Button
            type="submit"
            disabled={busy || !challenge}
            aria-busy={state.phase === 'verifying' || undefined}
          >
            {state.phase === 'verifying' ? 'Verifying…' : 'Verify'}
          </Button>
        )}
      </form>
      {!spent && (
        <p className="text-sm text-muted-foreground">
          Didn’t get it?{' '}
          {state.resendIn > 0 ? (
            `Resend code in ${countdown(state.resendIn)}`
          ) : (
            <Button
              variant="link"
              className="h-auto p-0"
              disabled={busy}
              onClick={() => void state.send()}
            >
              Resend code
            </Button>
          )}
        </p>
      )}
      {after}
    </>
  );
}
