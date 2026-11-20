'use client';

import { CircleAlertIcon } from 'lucide-react';
import { useEffect } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { reportClientError } from '@/lib/client-errors';

/**
 * A sign-in screen that failed to render. The lockup stays (the layout); the
 * column says so, offers a retry, and the error is reported.
 */
export default function AuthError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  useEffect(() => reportClientError('boundary', error), [error]);

  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>
        <h1>This page didn’t load</h1>
      </AlertTitle>
      <AlertDescription>
        Something went wrong on our side. Try again in a moment.
        <Button variant="outline" size="sm" onClick={reset}>
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}
