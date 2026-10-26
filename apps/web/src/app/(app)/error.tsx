'use client';

import { CircleAlertIcon } from 'lucide-react';
import { useEffect } from 'react';
import { AppHeader } from '@/components/shell/app-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { reportClientError } from '@/lib/client-errors';

/**
 * A signed-in page whose server render failed for a reason other than an
 * expired session (a 5xx, a timeout). The shell stays; the page says so, and
 * the error is reported.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  useEffect(() => reportClientError('boundary', error), [error]);
  // The pages draw their own header, so the error screen draws it too: the
  // sidebar button, the crumbs and Sign out are the way out.
  return (
    <>
      <AppHeader crumbs={[]} />
      <main id="main" tabIndex={-1} className="p-4 outline-none md:p-6">
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>
            <h1>Something went wrong</h1>
          </AlertTitle>
          <AlertDescription>
            Something went wrong on our side. Try again in a moment.
            <Button variant="outline" size="sm" onClick={reset}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </main>
    </>
  );
}
