import {
  ACK_WAIT_MS,
  DUPLICATE_WINDOW_MS,
  MAX_DELIVER,
  RETRY_BACKOFF_MS,
  captures,
  dlqSubject,
  nakDelayMs,
  streamFor,
  DURABLE_SUBJECTS,
  JETSTREAM_STREAMS,
} from './jetstream.config';
import type { JetStreamStream } from './jetstream.config';
import * as common from '../main';

/**
 * The retry constants, and the relationships between them.
 *
 * These are four numbers that only work as a set, and every one of the
 * relationships below was learned from the broker rejecting something or from a
 * measurement contradicting a docblock. A comment stating the arithmetic is what
 * this file replaces: the arithmetic is now checked.
 */
describe('JetStream retry constants (unit)', () => {
  it('**1. every backoff entry is at least ACK_WAIT_MS**', () => {
    // Measured: with `ack_wait: 10s` and `backoff: [2s, 3s]` the first
    // redelivery arrives at 2s. Each entry REPLACES ack_wait for that attempt,
    // so one shorter than a handler's slowest legitimate run redelivers a
    // message still being processed — and for `notification.email.send` that
    // duplicate is a second real email.
    for (const backoff of RETRY_BACKOFF_MS) {
      expect(backoff).toBeGreaterThanOrEqual(ACK_WAIT_MS);
    }
  });

  it('**2. a full retry cycle finishes inside the dedupe window**', () => {
    // The relationship `MAX_DELIVER`'s docblock used to assert as
    // `ACK_WAIT_MS * MAX_DELIVER`, which described a mechanism the code did not
    // use. This is the real cycle: the gaps, plus a full ack_wait for each
    // attempt that could hold the message.
    const cycle =
      RETRY_BACKOFF_MS.reduce((total, ms) => total + ms, 0) +
      ACK_WAIT_MS * MAX_DELIVER;

    expect(cycle).toBeLessThan(DUPLICATE_WINDOW_MS);
  });

  it('**3. MAX_DELIVER exceeds the backoff length, which the server requires**', () => {
    // Not a style rule — JetStream rejects the consumer outright: "max deliver
    // is required to be > length of backoff values" (err_code 10116). Derived
    // rather than declared, so this holds by construction; the test pins the
    // derivation rather than the number.
    expect(MAX_DELIVER).toBeGreaterThan(RETRY_BACKOFF_MS.length);
  });

  it('4. nakDelayMs walks the array from the first delivery', () => {
    // `deliveryCount` is 1 on first delivery, so the first retry waits the first
    // entry rather than the second.
    expect(nakDelayMs(1)).toBe(RETRY_BACKOFF_MS[0]);
    expect(nakDelayMs(RETRY_BACKOFF_MS.length)).toBe(
      RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1],
    );
  });

  it('4b. and clamps rather than returning undefined past the end', () => {
    // The failure this prevents is silent: `nak(undefined)` is a nak with NO
    // delay, which is the un-paced behaviour the array exists to replace.
    expect(nakDelayMs(MAX_DELIVER + 10)).toBe(
      RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1],
    );
  });

  it('**4c. and an override array is used, not the production constant**', () => {
    // The bug this pins, found by instrumenting a test that hung: the runner
    // took a `backoffMs` override for the SERVER's backoff while the nak delay
    // still read `RETRY_BACKOFF_MS`. Half the mechanism overridden, so a test
    // configured for 1.5s waited 30s and failed as a timeout with nothing in it
    // naming a backoff.
    //
    // The two paths are one decision. A signature that can ignore an override is
    // what let them come apart.
    const override = [10, 20];

    expect(nakDelayMs(1, override)).toBe(10);
    expect(nakDelayMs(2, override)).toBe(20);
    expect(nakDelayMs(9, override)).toBe(20);
    expect(nakDelayMs(1, override)).not.toBe(RETRY_BACKOFF_MS[0]);
  });

  it('**5. no DLQ subject falls inside a stream that already captures it**', () => {
    // NATS refuses a stream whose subjects overlap an existing one, so a parked
    // subject inside a WorkQueue stream fails at DECLARATION, not at the moment
    // something is parked. The build hit it once, with a `.dlq` suffix under
    // the old `notification.>` wildcard.
    //
    // Two rows, two breaks. A `.dlq` suffix fails the PREFIX row only: against
    // literal stream subjects it overlaps nothing. Returning the subject
    // unprefixed is what fails the OVERLAP row.
    const streams: readonly JetStreamStream[] =
      Object.values(JETSTREAM_STREAMS);

    for (const subject of DURABLE_SUBJECTS) {
      const parked = dlqSubject(subject);
      const inside = streams
        .filter((stream) => stream.workQueue)
        .filter((stream) =>
          stream.subjects.some((pattern) => captures(pattern, parked)),
        )
        .map((stream) => `${parked} in ${stream.name}`);

      expect(inside).toEqual([]);
      expect(parked.startsWith('dlq.')).toBe(true);
    }
  });

  it('**6. every DURABLE subject is captured by exactly one WorkQueue stream**', () => {
    // What makes `DURABLE_SUBJECTS` the list rather than a fourth restatement of
    // it. Before this, the streams' `subjects`, the runners in two `main.ts`
    // files and this array were independent — and the only test over them
    // filtered `audit.record` out before asserting, so half the list was covered
    // by nothing.
    for (const subject of DURABLE_SUBJECTS) {
      expect(() => streamFor(subject)).not.toThrow();
    }

    expect(streamFor('audit.record')).toBe('AUDIT');
    expect(streamFor('notification.email.send')).toBe('NOTIFICATIONS');
  });

  it('**6b. and a subject no stream captures throws rather than returning**', () => {
    // The failure it replaces is silent: NATS accepts a consumer whose
    // `filter_subject` matches nothing, so a typo yields a healthy-looking
    // service that receives nothing forever. Verified against the broker — a
    // filter outside the stream's subjects is accepted without complaint.
    expect(() => streamFor('ticket.assigned')).toThrow(/no jetstream stream/iu);
  });

  it('6c. and the DLQ is never chosen, since nothing consumes it', () => {
    // `dlq.>` would match a parked subject, and returning it would point a
    // runner at the stream that exists precisely because it has no reader.
    expect(() => streamFor(dlqSubject('audit.record'))).toThrow();
  });

  describe('**7. no subject outside DURABLE_SUBJECTS is captured by a WorkQueue stream**', () => {
    // Test 6 runs from the registry toward the streams; this runs the other
    // way, and the other way is the bug it was written for: `notification.>`
    // captured `notification.{created,updated,read}` — core events for the
    // gateway — into a WorkQueue with no consumer for them, forever.

    /**
     * Exports named like subjects that are not subjects. Named, the
     * `BUILD_INJECTED` shape, so a hole in the filter cannot pass for one.
     */
    const NOT_SUBJECTS: ReadonlySet<string> = new Set([
      'ORGANIZATION_SLUG_PATTERN',
    ]);

    /** Every subject the contracts export, from the barrel rather than a list. */
    const families = Object.entries(common).filter(
      ([name]) => /_PATTERNS?$/u.test(name) && !NOT_SUBJECTS.has(name),
    );
    const subjects = families.flatMap(([, value]) =>
      typeof value === 'string'
        ? [value]
        : Object.values(value as Record<string, unknown>).filter(
            (member): member is string => typeof member === 'string',
          ),
    );

    const workQueues: readonly JetStreamStream[] = Object.values(
      JETSTREAM_STREAMS,
    ).filter((stream: JetStreamStream) => stream.workQueue);

    it('captures exactly the durable subjects, and nothing else', () => {
      const durable: ReadonlySet<string> = new Set(DURABLE_SUBJECTS);
      const strays = subjects.flatMap((subject) =>
        workQueues
          .filter((stream) =>
            stream.subjects.some((pattern) => captures(pattern, subject)),
          )
          .filter(() => !durable.has(subject))
          .map((stream) => `${subject} captured by ${stream.name}`),
      );

      expect(strays).toEqual([]);
    });

    it('the corpus floor — every contract family is found', () => {
      expect(families.map(([name]) => name).sort()).toEqual(
        expect.arrayContaining([
          'AUDIT_PATTERNS',
          'BILLING_PATTERNS',
          'DOCUMENT_PATTERNS',
          'EMAIL_INBOUND_PATTERNS',
          'IN_APP_NOTIFICATION_PATTERN',
          'NOTIFICATION_PATTERNS',
          'NOTIFICATION_REALTIME_PATTERNS',
          'STORAGE_PATTERNS',
          'TICKET_PATTERNS',
        ]),
      );
      expect(subjects).toEqual(
        expect.arrayContaining([
          'notification.created',
          'notification.in_app.create',
          'ticket.assigned',
        ]),
      );
    });

    it('the pattern fires — `captures` can see a wildcard capture at all', () => {
      expect(captures('notification.>', 'notification.created')).toBe(true);
      expect(captures('notification.email.send', 'notification.created')).toBe(
        false,
      );
    });

    it('no stream declares `*`, which `captures` cannot match', () => {
      const starred = Object.values(JETSTREAM_STREAMS).flatMap(
        (stream: JetStreamStream) =>
          stream.subjects.filter((pattern) => pattern.split('.').includes('*')),
      );

      expect(starred).toEqual([]);
    });
  });
});
