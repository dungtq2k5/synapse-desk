'use client';

import { authControllerGoogleSignInV1 } from '@synapsedesk/api-client';
import { useState } from 'react';
import type { FirebaseWebConfig } from '@/lib/firebase-config';
import { cancelledPopup, googleIdToken } from '@/lib/google-sign-in';
import { deviceName, signInStep, type SignInStep } from '@/lib/sign-in';

/**
 * "Continue with Google": Google's popup, then `POST /auth/google` with its ID
 * token, answered with the same legs as a password sign-in (signed in, a
 * two-step code or setup, a choice of organization). Closing the popup isn't
 * a failure; anything else is, and says so until the next try.
 */
export function useGoogleSignIn(
  firebase: FirebaseWebConfig | null,
  onAnswer: (step: SignInStep) => void,
) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const start = async () => {
    if (!firebase) return;
    setBusy(true);
    setFailed(false);
    try {
      const idToken = await googleIdToken(firebase);
      const answer = await authControllerGoogleSignInV1({
        idToken,
        deviceName: deviceName(navigator.userAgent),
      });
      if (!answer.data)
        throw new Error('The Google sign-in answer had no data');
      onAnswer(signInStep(answer.data));
    } catch (error) {
      setBusy(false);
      if (!cancelledPopup(error)) setFailed(true);
    }
  };

  return { available: firebase !== null, busy, failed, start };
}
