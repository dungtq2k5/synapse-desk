/**
 * @file The third parties a test stack talks to: never the real ones.
 *
 * A service reads its `.env` at start, and a developer's `.env` holds real
 * keys. Neither `dotenv` nor Nest's `ConfigModule` replaces a variable that is
 * already set, so writing the test values into this process's environment
 * before the services spawn is what keeps them off the real providers:
 * Resend's fake, Stripe's fake, and the Firebase emulators (Auth and Storage).
 *
 * Gemini isn't here: test runs may call it with the key in `.env`, by the
 * user's decision; `test:e2e:web` turns on the offline models itself.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { FAKE_RESEND_API_KEY, FAKE_RESEND_URL } from './fake-resend';
import { useFakeStripe } from './fake-stripe';
import { REPO_ROOT } from './services';

/** Compose's Firebase emulators (the `firebase` service). */
export const AUTH_EMULATOR = 'http://localhost:9099';
export const STORAGE_EMULATOR = 'http://localhost:9199';

/** The emulators' project: their tokens name it as their audience. */
export const EMULATOR_PROJECT = 'synapsedesk-test';

/**
 * The run's own service-account key, made for the emulators' project: a real
 * project's key refuses the emulator's tokens, and a developer's real key is
 * never read or touched.
 */
const EMULATOR_KEY = join(REPO_ROOT, 'test/system/.firebase/emulator-key.json');

/**
 * Writes every provider's test values into this process's environment, which
 * the stack's services inherit.
 */
export function useTestProviders(): void {
  useFakeStripe();
  execFileSync(
    'node',
    ['scripts/generate-storage-emulator-key.mjs', EMULATOR_KEY],
    { cwd: REPO_ROOT, stdio: 'ignore' },
  );
  Object.assign(process.env, {
    RESEND_BASE_URL: FAKE_RESEND_URL,
    RESEND_API_KEY: FAKE_RESEND_API_KEY,
    RESEND_GATEWAY_API_KEY: FAKE_RESEND_API_KEY,
    FIREBASE_AUTH_EMULATOR_HOST: new URL(AUTH_EMULATOR).host,
    FIREBASE_SERVICE_ACCOUNT_PATH: EMULATOR_KEY,
    FIREBASE_PROJECT_ID: EMULATOR_PROJECT,
    FIREBASE_STORAGE_EMULATOR_HOST: new URL(STORAGE_EMULATOR).host,
    FIREBASE_STORAGE_SERVICE_ACCOUNT_PATH: EMULATOR_KEY,
    FIREBASE_STORAGE_BUCKET: `${EMULATOR_PROJECT}.appspot.com`,
  });
}

const isLocal = (value: string | undefined): boolean => {
  if (!value) return false;
  const host = value.includes('://')
    ? new URL(value).hostname
    : value.split(':')[0];
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
};

/**
 * What in this environment would reach a real provider: one line each, empty
 * when nothing would. Read before any service spawns.
 *
 * @example realProviders({ RESEND_API_KEY: 're_live' }) // ['Resend: …']
 */
export function realProviders(env: NodeJS.ProcessEnv = process.env): string[] {
  const found: string[] = [];
  const resendKeys = ['RESEND_API_KEY', 'RESEND_GATEWAY_API_KEY'].filter(
    (name) => env[name],
  );
  if (resendKeys.length > 0 && !isLocal(env.RESEND_BASE_URL)) {
    found.push(
      `Resend: ${resendKeys.join(' and ')} set, and RESEND_BASE_URL is ${env.RESEND_BASE_URL ? `not local (${env.RESEND_BASE_URL})` : "unset, so Resend's real API"}.`,
    );
  }
  if (env.STRIPE_SECRET_KEY && !isLocal(env.STRIPE_API_BASE_URL)) {
    found.push(
      `Stripe: STRIPE_SECRET_KEY set, and STRIPE_API_BASE_URL is ${env.STRIPE_API_BASE_URL ? `not local (${env.STRIPE_API_BASE_URL})` : "unset, so Stripe's real API"}.`,
    );
  }
  if (!isLocal(env.FIREBASE_AUTH_EMULATOR_HOST)) {
    found.push(
      'Firebase Auth: FIREBASE_AUTH_EMULATOR_HOST is not a local emulator, so the real project.',
    );
  }
  if (!isLocal(env.FIREBASE_STORAGE_EMULATOR_HOST)) {
    found.push(
      'Firebase Storage: FIREBASE_STORAGE_EMULATOR_HOST is not a local emulator, so the real bucket.',
    );
  }
  return found;
}
