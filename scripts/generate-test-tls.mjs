#!/usr/bin/env node
/**
 * Generates the self-signed TLS pair the e2e suites' localhost receivers listen
 * with — `receiver-key.pem` and `receiver-cert.pem`.
 *
 *   node scripts/generate-test-tls.mjs [--force]
 *
 * WHY THIS EXISTS AS A SCRIPT
 * ---------------------------
 * Two suites start an `https` server on an ephemeral port and point production
 * code at it: notification-service's outbound-webhook sender, and
 * storage-service's remote-source fetcher. `createServer` needs a key and a
 * cert on disk, `.gitignore` excludes `*.pem`, and until this script existed
 * nothing created them. The result was a pair that lived only on the machine
 * that had once made them by hand: green locally, and on a fresh clone — every
 * CI run included — a suite that fails with ENOENT before its first assertion.
 *
 * GENERATED, NOT COMMITTED, unlike the test JWT keypair two lines above it in
 * `.gitignore`. That exception exists because a signature has two sides: a
 * fixture signed with whatever key was lying around still verifies, so the
 * suite passes while testing nothing. Nothing verifies THIS cert — the sender's
 * dev hatch relaxes certificate checking, a localhost receiver being
 * self-signed by nature — so there is no such silence to prevent, and a
 * committed server cert would instead carry an expiry date into the repository.
 *
 * WHY `openssl` AND NOT `node:crypto`
 * -----------------------------------
 * Node can generate the key but cannot issue a certificate: `X509Certificate`
 * parses, it does not sign. The alternative is a dependency whose only use is
 * this file.
 */
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every fixture directory that holds a receiver pair, in repo-relative form. */
const TARGETS = [
  'apps/notification-service/test/fixtures',
  'apps/storage-service/test/fixtures',
];

const KEY = 'receiver-key.pem';
const CERT = 'receiver-cert.pem';

const force = process.argv.includes('--force');

const paths = TARGETS.map((dir) => ({
  dir: join(repoRoot, dir),
  key: join(repoRoot, dir, KEY),
  cert: join(repoRoot, dir, CERT),
  label: dir,
}));

/**
 * Present AND still valid — the two halves of "there is nothing to do".
 *
 * Checking the date rather than only the filename is what makes a ten-year
 * certificate safe to leave on a developer's disk: the day it expires, the next
 * run replaces it instead of handing the suite a TLS error to be debugged.
 */
const usable = paths.every(({ key, cert }) => {
  if (!existsSync(key) || !existsSync(cert)) return false;
  try {
    return (
      new Date(new X509Certificate(readFileSync(cert)).validTo) > new Date()
    );
  } catch {
    return false;
  }
});

if (usable && !force) {
  console.log(
    `Receiver TLS pair already present and unexpired in ${TARGETS.length} fixture ` +
      'directories. Re-run with --force to replace it.',
  );
  process.exit(0);
}

const [first, ...rest] = paths;
mkdirSync(first.dir, { recursive: true });

// 3650 days, because the only cost of a long life here is the check above, and
// a fixture that expires mid-sprint is a failure nobody reads as "regenerate".
// CN and SAN are `localhost`: the receivers bind dual-stack and the code under
// test connects by name.
try {
  execFileSync(
    'openssl', // NOSONAR
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '3650',
      '-keyout',
      first.key,
      '-out',
      first.cert,
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
} catch (error) {
  console.error(
    'Could not generate the receiver TLS pair. `openssl` must be on PATH — it ' +
      'ships with every supported dev platform and with the CI image.\n',
  );
  console.error(error.stderr?.toString() ?? error.message);
  process.exit(1);
}

chmodSync(first.key, 0o600);

// One pair, copied — the two suites never talk to each other, so nothing needs
// them to differ, and one certificate is one thing to reason about.
for (const target of rest) {
  mkdirSync(target.dir, { recursive: true });
  copyFileSync(first.key, target.key);
  copyFileSync(first.cert, target.cert);
  chmodSync(target.key, 0o600);
}

for (const { label } of paths) {
  console.log(`receiver pair -> ${label}/{${KEY},${CERT}}`);
}
