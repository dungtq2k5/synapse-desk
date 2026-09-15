import { AUDIT_PATTERNS } from '../contracts/audit.contract';
import {
  IN_APP_NOTIFICATION_PATTERN,
  NOTIFICATION_PATTERNS,
} from '../contracts/notification.contract';

/** One stream's declaration, as {@link JETSTREAM_STREAMS} states it. */
export type JetStreamStream = {
  readonly name: string;
  /** Concrete subjects, or a `prefix.>` wildcard. */
  readonly subjects: readonly string[];
  /** WorkQueue retention. `false` for DLQ — see its docblock. */
  readonly workQueue: boolean;
};

/**
 * The two durable streams, and the subjects each captures.
 *
 * **Two rather than one** because retention and volume differ by an order of
 * magnitude: a burst of notifications must not be able to age out audit
 * records, and one stream makes them share limits.
 *
 * Everything NOT listed here stays on core NATS deliberately — see ADR 0041.
 * The rule is: prefer reconciliation where state exists, redelivery where it
 * does not. `document.*` is the case that proves it, reconciled by
 * `ingestion-reconcile.sweep.ts` without touching the transport.
 */
export const JETSTREAM_STREAMS = {
  AUDIT: {
    name: 'AUDIT',
    subjects: [AUDIT_PATTERNS.record],
    // Exactly one consumer, so "delivered and acked" means "done".
    workQueue: true,
  },
  NOTIFICATIONS: {
    name: 'NOTIFICATIONS',
    // `notification.>` rather than three literals: the in-app subject is
    // `notification.in_app.create` and the two transactional ones are
    // `notification.{email,sms}.send`, so one wildcard covers the family and a
    // fourth channel needs no stream change.
    subjects: ['notification.>'],
    workQueue: true,
  },
  /**
   * Where a message that exhausted `MAX_DELIVER` is parked.
   *
   * **Not a WorkQueue**, and that is the whole difference: nothing consumes
   * this stream. A WorkQueue exists to be drained by its one reader, so one
   * with no reader would hold every parked message forever under a policy that
   * says it is waiting to be worked. Limits retention says what is true — these
   * are kept to be looked at, and age out.
   *
   * **`dlq.` is a PREFIX rather than a `.dlq` suffix**, and that is not a style
   * choice. `notification.email.send.dlq` falls under `notification.>`, so the
   * suffix form overlaps the NOTIFICATIONS stream — which NATS rejects outright,
   * failing the declaration at boot. The prefix keeps every parked message in
   * one stream that overlaps nothing.
   */
  DLQ: {
    name: 'DLQ',
    subjects: ['dlq.>'],
    workQueue: false,
  },
} as const satisfies Record<string, JetStreamStream>;

/**
 * Every subject a stream above captures — the ones that are NOT at-most-once.
 *
 * **Read by production code through {@link streamFor}, not only by tests.** It
 * was briefly an enumeration nothing derived from, sitting alongside the
 * streams' own `subjects` and a hardcoded stream name in each `main.ts` — four
 * statements of one fact, which is the shape ADR 0039 exists to refuse.
 */
export const DURABLE_SUBJECTS = [
  AUDIT_PATTERNS.record,
  NOTIFICATION_PATTERNS.sendEmail,
  NOTIFICATION_PATTERNS.sendSms,
  IN_APP_NOTIFICATION_PATTERN,
] as const;

/**
 * How long the stream collapses a repeated `Nats-Msg-Id`.
 *
 * **Read together with {@link ACK_WAIT_MS} × {@link MAX_DELIVER}, not chosen
 * independently.** This window covers re-PUBLISHES; the consumer's unique key
 * covers re-DELIVERIES. They defend different failures, and the interaction is
 * the trap: if a retry cycle can outlast this window, a republish part-way
 * through one is no longer deduped by the stream.
 *
 */
export const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

/**
 * How long a consumer may hold a message before the server assumes it died.
 *
 * **A floor, not the live value.** {@link RETRY_BACKOFF_MS} overrides this per
 * attempt — measured, not assumed: with `ack_wait: 10s` and `backoff: [2s, 3s]`
 * the first redelivery arrives at 2s. So this is what applies if `backoff` is
 * ever removed, and the minimum every entry in it must respect.
 */
