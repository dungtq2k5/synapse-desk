import { Logger } from '@nestjs/common';
import {
  AckPolicy,
  type JetStreamManager,
  type JsMsg,
  type NatsConnection,
  type ConsumerMessages,
} from 'nats';
import {
  ACK_WAIT_MS,
  dlqSubject,
  MAX_DELIVER,
  nakDelayMs,
  RETRY_BACKOFF_MS,
} from './jetstream.config';
import { formatErrorMsg } from '../utils/format-error';

/**
 * A message that can never succeed, however many times it is delivered.
 *
 * Throw this instead of a plain error when the payload itself is the problem —
 * a required field absent, a shape no version of the handler could accept. The
 * runner parks it immediately rather than spending the retry budget: naking a
 * payload that cannot become valid is the poison-message loop `MAX_DELIVER`
 * exists to bound, entered on purpose.
 *
 * The third typed error this codebase catches above a generic arm, after
 * `BudgetExhausted` and `JobNoLongerRunnableError`, and for the same reason each
 * time: a deterministic failure must not take the retrying path.
 *
 * @example
 * if (!command.eventId) {
 *   throw new UnprocessableMessage('audit.record without an eventId');
 * }
 */
export class UnprocessableMessage extends Error {}

/**
 * JetStream's code for "a consumer with that durable name already exists".
 *
 * Matched on the code, not the message, for the reason `isStreamNameInUse` is:
 * the text is the server's to reword. A rejected CONFIG under a free name
 * reports something else entirely — `10116` for a `max_deliver` that does not
 * exceed the backoff length — which is exactly what this must not swallow.
 */
const CONSUMER_NAME_IN_USE = 10148;

function isConsumerNameInUse(error: unknown): boolean {
  return (
    (error as { api_error?: { err_code?: number } })?.api_error?.err_code ===
    CONSUMER_NAME_IN_USE
  );
}

/**
 * Names the consumer already holding this filter, when that is why `add` failed.
 *
 * **A WorkQueue stream permits exactly ONE consumer per filter subject**, so a
 * durable left behind by a process that is no longer running blocks every later
 * one — and the server says only `filtered consumer not unique on workqueue
 * stream`, naming neither the filter nor the consumer that holds it. That
 * sentence costs an afternoon: nothing in it says the obstacle is a leftover,
 * that it survives a service restart, or where to look.
 *
 * Matched by ASKING the server what exists rather than by error code. The code
 * for this case is the server's and undocumented in the client, and the
 * question "who already has this filter?" has a better answer than a lookup
 * table: the list itself. When nothing holds it, the original error was about
 * something else and is rethrown untouched.
 *
 * @returns the error to throw — enriched when a conflict explains it, the
 *   original otherwise.
 */
async function describeFilterConflict(
  manager: JetStreamManager,
  stream: string,
  filterSubject: string,
  error: unknown,
): Promise<unknown> {
  let holders: string[];

  try {
    holders = [];
    for await (const consumer of manager.consumers.list(stream)) {
      if (consumer.config.filter_subject === filterSubject) {
        holders.push(consumer.name);
      }
    }
  } catch {
    // The diagnostic must never replace the real failure with its own.
    return error;
  }

  if (holders.length === 0) return error;

  return new Error(
    `Cannot consume '${filterSubject}' on stream '${stream}': ` +
      `${holders.join(', ')} already holds that filter, and a WorkQueue stream ` +
      'allows only one consumer per subject. It is a durable left by a process ' +
      'that is no longer running — restarting will not clear it. Run ' +
      `'npm run nats:reset' to drop the durable streams and their consumers. ` +
      `(server said: ${formatErrorMsg(error)})`,
  );
}

/** What a handler is given: the decoded payload, already JSON-parsed. */
export type JetStreamHandler<T> = (payload: T) => Promise<void>;

export type PullConsumerOptions<T> = {
  connection: NatsConnection;
  stream: string;
  /** The durable name. Stable across restarts — that is what makes it durable. */
  durable: string;
  filterSubject: string;
  handler: JetStreamHandler<T>;
  /**
   * Overrides {@link RETRY_BACKOFF_MS}, for tests that assert the retry
   * MECHANISM rather than its production timing — a real cycle is 225s, which no
   * test can wait for. Production must not pass it.
   */
  backoffMs?: readonly number[];
};

/**
 * A durable pull consumer, with explicit acks and a dead-letter republish.
 *
 * **Pull rather than push** (ADR 0041): a push consumer delivers at the
 * stream's pace, so a slow email send becomes back-pressure the consumer has no
 * way to express. Pull lets the service fetch what it can finish.
 *
 * @example
 * const runner = new PullConsumerRunner({
 *   connection, stream: 'AUDIT', durable: 'audit-writer',
 *   filterSubject: AUDIT_PATTERNS.record,
 *   handler: (command) => consumer.record(command),
 * });
 * await runner.start();
 */
export class PullConsumerRunner<T> {
  private readonly logger = new Logger(PullConsumerRunner.name);
  private messages?: ConsumerMessages;
  /** Set by {@link stop}, so an expected end is not reported as a failure. */
  private stopping = false;
  /**
   * The one array both retry paths read.
   *
   * Held on the instance rather than reached for as a module constant, because
   * the two paths are configured in different places — `backoff` goes to the
   * server at declaration, the nak delay is computed per failure — and a test
   * override that reached only one of them would leave the other on production
   * timings. It did, once.
   */
  private readonly backoff: readonly number[];

  constructor(private readonly options: PullConsumerOptions<T>) {
    this.backoff = options.backoffMs ?? RETRY_BACKOFF_MS;
  }

