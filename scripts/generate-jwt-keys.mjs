#!/usr/bin/env node
/**
 * Generates the RS256 key pair the access token is signed and verified with.
 *
 *   node scripts/generate-jwt-keys.mjs
 *
 * WHY TWO KEYS AND NOT A SHARED SECRET
 * ------------------------------------
 * auth-service is the only service allowed to MINT access tokens. Every other
 * service only needs to VERIFY them. With a symmetric secret (HS256) both
 * abilities come together, so a compromised gateway — or ticket-service, or any
 * future service — could forge a token for any user with any permissions.
 *
 * RS256 splits them: auth-service holds the private half and signs; everyone
 * else holds the public half and can only check. The public key is not a secret
 * and can be shipped freely.
 *
 * WHO GETS WHICH
 * --------------
 *   auth-service  JWT_ACCESS_PRIVATE_KEY_PATH -> secrets/jwt-access.key  (SECRET)
 *   api-gateway   JWT_ACCESS_PUBLIC_KEY_PATH  -> secrets/jwt-access.pub  (public)
 *
 * The 2FA challenge token gets its OWN RS256 pair rather than sharing this one —
 * see the PAIRS comment below for why. Same split of abilities:
 *
 *   auth-service  JWT_2FA_PRIVATE_KEY_PATH -> secrets/jwt-2fa.key  (SECRET)
 *   api-gateway   JWT_2FA_PUBLIC_KEY_PATH  -> secrets/jwt-2fa.pub  (public)
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Two INDEPENDENT pairs, not one shared pair.
 *
 * The access token and the 2FA challenge token authorize completely different
 * things — "you are fully authenticated" versus "you have started logging in" —
 * and separate keys mean the signature alone distinguishes them. With one shared
 * pair, a single forgotten claim check anywhere would let a half-authenticated
 * caller pass as a complete one, because both tokens verify identically.
 *
 * It also makes rotation independent: expiring every 2FA challenge (minutes of
 * disruption) no longer means invalidating every access token as well.
 */
const PAIRS = [
  {
    name: 'access',
    private: { app: 'auth-service', file: 'jwt-access.key' },
    publics: [
      { app: 'api-gateway', file: 'jwt-access.pub' },
      // ticket-service and any future verifier get the public half too.
      // Uncomment as they start authenticating requests.
      // { app: 'ticket-service', file: 'jwt-access.pub' },
    ],
  },
  {
    name: '2fa',
    private: { app: 'auth-service', file: 'jwt-2fa.key' },
    publics: [{ app: 'api-gateway', file: 'jwt-2fa.pub' }],
  },
];

const TARGETS = PAIRS.flatMap((pair) => [
  { ...pair.private, pair: pair.name, kind: 'private' },
  ...pair.publics.map((p) => ({ ...p, pair: pair.name, kind: 'public' })),
]);

const force = process.argv.includes('--force');

const existing = TARGETS.map((t) =>
  join(repoRoot, 'apps', t.app, 'secrets', t.file),
).filter(existsSync);

if (existing.length && !force) {
  console.error('Refusing to overwrite existing keys:');
  for (const path of existing) console.error(`  ${path}`);
  console.error(
    '\nRotating the pair invalidates every access token already issued, so this\n' +
      'is opt-in. Re-run with --force if that is what you want.',
  );
  process.exit(1);
}

// One fresh pair per entry in PAIRS. 2048 is the floor worth using for RS256;
// 4096 costs more per verify for no meaningful gain at these token lifetimes.
const generated = new Map(
  PAIRS.map((pair) => [
    pair.name,
    generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    }),
  ]),
);

for (const target of TARGETS) {
  const dir = join(repoRoot, 'apps', target.app, 'secrets');
  const path = join(dir, target.file);
  const { privateKey, publicKey } = generated.get(target.pair);

  mkdirSync(dir, { recursive: true });
  writeFileSync(path, target.kind === 'private' ? privateKey : publicKey);
  // Owner read/write only for the private half; a key readable by every user on
  // the box is not a secret.
  if (target.kind === 'private') chmodSync(path, 0o600);

  console.log(
    `${target.pair.padEnd(6)} ${target.kind.padEnd(7)} -> apps/${target.app}/secrets/${target.file}`,
  );
}

console.log(
  "\nDone. These paths are already the defaults in each service's .env:\n" +
    '  auth-service  JWT_ACCESS_PRIVATE_KEY_PATH = ./secrets/jwt-access.key\n' +
    '  auth-service  JWT_2FA_PRIVATE_KEY_PATH    = ./secrets/jwt-2fa.key\n' +
    '  api-gateway   JWT_ACCESS_PUBLIC_KEY_PATH  = ./secrets/jwt-access.pub\n' +
    '  api-gateway   JWT_2FA_PUBLIC_KEY_PATH     = ./secrets/jwt-2fa.pub\n\n' +
    "Paths resolve relative to each service's working directory, so run each one\n" +
    'from its own folder (npm run dev -w @synapsedesk/<service>).',
);
