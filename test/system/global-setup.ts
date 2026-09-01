/**
 * @file Verify the precondition, clear the stores, build, start, wait.
 *
 * **The destructive reset is NOT here, and that follows the plan rather than
 * departing from it.** §6's pipeline is three commands —
 * `db:reset && seed:demo --apply && test:system` — so wiping the dev databases
 * belongs to whoever types the first one. An earlier version folded it into
 * this file, which made every invocation of the suite destroy four databases as
 * a side effect of running tests.
 *
 * What this file does instead is **seed** on top of whatever the wipe left, and
 * then check that the dataset is really there. A harness that silently ran
 * against an unseeded database would fail on an assertion about counts, three
 * steps in, for a reason nowhere near the cause.
 *
 * The other three stores it DOES clear, because `db:reset` cannot: Qdrant,
 * Redis and JetStream. See `stores.ts` for why that is not tidiness.
 */

import { execFileSync } from 'node:child_process';
import { REPO_ROOT } from './services';
import {
  assertPortsFree,
  installReapers,
  reapPreviousRun,
  startStack,
  stopStack,
} from './stack';
import { assertSeeded, isSeeded } from './seeded';
import { resetStores } from './stores';

function run(command: string, args: string[]): void {
  execFileSync(command, args, { cwd: REPO_ROOT, stdio: 'inherit' });
}

export default async function globalSetup(): Promise<void> {
  installReapers();

  // A run that was killed never reached teardown, and the PID table it left is
  // the only record of what it started. Reaping it first turns the common case
  // from "port 3000 is held" into nothing at all.
  await reapPreviousRun();

  // **Before anything expensive.** A port already held means a stale fleet, and
  // starting on top of one produces a stack where some services are this run's
  // and some are the last one's.
  await assertPortsFree();

  // **Setup as well as teardown.** The state that breaks a run is the state the
  // PREVIOUS run left, and a previous run that was killed never reached its
  // teardown at all.
  await resetStores();

  // The build is what makes `start:prod` meaningful: every service's only other
  // run script is `nest start --watch`, and a watcher under a system test
  // restarts the service under test when an editor saves.
  run('npm', ['run', 'build']);

  // **The spawn itself is inside the guard**, because jest does NOT run
  // `globalTeardown` when `globalSetup` throws. An earlier version guarded only
  // what came after `startStack()` — with a comment claiming "everything after
  // the spawn" was covered, which was precisely inverted: `startStack` IS the
  // spawn, and its readiness timeout is this harness's single most likely
  // failure. Measured twice before the guard existed at all: a refusing seeder
  // left seven services running and every port held.
  //
  // `startStack` also reaps on its own timeout now, so this is defence in
  // depth: whichever line throws, the fleet is gone before jest is.
  try {
    await startStack();
    await ensureSeeded();
  } catch (error) {
    await stopStack();
    throw error;
  }
}

/**
 * Seeds only if the dataset is missing.
 *
 * **The demo seeder is ADDITIVE and says so** — *"a second run doubles the demo
 * and pushes the first run's tenants over their seat limits"* — so calling it
 * unconditionally works exactly once after a wipe and refuses forever after.
 * Checking first makes the harness re-runnable, which is the difference between
 * a suite somebody runs and one they run once.
 *
 * **Ordered after `startStack` and that ordering is forced.** Both seeders
 * refuse on an empty database with a message naming what is missing:
 *
 *   No rows in `subscription_plans`. Run `npm run plans:seed:apply` first
 *   No global system roles in `roles`. Start auth-service once …
 *
 * The permission catalogue, the system roles and the partial unique indexes are
 * written by `DatabaseSeeder` from `OnApplicationBootstrap`, and
 * `reset-databases.mjs` documents that a reset drops all of it. So the plan's
 * `db:reset && seed && test` pipeline cannot work in that order after a reset:
 * the seed has nothing to derive from until something has booted.
 */
async function ensureSeeded(): Promise<void> {
  if (await isSeeded()) return;

  run('npm', ['run', 'plans:seed:apply']);
  run('npm', ['run', 'seed:demo:apply']);

  // A post-condition rather than a pre-condition: the seeders above either
  // wrote the dataset or failed loudly, and this turns "they ran" into "it is
  // there".
  await assertSeeded();
}
