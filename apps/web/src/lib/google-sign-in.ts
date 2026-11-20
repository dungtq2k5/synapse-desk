import { getApps, initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  type Auth,
} from 'firebase/auth';
import type { FirebaseWebConfig } from './firebase-config';

let auth: Auth | null = null;

/** Firebase Auth for this config, made once per page (and pointed at the emulator when it's set). */
function firebaseAuth(config: FirebaseWebConfig): Auth {
  if (auth) return auth;
  const app =
    getApps()[0] ??
    initializeApp({
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
    });
  auth = getAuth(app);
  if (config.emulatorUrl) {
    connectAuthEmulator(auth, config.emulatorUrl, { disableWarnings: true });
  }
  return auth;
}

/**
 * Google's popup, then the Firebase ID token `POST /auth/google` takes. The
 * popup is Firebase's: Google's own page, or the emulator's in development.
 */
export async function googleIdToken(
  config: FirebaseWebConfig,
): Promise<string> {
  const result = await signInWithPopup(
    firebaseAuth(config),
    new GoogleAuthProvider(),
  );
  return result.user.getIdToken();
}

/**
 * Whether a popup error means the person closed it or opened another: a change
 * of mind, not a failure to report.
 *
 * @example cancelledPopup({ code: 'auth/popup-closed-by-user' }) // true
 */
export function cancelledPopup(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return (
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request'
  );
}