export const ACK_WAIT_MS = 30 * 1000;

/**
 * The gap before each redelivery, one entry per retry.
 *
 * **Each entry IS the `ack_wait` for that attempt**, which is the whole reason
 * none may drop below {@link ACK_WAIT_MS}. An entry of 5s would redeliver a
 * healthy handler's message 5s in — so a 20s email send would be delivered again
 * while the first is still connecting, and the duplicate is a second real email.
 *
 * Serves **both** retry paths, which fail differently and are paced separately:
 * the consumer passes it as `backoff` for a handler that DIED without answering,
 * and {@link nakDelayMs} reads it for one that failed and said so. Setting only
 * the first leaves an explicit `nak()` firing every retry in milliseconds.
 *
 * The sum is 225s against {@link DUPLICATE_WINDOW_MS}'s 600s, so a full retry
 * cycle finishes inside the window that would recognise a republish. That is the
 * arithmetic to redo when changing either.
 */
export const RETRY_BACKOFF_MS = [
  30 * 1000,
  45 * 1000,
  60 * 1000,
  90 * 1000,
] as const;

/**
 * Deliveries before a message is parked in its DLQ subject and terminated.
 *
 * Derived rather than declared: it is the first delivery plus one per entry in
 * {@link RETRY_BACKOFF_MS}, so adding a retry cannot leave a gap the array
 * defines and this number contradicts.
 */
export const MAX_DELIVER = RETRY_BACKOFF_MS.length + 1;

/**
 * The delay to pass to `nak()` on a given delivery.
 *
 * @param deliveryCount 1 on first delivery, so the first retry waits the first
 * entry.
 * @param backoff Defaults to {@link RETRY_BACKOFF_MS}. Taken as a parameter so
 * a consumer configured with a different array uses it for BOTH paths — the
 * server `backoff` and this delay are one decision, and reading the constant
 * here would silently ignore half of an override.
 */
export function nakDelayMs(
  deliveryCount: number,
  backoff: readonly number[] = RETRY_BACKOFF_MS,
): number {
  return backoff[deliveryCount - 1] ?? backoff.at(-1);
}

/**
 * Whether a stream's subject declaration captures a concrete subject.
 *
 * `>` is NATS's multi-token wildcard and is only legal as the LAST token, so
 * matching it is a prefix test rather than a general glob.
 */
function captures(pattern: string, subject: string): boolean {
  return pattern.endsWith('.>')
    ? subject.startsWith(pattern.slice(0, -1))
    : pattern === subject;
}

/**
 * Which stream carries a durable subject.
 *
 * The streams declare PATTERNS (`notification.>`) and {@link DURABLE_SUBJECTS}
 * lists concrete subjects, so something has to match the two — and having the
 * caller name the stream is what let them drift apart in the first place.
 *
 * @throws Error when no WorkQueue stream captures the subject, which is a
 * subject that would be published to and consumed by nobody. Loud at boot
 * rather than a runner quietly filtering on something no stream holds: NATS
 * accepts a consumer whose `filter_subject` matches nothing, so the failure is
 * otherwise a service that looks healthy and receives nothing forever.
 */
export function streamFor(subject: string): string {
  // Annotated rather than inferred. `Object.values` over an `as const` map
  // yields a UNION of tuple types, and calling `.some()` on a union of call
  // signatures leaves its callback parameter `any` — which is the whole of what
  // the unsafe-call errors here were reporting. One element type, one signature.
  const streams: readonly JetStreamStream[] = Object.values(JETSTREAM_STREAMS);

  const stream = streams.find(
    (candidate) =>
      candidate.workQueue &&
      candidate.subjects.some((pattern) => captures(pattern, subject)),
  );

  if (!stream) {
    throw new Error(
      `No JetStream stream captures '${subject}'. Add it to JETSTREAM_STREAMS or stop treating it as durable.`,
    );
  }

  return stream.name;
}

/**
 * Where a message that exhausted `MAX_DELIVER` is republished before `term()`.
 *
 * Prefixed, not suffixed — see `JETSTREAM_STREAMS.DLQ`. A publish to a subject
 * no stream captures fails with a 503 rather than going nowhere quietly, so
 * getting this wrong parks nothing at all.
 */
export function dlqSubject(subject: string): string {
  return `dlq.${subject}`;
}
