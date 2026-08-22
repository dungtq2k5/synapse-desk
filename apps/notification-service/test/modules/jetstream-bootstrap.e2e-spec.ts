import {
  connectJetStream,
  ensureStream,
  JETSTREAM_STREAMS,
} from '@synapsedesk/common';
import { TICKET_PATTERNS } from '@synapsedesk/common';
import type { NatsConnection } from 'nats';

describe('JetStream bootstrap (e2e)', () => {
  let nc: NatsConnection;
  const monitor = 'http://localhost:8222';

  beforeAll(async () => {
    nc = await connectJetStream('nats://localhost:4222');
  }, 30_000);

  afterAll(async () => {
    // **Nothing is deleted here on purpose.** These are the real streams, on the
    // one broker every service and every suite shares. An earlier version tore
    // them down, which is fine in isolation and destroys any suite that happens
    // to be mid-run — ticket-service's audit suite failed with "stream not
    // found" from exactly this. Same shape as known-gaps #7: shared
    // infrastructure, torn down by whoever finished first.
    //
    // Leaving them is safe because `ensureStream` is idempotent — that is the
    // property test 2 exists to prove.
    await nc.drain();
  });

  it('1. declares both streams against the real broker', async () => {
    await ensureStream(nc, JETSTREAM_STREAMS.AUDIT, monitor);
    await ensureStream(nc, JETSTREAM_STREAMS.NOTIFICATIONS, monitor);

    const manager = await nc.jetstreamManager();
    const audit = await manager.streams.info(JETSTREAM_STREAMS.AUDIT.name);

    expect(audit.config.subjects).toEqual(['audit.record']);
    expect(audit.config.retention).toBe('workqueue');
    expect(audit.config.storage).toBe('file');
  }, 30_000);

  it('2. **is idempotent — a redeploy updates rather than duplicating**', async () => {
    await ensureStream(nc, JETSTREAM_STREAMS.AUDIT, monitor);
    await ensureStream(nc, JETSTREAM_STREAMS.AUDIT, monitor);

    const manager = await nc.jetstreamManager();
    const names: string[] = [];
    for await (const s of manager.streams.list()) names.push(s.config.name);

    expect(
      names.filter((n) => n === JETSTREAM_STREAMS.AUDIT.name),
    ).toHaveLength(1);
  }, 30_000);

  it('**4. the DLQ stream overlaps neither, and takes Limits retention**', async () => {
    // Both halves are load-bearing and both were wrong in the first draft.
    //
    // A `.dlq` SUFFIX falls under `notification.>`, and NATS rejects a stream
    // whose subjects overlap an existing one — so the suffix form fails the
    // declaration at boot, not at the moment something is parked. And a publish
    // to a subject no stream captures fails with a 503, so the suffix form
    // would also have parked nothing even if it had declared.
    //
    // Limits rather than WorkQueue because NOTHING consumes this stream. A
    // WorkQueue exists to be drained by its one reader; one with no reader holds
    // every message forever under a policy claiming it is waiting to be worked.
    await ensureStream(nc, JETSTREAM_STREAMS.NOTIFICATIONS, monitor);
    await ensureStream(nc, JETSTREAM_STREAMS.DLQ, monitor);

    const manager = await nc.jetstreamManager();
    const dlq = await manager.streams.info(JETSTREAM_STREAMS.DLQ.name);

    expect(dlq.config.subjects).toEqual(['dlq.>']);
    expect(dlq.config.retention).toBe('limits');

    // And a parked message actually lands, which the 503 above is the reason to
    // check rather than assume.
    await nc
      .jetstream()
      .publish('dlq.notification.email.send', new TextEncoder().encode('{}'));
    const after = await manager.streams.info(JETSTREAM_STREAMS.DLQ.name);
    expect(after.state.messages).toBeGreaterThan(0);
  }, 30_000);

  it('**5. `ticket.*` still round-trips over CORE — the change is additive**', async () => {
    // ADR 0041 moved four subjects and left the rest alone, and "left alone" is
    // a claim worth a test: `notification.>` and `ticket.*` are consumed by the
    // same process, and the durable ones moving out of Nest's transport is
    // exactly the kind of change that takes the core subscription with it.
    //
    // Asserted at the transport rather than through the service, because what
    // could break is the transport: every other test in this suite calls the
    // consumer's methods directly and would pass against a process subscribed to
    // nothing at all.
    const received = new Promise<string>((resolve) => {
      const subscription = nc.subscribe(TICKET_PATTERNS.assigned);
      void (async () => {
        for await (const message of subscription) {
          resolve(message.string());
          break;
        }
      })();
    });

    // A tick for the subscription to register with the server.
    await nc.flush();
    nc.publish(
      TICKET_PATTERNS.assigned,
      new TextEncoder().encode(JSON.stringify({ ticketId: 'probe' })),
    );

    await expect(received).resolves.toContain('probe');
  }, 30_000);

  it('**6. surfaces a bad config as itself, not as "stream not found"**', async () => {
    // `ensureStream` is add-then-update, and the first version caught EVERY
    // failure of `add` as "it must already exist". An invalid config takes that
    // path too: `add` rejects it with a precise message, the blind `update`
    // then fails on a stream that was never created, and the operator is told
    // "stream not found" about an object whose real problem was one field.
    //
    // Found by sabotage — shrinking the dedupe window made every audit test
    // fail with an error naming neither the window nor the audit stream.
    //
    // Provoked here with an OVERLAP, which is the same failure the `.dlq` suffix
    // design produced: a new stream claiming subjects NOTIFICATIONS already
    // captures. `add` rejects it by name, and the point is that the rejection
    // reaches the caller intact.
    await ensureStream(nc, JETSTREAM_STREAMS.NOTIFICATIONS, monitor);

    await expect(
      ensureStream(
        nc,
        {
          name: 'BAD_CONFIG_PROBE',
          subjects: ['notification.email.send.dlq'],
          workQueue: true,
        } as never,
        monitor,
      ),
    ).rejects.toThrow(/overlap/iu);

    // And nothing was left behind by the failed attempt.
    const manager = await nc.jetstreamManager();
    await expect(manager.streams.info('BAD_CONFIG_PROBE')).rejects.toThrow();
  }, 30_000);

  it('3. **refuses a broker whose store would not survive a restart**', async () => {
    // The guard, against a monitor that reports a /tmp store. Points at a
    // stand-in rather than reconfiguring the real broker, because the thing
    // under test is the refusal, not NATS.
    const original = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ jetstream: { config: { store_dir: '/tmp/nats' } } }),
    }) as never;

    await expect(
      ensureStream(nc, JETSTREAM_STREAMS.AUDIT, monitor),
    ).rejects.toThrow(/-sd \/data/);

    global.fetch = original;
  }, 30_000);
});
