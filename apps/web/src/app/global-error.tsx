'use client';

import { useEffect } from 'react';
import { reportClientError } from '@/lib/client-errors';
import '@/styles/globals.css';

/**
 * The root layout itself failed, so this replaces the whole document: no
 * shell, no providers. It says so, offers a reload, and reports the error.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  useEffect(() => reportClientError('boundary', error), [error]);

  return (
    <html lang="en">
      <body>
        <main className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            SynapseDesk didn’t load
          </h1>
          <p className="text-muted-foreground">
            Something went wrong on our side. Reload the page, or try again in a
            moment.
          </p>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm"
            onClick={reset}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