  async start(): Promise<void> {
    const { connection, stream, durable, filterSubject } = this.options;

    const manager = await connection.jetstreamManager();
    const config = {
      durable_name: durable,
      filter_subject: filterSubject,
      // Explicit, because the whole point is that "delivered" and "done" are
      // different events. The other policies ack on delivery, which would make
      // a crash mid-handler indistinguishable from success.
      ack_policy: AckPolicy.Explicit,
      ack_wait: ACK_WAIT_MS * 1_000_000,
      max_deliver: MAX_DELIVER,
      // Paces redelivery for a consumer that DIED without answering — a crash, a
      // hang, a pod evicted mid-handler. It does NOT pace an explicit `nak()`,
      // which is why `handle` passes its own delay: two failures, two
      // mechanisms, neither substituting for the other.
      //
      // Each entry also REPLACES `ack_wait` for that attempt, so none may be
      // shorter than a handler's slowest legitimate run.
      backoff: this.backoff.map((ms) => ms * 1_000_000),
    };

    try {
      await manager.consumers.add(stream, config);
    } catch (error) {
      // Narrow, for the reason `ensureStream` is: catching everything here means
      // a rejected CONFIG is reported as whatever `update` says about it rather
      // than what `add` said, one layer further from the mistake.
      if (!isConsumerNameInUse(error)) {
        throw await describeFilterConflict(
          manager,
          stream,
          filterSubject,
          error,
        );
      }

      // Already declared by a previous boot. Durable names are stable by
      // design, so this is the normal path on every restart after the first.
      await manager.consumers.update(stream, durable, config);
    }

    const consumer = await connection
      .jetstream()
      .consumers.get(stream, durable);
    this.messages = await consumer.consume();

    // Deliberately NOT awaited: this loop runs for the life of the process, and
    // awaiting it here would never return to the caller — which is `main.ts`,
    // before `listen()`. What that costs is any notice of it ENDING, which both
    // arms below buy back.
    void this.drain(this.messages)
      .then(() => {
        // A normal return is a FAILURE unless we asked for it — nothing in this
        // design has a reason to stop while the process lives. Without the flag
        // this fires on every clean shutdown and every test teardown, and a line
        // that cries wolf on the happy path is one that gets muted and then
        // deleted.
        if (this.stopping) return;

        this.logger.error(
          `Consumer ${durable} stopped consuming ${filterSubject}. The stream will accumulate.`,
        );
      })
      .catch((error: unknown) =>
        this.logger.error(
          `Consumer ${durable} died on ${filterSubject}: ${formatErrorMsg(error)}`,
        ),
      );
  }

  /**
   * One message at a time, deliberately.
   *
   * `await` inside the loop is what makes processing serial, and the next person
   * looking at a queue depth will reach for concurrency here. Ordering within a
   * subject is worth more than throughput — two `notification.email.send`
   * commands for one recipient should arrive in the order they were published —
   * and the per-subject runners already stop a slow email send from holding up an
   * in-app write, which is the blocking people actually fear.
   */
  private async drain(messages: ConsumerMessages): Promise<void> {
    for await (const message of messages) {
      await this.handle(message);
    }
  }

  private async handle(message: JsMsg): Promise<void> {
    const { filterSubject, handler } = this.options;

    try {
      await handler(JSON.parse(message.string()) as T);
      message.ack();
    } catch (error) {
      // Parked without spending a single retry: the payload cannot become valid,
      // so every redelivery would fail identically and the budget exists for
      // failures that might not.
      if (error instanceof UnprocessableMessage) {
        this.logger.error(
          `Unprocessable message on ${filterSubject}, parking without retry: ${error.message}`,
        );
        await this.park(message);

        return;
      }

      // `deliveryCount`, not the deprecated `redeliveryCount` — the same value
      // today, and the deprecated one reading `undefined` once removed would
      // make this comparison permanently false, so nothing would ever park and a
      // poison message would nak forever at the head of a WorkQueue.
      const { deliveryCount } = message.info;

      if (deliveryCount < MAX_DELIVER) {
        const delay = nakDelayMs(deliveryCount, this.backoff);
        this.logger.warn(
          `Delivery ${deliveryCount}/${MAX_DELIVER} of ${filterSubject} failed, retrying in ${delay}ms: ${formatErrorMsg(error)}`,
        );
        // The delay is the client's. `backoff` on the consumer config paces only
        // a message whose ack_wait expired, so a bare `nak()` would spend every
        // delivery in milliseconds against an outage that has not had time to
        // end — the budget gone before the thing it was retrying came back.
        message.nak(delay);

        return;
      }

      this.logger.error(
        `Giving up on ${filterSubject} after ${MAX_DELIVER} deliveries: ${formatErrorMsg(error)}`,
      );
      await this.park(message);
    }
  }

  /**
   * Republishes to the DLQ subject, then terminates.
   *
   * JetStream has no built-in dead-letter, so the message is put somewhere it
   * can be found BEFORE it is terminated. `term()` alone is a silent drop, and
   * leaving it to redeliver forever blocks everything behind it in a WorkQueue
   * stream (ADR 0041).
   */
  private async park(message: JsMsg): Promise<void> {
    const dlq = dlqSubject(this.options.filterSubject);

    try {
      await this.options.connection.jetstream().publish(dlq, message.data);
    } catch (republishError) {
      // Terminating anyway. A message that cannot be parked is still a poison
      // message, and keeping it would block the queue to preserve a copy of the
      // thing blocking it.
      this.logger.error(
        `Failed to republish to ${dlq}, terminating regardless: ${formatErrorMsg(republishError)}`,
      );
    }

    message.term();
  }

  /** Stops fetching. In-flight handlers finish; nothing new is pulled. */
  async stop(): Promise<void> {
    // Before `close()`, not after: closing ends the iterator, and the arm that
    // reports an unexpected end reads this flag.
    this.stopping = true;
    await this.messages?.close();
  }
}
