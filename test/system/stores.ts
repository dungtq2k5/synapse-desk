/**
 * @file The three stores `db:reset` does not touch.
 *
 * **`npm run db:reset` is Postgres-only**, and correctly so — its job is
 * schemas. But the journey writes to four stores, and a "reset" that clears one
 * of them leaves the other three holding the previous run's state. Two steps
 * depend on that directly:
 *
 * - **retrieval** can answer from a document a previous run left in Qdrant,
 *   which looks exactly like a pass;
 * - **the quota threshold** reads a Redis counter keyed by the billing-cycle
 *   epoch, so a leftover counter fires the alarm early — or, if it is already
 *   past the threshold, never fires at all.
 *
 * **Called in SETUP as well as teardown**, and that is the half that matters:
 * the state which breaks a run is the state the PREVIOUS run left, and a
 * previous run that was killed never reached its teardown at all.
 */

import { execFileSync } from 'node:child_process';
import Redis from 'ioredis';
import { QDRANT_COLLECTION } from '@synapsedesk/common';
import { REPO_ROOT } from './services';

const QDRANT_URL = process.env.QDRANT_URL ?? 'http://localhost:6333';
const REDIS_URL = process.env.SYSTEM_REDIS_URL ?? 'redis://localhost:6379';

/**
 * Refuses anything that is not a developer machine.
 *
 * The same shape `reset-databases.mjs` and the demo seeder already apply to
 * Postgres, extended to the stores they do not cover. `flushdb` against a
 * shared Redis is the single most destructive thing this harness does.
 */
function assertLocal(url: string, what: string): void {
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(host)) {
    throw new Error(
      `Refusing to reset ${what} at ${host}: the system harness is destructive and local-only`,
    );
  }
}

/**
 * Drops the chunk collection.
 *
 * `DELETE` rather than "delete the points matching this tenant": the collection
 * is recreated on the next write by `ensureCollection`, and a filtered delete
 * would leave the collection's own configuration — vector size, distance —
 * from whatever wrote it last.
 */
// **Teardown EMPTIES; it does not restore.** After a run, Postgres still holds
// document rows with `status: INDEXED` while Qdrant holds no vectors for them.
// Harmless today — the AI steps are `it.todo` and the seeder itself writes
// `vectorPointId: null` ("chunks exist, vectors do not") — and it becomes real
// the day step 4 is enabled, which is exactly when nobody re-reads this file.
// Whoever enables it: re-seed, or re-index, before trusting retrieval.
async function resetQdrant(): Promise<void> {
  assertLocal(QDRANT_URL, 'Qdrant');

  const response = await fetch(
    `${QDRANT_URL}/collections/${QDRANT_COLLECTION}`,
    { method: 'DELETE' },
  );

  // 404 is success: there was nothing to drop.
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Could not drop the Qdrant collection: ${response.status} ${await response.text()}`,
    );
  }
}

/**
 * Flushes the dev Redis database.
 *
 * **Everything shares it** — BullMQ queues and their repeat schedules, the
 * throttler's counters, the AI quota counters, the socket adapter's channels
 * and the limit-alert levels. Flushing is the only reset that leaves none of
 * them, and a targeted `SCAN` per owner would be six patterns that drift.
 *
 * This is also the fix known-gap #7's leftovers need for THIS run — and only
 * for this run. That row's own fix is each existing e2e suite's teardown
 * obliterating its own `SCHEDULER_QUEUE`; nothing here changes the auth suite
 * that fails every second time.
 */
async function resetRedis(): Promise<void> {
  assertLocal(REDIS_URL, 'Redis');

  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 2 });
  try {
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}

/** The durable streams and their consumers — `npm run nats:reset`. */
function resetNats(): void {
  // The script already exists, written for known-gap #14's third sighting: a
  // durable left by a real service run that no suite could clear. Calling it is
  // the whole integration.
  execFileSync(
    'node', // NOSONAR
    ['scripts/reset-jetstream.mjs'],
    {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    },
  );
}

/** All three, in the order that makes a partial failure least confusing. */
export async function resetStores(): Promise<void> {
  await resetQdrant();
  await resetRedis();
  resetNats();
}
