import {
  ACK_WAIT_MS,
  DUPLICATE_WINDOW_MS,
  MAX_DELIVER,
  RETRY_BACKOFF_MS,
  dlqSubject,
  nakDelayMs,
  streamFor,
  DURABLE_SUBJECTS,
  JETSTREAM_STREAMS,
} from './jetstream.config';

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
    // The bug the build hit: `notification.email.send.dlq` falls under
    // `notification.>`, and NATS refuses a stream whose subjects overlap an
    // existing one — so the suffix form failed at DECLARATION, not at the moment
    // something was parked.
    const parked = dlqSubject('notification.email.send');
    const captured = JETSTREAM_STREAMS.NOTIFICATIONS.subjects.some((subject) =>
      parked.startsWith(subject.replace(/\.>$/u, '.')),
    );

    expect(captured).toBe(false);
    expect(parked.startsWith('dlq.')).toBe(true);
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
});
