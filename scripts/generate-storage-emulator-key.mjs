/**
 * @file A throwaway service-account key for a Firebase SDK that must initialize
 * without reaching Google.
 *
 * **Two consumers, and only one of them is an emulator.** storage-service
 * points the SDK at the Storage emulator; auth-service's `FirebaseService`
 * calls `cert(keyPath)` at `onModuleInit` and then never reaches Google in a
 * test run, because every auth e2e spies on `verifyGoogleIdToken`. `cert()`
 * parses the JSON and the PEM and makes no network call, so a synthetic
 * credential satisfies both — `npm run keys:service-account` writes one per
 * service.
 *
 * The emulator never verifies the signature — it accepts any well-formed
 * credential — but `firebase-admin` refuses to initialize without one, and V4
 * signing needs a private key present locally to sign with. So the key has to
 * be real RSA and must not be real Google credentials.
 *
 * Generated rather than committed, for the obvious reason: a private key in the
 * repository is a private key in every clone, and the fact that this one is
 * worthless is not something a scanner (or a future reader) can tell at a
 * glance.
 *
 * Mirrors scripts/generate-jwt-keys.mjs's one-off-script convention. Unlike
 * that script this one is idempotent-by-default rather than refusing: it exits
 * 0 when the target exists, so a CI step can run it unconditionally.
 */

import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(
  process.cwd(),
  process.argv[2] ?? 'apps/storage-service/serviceAccountKey.json',
);

if (existsSync(OUT) && !process.argv.includes('--force')) {
  console.log(`${OUT} already exists; pass --force to overwrite.`);
  process.exit(0);
}

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      type: 'service_account',
      project_id: 'synapsedesk-test',
      private_key_id: 'emulator-only',
      private_key: privateKey,
      client_email: 'storage-emulator@synapsedesk-test.iam.gserviceaccount.com',
      client_id: '000000000000000000000',
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
    },
    null,
    2,
  ) + '\n',
);

console.log(`Wrote an EMULATOR-ONLY service account to ${OUT}`);
console.log(
  'This key is worthless outside the emulator. Never use it against a real project.',
);
