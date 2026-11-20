import type { Page } from '@playwright/test';
import {
  AUTH_EMULATOR,
  EMULATOR_PROJECT,
  STORAGE_EMULATOR,
} from '../system/providers';

export { AUTH_EMULATOR };

/**
 * Points the web's Firebase at the emulators: Google sign-in at Auth, and the
 * page policy at Storage, which the browser reaches for photo uploads. The
 * services' side (emulator hosts, the run's own key) is `startStack`'s, for
 * every test stack (`test/system/providers.ts`).
 */
export function useAuthEmulator(): void {
  Object.assign(process.env, {
    FIREBASE_API_KEY: 'emulator-api-key',
    FIREBASE_AUTH_DOMAIN: 'localhost',
    FIREBASE_PROJECT_ID: EMULATOR_PROJECT,
    FIREBASE_AUTH_EMULATOR_URL: AUTH_EMULATOR,
    FIREBASE_STORAGE_EMULATOR_URL: STORAGE_EMULATOR,
  });
}

/**
 * A Firebase ID token for this Google identity, from the emulator without its
 * popup: the emulator accepts an unsigned Google credential.
 */
export async function emulatorIdToken(
  email: string,
  name: string,
): Promise<string> {
  const response = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=emulator-api-key`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        postBody: new URLSearchParams({
          id_token: JSON.stringify({
            sub: `google-${email}`,
            email,
            email_verified: true,
            name,
          }),
          providerId: 'google.com',
        }).toString(),
        requestUri: 'http://localhost',
        returnSecureToken: true,
      }),
    },
  );
  const body = (await response.json()) as { idToken?: string };
  if (!body.idToken) {
    throw new Error(`The Auth emulator gave no token: ${JSON.stringify(body)}`);
  }
  return body.idToken;
}

/**
 * Signs in on the emulator's popup page as a new Google account: its stand-in
 * for Google's own page. It lists the accounts it already has, with "Add new
 * account" (the form, when it has none).
 */
export async function signInInPopup(
  popup: Page,
  email: string,
  name: string,
): Promise<void> {
  // Its buttons work once its scripts (fetched from a CDN) have loaded.
  await popup.waitForLoadState('load');
  const add = popup.getByRole('button', { name: 'Add new account' });
  if (await add.isVisible()) await add.click();
  await popup.locator('#email-input').fill(email);
  await popup.locator('#display-name-input').fill(name);
  await popup.locator('#sign-in').click();
}
