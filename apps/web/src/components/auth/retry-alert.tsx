'use client';

import { CircleAlertIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { minutesFrom } from '@/lib/sign-in';

/**
 * A 429, counting down from `Retry-After`. It goes once the wait is over.
 * Without `Retry-After` (auth-service's own 429s) it says to wait a few
 * minutes instead.
 *
 * @example <RetryAlert title="Too many sign-in attempts" what="sign-in is paused" seconds={error.retryAfterSeconds} />
 */
export function RetryAlert({
  title,
  what,
  seconds,
  onOver,
}: {
  title: string;
  /** "sign-in is paused", "verification is paused", "sending is paused". */
  what: string;
  seconds: number | null;
  onOver?: () => void;
}) {
  const [left, setLeft] = useState(seconds);

  useEffect(() => {
    if (left === null) return;
    if (left <= 0) {
      onOver?.();
      return;
    }
    const timer = globalThis.setTimeout(() => setLeft(left - 1), 1000);
    return () => globalThis.clearTimeout(timer);
  }, [left, onOver]);

  if (left === null) {
    return (
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>Too many attempts</AlertTitle>
        <AlertDescription>
          For your security, this is paused. Wait a few minutes, then try again.
        </AlertDescription>
      </Alert>
    );
  }
  if (left <= 0) return null;

  const minutes = minutesFrom(left);
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        For your security, {what}. Try again in {minutes}{' '}
        {minutes === 1 ? 'minute' : 'minutes'}.
      </AlertDescription>
    </Alert>
  );
}
