'use client';

import { CircleAlertIcon } from 'lucide-react';
import { useEffect } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { reportClientError } from '@/lib/client-errors';

/**
 * A console page that failed to render. The console's frame stays; the page
 * says so, offers a retry, and the error is reported.
 */
export default function ConsoleError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  useEffect(() => reportClientError('boundary', error), [error]);

  return (
    <main id="main" className="p-4 md:p-6">
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>
          <h1>This console page didn’t load</h1>
        </AlertTitle>
        <AlertDescription>
          Something went wrong on our side. Nothing was changed. Try again in a
          moment.
          <Button variant="outline" size="sm" onClick={reset}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    </main>
  );
}
