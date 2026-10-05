/**
 * @file Builds the gateway, then runs the contract suite.
 *
 *   node scripts/run-contract-suite.mjs
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
 * built for.
 *
 * **Separate in data, concurrent in time.** A shard keeps its files in the serial
 * order and has its own Redis and NATS, so no row gains a neighbour in the DATA it
 * did not have before; one can lose one (a row that passed only because its polluter
 * ran first now passes for another reason). But the shards run at the same MOMENT on
 * everything they still share: the host's ports, CPU timing, the built gateway, the
 * Docker daemon, any file a row writes. A row that relies on running before or after
 * another against any of those now races where it used to queue. Ports were one such
 * race, measured; each shard draws its ports from its own block (`CONTRACT_SHARD`, see
 * `gateway.ts`), so ports are no longer shared. The serial run stays the oracle for
 * anything that depends on arrangement or timing.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const build = spawnSync(
  'npx',
  ['turbo', 'run', 'build', '--filter=@synapsedesk/api-gateway...'],
  { cwd: ROOT, stdio: 'inherit', env: process.env },
);

if (build.status !== 0) {
  console.error('Building the gateway failed; the suite was not run.');
  process.exit(build.status ?? 1);
}

const JEST = ['jest', '--config', 'test/gateway-contract/jest.config.ts'];
const SHARDS = Number(process.env.CONTRACT_SHARDS ?? 1);
// Every gateway a row starts writes its whole output here (see `gateway.ts`), so a
// failure leaves the gateway's side of the story behind as well as the test's.
const LOG_DIR = mkdtempSync(join(tmpdir(), 'contract-'));
console.log(`gateway and shard logs: ${LOG_DIR}`);
const ENV = { ...process.env, CONTRACT_LOG_DIR: LOG_DIR };

if (SHARDS > 1) {
  // Each shard's output is printed as one block when it ends: interleaved lines from N
  // concurrent jest processes are unreadable. It is ALSO written to a file as it
  // arrives, so a shard that hangs leaves its evidence behind instead of nothing.
  const logs = LOG_DIR;
  const results = await Promise.all(
    Array.from(
      { length: SHARDS },
      (_, index) =>
        new Promise((resolve) => {
          const output = [];
          const log = createWriteStream(join(logs, `shard-${index + 1}.log`));
          const child = spawn(
            'npx', // NOSONAR
            [
              ...JEST,
              `--shard=${index + 1}/${SHARDS}`,
              ...process.argv.slice(2),
            ],
            { cwd: ROOT, env: { ...ENV, CONTRACT_SHARD: String(index + 1) } },
          );
          const keep = (chunk) => {
            output.push(chunk);
            log.write(chunk);
          };
          child.stdout.on('data', keep);
          child.stderr.on('data', keep);
          child.on('close', (code) => {
            process.stdout.write(
              `\n===== shard ${index + 1}/${SHARDS} =====\n${Buffer.concat(output)}`,
            );
            log.end();
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
