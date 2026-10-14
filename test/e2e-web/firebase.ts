import { execFileSync } from 'node:child_process';
import type { Page } from '@playwright/test';
import { join } from 'node:path';
import { REPO_ROOT } from '../system/services';

/** Compose's Auth emulator (the `firebase` service). */
export const AUTH_EMULATOR = 'http://localhost:9099';
/** Its Storage emulator, in the same container. */
const STORAGE_EMULATOR = 'http://localhost:9199';

/** The emulator's project: its tokens name it as their audience. */
const PROJECT = 'synapsedesk-test';

/**
 * Points Google sign-in at the Auth emulator for the whole stack (the web's
 * Firebase config, and auth-service's emulator host and service-account key),
 * and photo uploads at the Storage emulator.
 * The key is generated for the emulator's project, since a real project's key
 * refuses the emulator's tokens; it's the run's own, so a developer's real key
 * isn't touched. Only auth-service reads these two, and only the web the rest.
 */
export function useAuthEmulator(): void {
  const key = join(REPO_ROOT, 'test/e2e-web/.firebase/auth-emulator-key.json');
  execFileSync('node', ['scripts/generate-storage-emulator-key.mjs', key], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
  });
  Object.assign(process.env, {
    FIREBASE_AUTH_EMULATOR_HOST: new URL(AUTH_EMULATOR).host,
    FIREBASE_SERVICE_ACCOUNT_PATH: key,
    FIREBASE_API_KEY: 'emulator-api-key',
    FIREBASE_AUTH_DOMAIN: 'localhost',
    FIREBASE_PROJECT_ID: PROJECT,
    FIREBASE_AUTH_EMULATOR_URL: AUTH_EMULATOR,
    // Storage too: storage-service signs uploads for the emulator, and the
    // web's page policy lets the browser reach it.
    FIREBASE_STORAGE_EMULATOR_HOST: new URL(STORAGE_EMULATOR).host,
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
