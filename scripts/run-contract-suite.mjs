/**
 * @file Builds the gateway implementation under test, then runs the contract suite.
 *
 *   node scripts/run-contract-suite.mjs            # GATEWAY_IMPL=node
 *   GATEWAY_IMPL=java node scripts/run-contract-suite.mjs
 *
 * **The build is inside the command, deliberately** — plan 80's departure 1.
 * The harness starts a BUILT gateway, so without the build a source change is
 * tested against the previous one; and a built-output check can see an ABSENT
 * build but never a stale one (plan 77 measured that mtime cannot tell them
 * apart). Paying a no-op build is the only answer that is always right.
 *
 * Extra arguments are passed to jest, so `npm run test:contract -- auth`
 * keeps working.
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMPL = process.env.GATEWAY_IMPL ?? 'node';

/** What builds each implementation, from the repository root. */
const BUILDS = {
  node: [
    'npx',
    ['turbo', 'run', 'build', '--filter=@synapsedesk/api-gateway...'],
  ],
  // `-DskipTests`: this command's job is the ARTEFACT. The Java tests are
  // `./mvnw verify`'s, and running them here would make every contract run
  // pay for them twice.
  java: ['./mvnw', ['-q', 'package', '-DskipTests']],
};

const CWD = { node: ROOT, java: join(ROOT, 'apps/api-gateway-java') };

if (!(IMPL in BUILDS)) {
  console.error(
    `GATEWAY_IMPL=${IMPL} is unknown. 'node' and 'java' are the two there will ever be.`,
  );
  process.exit(1);
}

const [command, args] = BUILDS[IMPL];
const build = spawnSync(command, args, {
  cwd: CWD[IMPL],
  stdio: 'inherit',
  env: process.env,
});

if (build.status !== 0) {
  console.error(`Building the ${IMPL} gateway failed; the suite was not run.`);
  process.exit(build.status ?? 1);
}

const jest = spawnSync(
  'npx', // NOSONAR
  [
    'jest',
    '--config',
    'test/gateway-contract/jest.config.ts',
    ...process.argv.slice(2),
  ],
  { cwd: ROOT, stdio: 'inherit', env: { ...process.env, GATEWAY_IMPL: IMPL } },
);

process.exit(jest.status ?? 1);
