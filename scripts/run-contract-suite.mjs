/**
 * @file Builds the gateway implementation under test, then runs the contract suite.
 *
 *   node scripts/run-contract-suite.mjs            # GATEWAY_IMPL=node
 *   GATEWAY_IMPL=java node scripts/run-contract-suite.mjs
 *
 * **The build is inside the command, deliberately.**
 * The harness starts a BUILT gateway, so without the build a source change is
 * tested against the previous one; and a built-output check can see an ABSENT
 * build but never a stale one (measured: mtime cannot tell them apart).
 * Paying a no-op build is the only answer that is always right.
 *
 * Extra arguments are passed to jest, so `npm run test:contract -- auth`
 * keeps working.
 *
 * **`CONTRACT_SHARDS=N` runs the suite as N concurrent invocations** (`--shard=k/N`),
 * after ONE build. Each starts its own Redis and NATS and its gateways take ephemeral
 * ports, which `test/gateway-contract/jest.config.ts` says concurrent invocations are
 * built for. Measured on the Java arm: 1263 s serial, 383 s as 6 shards and 390 s as
 * 5, with identical counts. A shard runs its files in the same relative order as the
 * serial run, so sharding can only SEPARATE rows that shared state, never put new ones
 * together: a row that passes only because its polluter moved to another shard is the
 * risk, and the serial run stays the oracle for anything arrangement-dependent.
 *
 * **The two arms must not overlap while one of them builds.** The Node arm's
 * cross-implementation cache row boots the Java jar too, and the Java arm's build
 * rewrites that jar: measured, a Node run started beside a Java run lost a class from
 * the jar in the second it was written, and two rows failed for no reason of their own.
 */

import { spawn, spawnSync } from 'node:child_process';
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

const JEST = ['jest', '--config', 'test/gateway-contract/jest.config.ts'];
const SHARDS = Number(process.env.CONTRACT_SHARDS ?? 1);
const ENV = { ...process.env, GATEWAY_IMPL: IMPL };

if (SHARDS > 1) {
  // Each shard's output is printed as one block when it ends: interleaved lines from N
  // concurrent jest processes are unreadable.
  const results = await Promise.all(
    Array.from(
      { length: SHARDS },
      (_, index) =>
        new Promise((resolve) => {
          const output = [];
          const child = spawn(
            'npx', // NOSONAR
            [
              ...JEST,
              `--shard=${index + 1}/${SHARDS}`,
              ...process.argv.slice(2),
            ],
            { cwd: ROOT, env: ENV },
          );
          child.stdout.on('data', (chunk) => output.push(chunk));
          child.stderr.on('data', (chunk) => output.push(chunk));
          child.on('close', (code) => {
            process.stdout.write(
              `\n===== shard ${index + 1}/${SHARDS} =====\n${Buffer.concat(output)}`,
            );
            resolve(code ?? 1);
          });
        }),
    ),
  );

  process.exit(Math.max(...results));
}

const jest = spawnSync(
  'npx', // NOSONAR
  [...JEST, ...process.argv.slice(2)],
  { cwd: ROOT, stdio: 'inherit', env: ENV },
);

process.exit(jest.status ?? 1);
