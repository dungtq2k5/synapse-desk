'use client';

import { billingControllerCreatePortalSessionV1 } from '@synapsedesk/api-client';
import { useState } from 'react';
import { leaveFor } from '@/lib/leave';
import { toastError } from '@/lib/toast';

/**
 * Opens Stripe's billing portal in this tab, coming back to Billing: the
 * banner's Update payment, the page's Manage billing and a declined card's
 * fix all go through here. Busy until the browser leaves; a failure is the
 * deck's "Couldn't open Stripe".
 */
export function useOpenPortal() {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      const answer = await billingControllerCreatePortalSessionV1({
        returnUrl: `${globalThis.location.origin}/settings/billing`,
      });
      leaveFor(answer.data.url);
    } catch {
      setBusy(false);
      toastError(
        'Couldn’t open Stripe',
        'Stripe isn’t responding. Try again in a few minutes.',
      );
    }
  };
  return { busy, open };
}
