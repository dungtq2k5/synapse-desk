'use client';

import { TriangleAlertIcon, XIcon } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  dismissTwoStepWarning,
  readTwoStepWarning,
} from '@/lib/two-step-warning';

/**
 * The warning a two-step sign-in answered with, verbatim from the server
 * ("You have 2 backup code(s) left…"), kept until the user dismisses it.
 */
export function TwoStepWarning() {
  // Session storage exists only in the browser: none while rendering on the server.
  const stored = useSyncExternalStore(
    noChanges,
    readTwoStepWarning,
    () => null,
  );
  const [dismissed, setDismissed] = useState(false);
  const warning = dismissed ? null : stored;

  if (!warning) return null;
  return (
    <div className="px-4 pt-4 md:px-6">
      <Alert variant="warning" className="pr-12">
        <TriangleAlertIcon />
        <AlertTitle>Backup codes running low</AlertTitle>
        <AlertDescription>{warning}</AlertDescription>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Dismiss"
          className="absolute top-2 right-2"
          onClick={() => {
            dismissTwoStepWarning();
            setDismissed(true);
          }}
        >
          <XIcon />
        </Button>
      </Alert>
    </div>
  );
}

/** Nothing else writes the warning while the app is open. */
function noChanges(): () => void {
  return () => undefined;
}
