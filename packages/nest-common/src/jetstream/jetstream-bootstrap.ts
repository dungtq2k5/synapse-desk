import { Logger } from '@nestjs/common';
import {
  connect,
  RetentionPolicy,
  StorageType,
  type NatsConnection,
} from 'nats';
import { DUPLICATE_WINDOW_MS, JETSTREAM_STREAMS } from './jetstream.config';
import { assertDurableStore } from '../configs/nats.config';

type StreamSpec = (typeof JETSTREAM_STREAMS)[keyof typeof JETSTREAM_STREAMS];

/**
 * Declares one durable stream, idempotently, after proving the store survives.
 *
 * **The assertion runs first and throws.** A stream on a broker whose store is
 * ephemeral is worse than the core publish it replaces: core loses a message
 * immediately and visibly, while JetStream acks the publisher and loses it at
 * the next container recreate. Starting anyway would convert an honest failure
 * into a silent one — by a change made to increase reliability.
 *
 * Idempotent by `add`-then-`update`, the same shape `ensureCollection` uses for
 * Qdrant and `upsertJobScheduler` for BullMQ: re-running a deploy must not be a
 * second stream, and a changed subject list must not need a manual step.
 *
 * @param monitorUrl The broker's HTTP monitoring root.
 * @throws Error when the store is ephemeral, or `-js` is absent entirely.
 */
export async function ensureStream(
  connection: NatsConnection,
  spec: StreamSpec,
  monitorUrl: string,
): Promise<void> {
  const logger = new Logger('JetStream');

  await assertDurableStore(monitorUrl);

  const manager = await connection.jetstreamManager();
  const config = {
    name: spec.name,
    subjects: [...spec.subjects],
    // WorkQueue where each subject has EXACTLY ONE consumer, which is what the
    // mode requires — and what makes "delivered and acked" mean "done" rather
    // than "one reader is finished with it". The DLQ has no consumer at all, so
    // it takes Limits: see `JETSTREAM_STREAMS.DLQ`.
    retention: spec.workQueue
      ? RetentionPolicy.Workqueue
      : RetentionPolicy.Limits,
    storage: StorageType.File,
    // Covers re-PUBLISHES keyed on `Nats-Msg-Id`. The consumer's unique key
    // covers re-DELIVERIES; neither substitutes for the other.
    duplicate_window: DUPLICATE_WINDOW_MS * 1_000_000,
  };

  try {
    await manager.streams.add(config);
    logger.log(`Declared stream ${spec.name} over ${spec.subjects.join(', ')}`);
  } catch (error) {
    // **Only 10058 means "already there with a different config".** Catching
    // everything and calling `update` looks equivalent and is not: an invalid
    // config fails `add` with a precise message — "duplicates window needs to be
    // >= 100ms" — and the blind `update` that followed replaced it with
    // "stream not found", because the stream it was asked to update was never
    // created. The operator got told the wrong thing about the wrong object.
    if (!isStreamNameInUse(error)) throw error;

    // `update` rather than a silent skip: a subject added to the spec has to
    // reach the broker, and the alternative is a stream that captures what the
    // last deploy said it should. Note an `add` with an IDENTICAL config
    // succeeds rather than erroring, so this path is only reached by a genuine
    // change.
    await manager.streams.update(spec.name, config);
    logger.log(`Updated stream ${spec.name} over ${spec.subjects.join(', ')}`);
  }
}

/**
 * JetStream's code for "that name exists, configured differently".
 *
 * Matched on the code rather than the message: the text is the server's to
 * reword, and every other failure of `add` has to stay distinguishable from
 * this one.
 */
const STREAM_NAME_IN_USE = 10058;

function isStreamNameInUse(error: unknown): boolean {
  return (
    (error as { api_error?: { err_code?: number } })?.api_error?.err_code ===
    STREAM_NAME_IN_USE
  );
}

/** A connection for the JetStream paths, separate from Nest's core transport. */
export async function connectJetStream(url: string): Promise<NatsConnection> {
  return connect({ servers: [url] });
}
