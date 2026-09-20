/**
 * @file Starts this workspace's gateway only if it is the SELECTED implementation.
 *
 *   node scripts/gateway-impl.mjs node    # from apps/api-gateway
 *   node scripts/gateway-impl.mjs java    # from apps/api-gateway-java
 *
 * **Why each workspace calls this instead of starting itself.** `npm run dev`
 * is `turbo run dev`, which runs the task in EVERY workspace that declares
 * one. With both gateways declaring a plain `dev`, two gateways start on one
 * `PORT` — and both claim the implementation lease, so one stands by and the
 * symptom reads as a bug in the lease rather than as two processes. Each
 * workspace declares `dev`, and the one that is not selected exits 0 without
 * starting anything.
 *
 * `GATEWAY_IMPL` chooses; unset means `node`, so `npm run dev` is unchanged
 * for anyone not working on the Java gateway.
 *
 * **It also reads the `.env` file**, which is the other half of J1: Spring
 * does not read `.env` files (measured — plan 81 section 9), and nothing was
 * added to make it. Under Kubernetes and Compose the values are already
 * environment variables; locally this is the one loader, in the language that
 * already has the parser.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SELECTED = process.env.GATEWAY_IMPL ?? 'node';
const MINE = process.argv[2];

/** How each implementation is started in development. */
const STARTS = {
  node: {
    command: 'npx',
    args: ['nest', 'start', '--watch'],
    cwd: join(ROOT, 'apps/api-gateway'),
  },
  java: {
    command: './mvnw',
    args: ['-q', 'spring-boot:run'],
    cwd: join(ROOT, 'apps/api-gateway-java'),
  },
};

if (!(MINE in STARTS)) {
  console.error(
    `Pass the calling workspace's implementation: ${Object.keys(STARTS).join(' | ')}.`,
  );
  process.exit(1);
}

if (!(SELECTED in STARTS)) {
  console.error(
    `GATEWAY_IMPL=${SELECTED} is unknown. 'node' and 'java' are the two there will ever be.`,
  );
  process.exit(1);
}

if (MINE !== SELECTED) {
  // Not an error, and not silent: a developer who expected this gateway to
  // start should be able to see why it did not.
  console.log(`Not starting the ${MINE} gateway: GATEWAY_IMPL=${SELECTED}`);
  process.exit(0);
}

// The file's values do NOT win over the real environment: an operator who
// exported `PORT` for one run meant it.
const envFile = join(ROOT, '.env');
const fromFile = existsSync(envFile)
  ? parseEnv(readFileSync(envFile, 'utf8'))
  : {};
const environment = { ...fromFile, ...process.env };
const { command, args, cwd } = STARTS[MINE];

console.log(`Starting the ${MINE} gateway`);

const child = spawn(command, args, { cwd, stdio: 'inherit', env: environment });

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
