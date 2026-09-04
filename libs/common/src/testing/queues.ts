/**
 * @file Teardown for BullMQ queues, shared by every service's e2e bootstrap.
 *
 * **Known gap #7's fix, in one place instead of four spellings.** Four
 * services own a scheduler queue and all four must leave the shared Redis
 * clean, but they arrived at it four different ways: auth and ticket call this
 * directly from `close()`, notification and ingestion reach it through a
 * `reset()` that `close()` also calls, and ingestion uses the DI token rather
 * than a standalone connection. Same invariant, four spellings, three
 * near-identical copies of this function — which is what a shared testing
 * helper is for.
 */

import { Queue } from 'bullmq';

/**
 * Obliterates each queue, opening and closing its own connection.
 *
 * **A standalone `new Queue` rather than `moduleRef.get(getQueueToken(...))`**:
 * callers run this while the module is tearing down, so the container's
 * instance is already closing. The connection costs milliseconds and happens
 * once per suite.
 *
 * **The connection detail is load-bearing — check it before adding a fifth
 * caller.** Every service's `BullModule` connects with `url: REDIS_URL` and no
 * `db` override, so this standalone connection lands in the same database the
 * queues actually live in. A service whose Bull connection carried a `db:`
 * option (the way auth's `finance.module.ts` Redis client does) would be
 * obliterating an empty database and reporting success.
 *
 * `force`, because a queue holding an ACTIVE job refuses a plain obliterate —
 * and an active leftover is precisely what needs removing.
 */
export async function obliterateQueues(
  names: readonly string[],
): Promise<void> {
  for (const name of names) {
    const queue = new Queue(name, {
      connection: { url: process.env.REDIS_URL as string },
    });

    try {
      await queue.obliterate({ force: true });
    } finally {
      await queue.close();
    }
  }
}
