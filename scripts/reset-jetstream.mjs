#!/usr/bin/env node
/**
 * Drops the durable JetStream streams, and every consumer with them.
 *
 *   npm run nats:reset
 *
 * WHY THIS EXISTS
 * ---------------
 * A WorkQueue stream permits exactly ONE consumer per filter subject. That is
 * the property that makes "delivered and acked" mean "done" — but it also means
 * a durable left behind by a process that is no longer running BLOCKS every
 * later consumer of that subject. Nothing clears it: durables outlive the
 * process that made them, the stream, a service restart, and a `docker compose
 * restart`, because JetStream persists to disk.
 *
 * The symptom is an e2e suite failing wholesale with `filtered consumer not
 * unique on workqueue stream`, which names neither the subject nor the consumer
 * holding it. `PullConsumerRunner` now answers both and points here.
 *
 * WHY DELETING STREAMS RATHER THAN CONSUMERS
 * ------------------------------------------
 * Deleting the stream takes its consumers AND its undelivered messages, which
 * is the state that actually wants clearing: a leftover consumer is one half of
 * the problem and a backlog of unacked messages from an abandoned run is the
 * other. `jetstream-bootstrap.ts` recreates every stream from
 * `JETSTREAM_STREAMS` at the next boot, so there is nothing to restore by hand.
 *
 * DESTRUCTIVE, AND ONLY FOR LOCAL DEVELOPMENT. Every parked DLQ message and
 * every queued notification goes with it. It refuses to run against a server
 * that is not local unless `--force` is passed.
 */
import { connect } from 'nats';

const url = process.env.NATS_URL ?? 'nats://localhost:4222';
const force = process.argv.includes('--force');

const isLocal =
  /(?:\/\/|@)(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::|$)/.test(url);

if (!isLocal && !force) {
  console.error(
    `refusing to reset a non-local server (${url}). Pass --force if you meant it.`,
  );
  process.exit(1);
}

const connection = await connect({ servers: url });

try {
  const manager = await connection.jetstreamManager();

  // Read the live list rather than importing JETSTREAM_STREAMS: this script
  // exists to clear state a PREVIOUS build left, and that build may have
  // declared a stream this one no longer names. Importing the constant would
  // leave exactly the orphan the script is for.
  const names = [];
  for await (const stream of manager.streams.list()) {
    names.push(stream.config.name);
  }

  if (names.length === 0) {
    console.log('jetstream: nothing to reset');
  }

  for (const name of names) {
    const consumers = [];
    for await (const consumer of manager.consumers.list(name)) {
      consumers.push(consumer.name);
    }

    await manager.streams.delete(name);
    console.log(
      `jetstream: deleted stream ${name}` +
        (consumers.length > 0 ? ` (consumers: ${consumers.join(', ')})` : ''),
    );
  }

  console.log(
    'jetstream: reset. Streams are recreated on the next service boot.',
  );
} finally {
  await connection.close();
}
