/**
 * `firebase/app` and `firebase/auth` in unit tests: their Node build needs
 * globals jsdom doesn't have, and no unit test talks to Firebase. A row that
 * needs Google's answer mocks `@/lib/google-sign-in`; the real popup is the
 * e2e rows' (against the Auth emulator).
 */
const unavailable = () => {
  throw new Error('Firebase isn’t available in unit tests');
};

export const getApps = () => [];
export const initializeApp = unavailable;
export const getAuth = unavailable;
export const connectAuthEmulator = unavailable;
export const signInWithPopup = unavailable;
export class GoogleAuthProvider {}
