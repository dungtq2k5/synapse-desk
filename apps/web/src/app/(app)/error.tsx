'use client';

import { CircleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * A signed-in page whose server render failed for a reason other than an
 * expired session (a 5xx, a timeout). The shell stays; the page says so.
 */
export default function AppError({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="p-4 md:p-6">
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
  );
}
