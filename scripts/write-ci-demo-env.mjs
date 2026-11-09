/**
 * @file The demo stack's env files and secrets for CI: every value a real
 * provider would read is a placeholder, and every credential is synthetic.
 *
 *     CI_DEMO_DIR=/an/existing/absolute/dir node scripts/write-ci-demo-env.mjs
 *
 * Writes, under `CI_DEMO_DIR` only: `env/<service>.env` from
 * `deploy/demo/env/<service>.env.example` (the overrides below replace or add
 * keys) and `secrets/`: two JWT key pairs and a synthetic Firebase service
 * account. `deploy/demo/ci-stack.sh` makes that directory, runs the demo's
 * compose file with it as the project directory (so the file's `env/` and
 * `./secrets` paths resolve there) and removes it afterwards. It takes no
 * argument; it exits 1 unless `CI_DEMO_DIR` is an absolute path to an existing
 * directory.
 *
 * Google sign-in points at the Firebase emulator that
 * `deploy/demo/compose.ci.yaml` adds. Storage, Stripe, Resend and Gemini get keys that
 * look right and reach nothing: a service validates their shape at boot and
 * calls them only when a request needs them.
 */
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const examples = join(repoRoot, 'deploy/demo/env');

const out = process.env.CI_DEMO_DIR ?? '';
if (
  !isAbsolute(out) ||
  !statSync(out, { throwIfNoEntry: false })?.isDirectory()
) {
  console.error(
    'usage: CI_DEMO_DIR=<an existing absolute directory> node scripts/write-ci-demo-env.mjs',
  );
  process.exit(1);
}

const hex = (bytes) => randomBytes(bytes).toString('hex');
// Gateway and notification-service must share it.
const inboundSecret = hex(32);

const OVERRIDES = {
  'api-gateway': {
    INBOUND_EMAIL_SECRET: inboundSecret,
    RESEND_WEBHOOK_SECRET: `whsec_${randomBytes(24).toString('base64')}`,
    RESEND_GATEWAY_API_KEY: 're_ci_placeholder',
  },
  'auth-service': {
    TWO_FACTOR_MASTER_KEY: hex(32),
    STRIPE_SECRET_KEY: 'sk_test_ci_placeholder',
    STRIPE_WEBHOOK_SECRET: 'whsec_ci_placeholder',
    SUPER_ADMIN_PASSWORD: `Ci-${hex(12)}`,
    FIREBASE_AUTH_EMULATOR_HOST: 'firebase:9099',
  },
  'notification-service': {
    INBOUND_EMAIL_SECRET: inboundSecret,
    RESEND_API_KEY: 're_ci_placeholder',
  },
  // No emulator host: storage refuses one under NODE_ENV=production, as every
  // deployment sets it. The synthetic account and a bucket nobody owns let it
  // start; nothing at boot reaches Google.
  'storage-service': {
    FIREBASE_STORAGE_BUCKET: 'synapsedesk-ci.appspot.com',
  },
  'ingestion-service': { GEMINI_API_KEY: 'ci-placeholder' },
  'rag-service': { GEMINI_API_KEY: 'ci-placeholder' },
};

mkdirSync(join(out, 'env'), { recursive: true });
for (const file of readdirSync(examples)) {
  const service = file.match(/^(.+)\.env\.example$/)?.[1];
  if (!service) continue;
  const overrides = { ...OVERRIDES[service] };
  const lines = readFileSync(join(examples, file), 'utf8')
    .split('\n')
    .map((line) => {
      const key = line.match(/^([A-Z0-9_]+)\s*=/)?.[1];
      if (!key || !(key in overrides)) return line;
      const value = overrides[key];
      delete overrides[key];
      return `${key} = ${value}`;
    });
  for (const [key, value] of Object.entries(overrides)) {
    lines.push(`${key} = ${value}`);
  }
  writeFileSync(join(out, 'env', `${service}.env`), lines.join('\n'));
}

// Readable by the containers' own user, which isn't the runner's: these keys
// sign nothing outside this run.
const secrets = join(out, 'secrets');
mkdirSync(secrets, { recursive: true });
for (const name of ['access', '2fa']) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  writeFileSync(join(secrets, `jwt-${name}.key`), privateKey, { mode: 0o644 });
  writeFileSync(join(secrets, `jwt-${name}.pub`), publicKey, { mode: 0o644 });
}
execFileSync(
  process.execPath,
  [
    join(repoRoot, 'scripts/generate-storage-emulator-key.mjs'),
    join(secrets, 'serviceAccountKey.json'),
    '--force',
  ],
  { stdio: 'inherit' },
);

console.log(`CI env files and secrets written to ${out}`);
