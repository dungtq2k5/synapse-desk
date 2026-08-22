import { NestFactory } from '@nestjs/core';
import { waitUntil } from '@synapsedesk/common/testing/wait';
import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MicroserviceOptions } from '@nestjs/microservices';
import { headers, NatsConnection } from 'nats';
import { faker } from '@faker-js/faker';
import {
  AUDIT_PATTERNS,
  AuditAction,
  AuditResourceType,
  createNatsTransport,
  ensureStream,
  JETSTREAM_CONNECTION,
  JETSTREAM_STREAMS,
  PullConsumerRunner,
  RecordAuditCommand,
} from '@synapsedesk/common';
import { AuditConsumer } from '../../src/modules/audit/audit.consumer';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { faultInjector } from '@synapsedesk/common/testing/fault';
import { stopWorkers } from '../utils';

/**
 * The audit consumer, driven over a REAL JetStream stream.
 *
 * Calling `consumer.record(command)` directly would prove the Prisma write and
 * nothing else — and the write is the part least likely to be wrong. What this
 * suite is for is the WIRE: that a payload published to `audit.record` by a
 * process that is not this one reaches the handler, is acked, and is redelivered
 * when it is not. That is precisely what a direct method call cannot tell you,
 * and precisely what broke silently for the whole of Domain A while nothing was
 * subscribed.
 *
 * **The transport is the durable one now** (ADR 0041), so the suite drives a
 * real `PullConsumerRunner` against a real stream rather than a Nest
 * `@EventPattern`. Nest's NATS transport is core-only and would never receive
 * these messages.
 */
describe('AuditConsumer over NATS (e2e)', () => {
  // Every injected fault in this file is registered here and restored in an
  // `afterEach` that runs whether the test passed, failed or threw.
  const faults = faultInjector();

  let app: INestApplication;
  let prisma: PrismaService;
  let nats: NatsConnection;
  let runner: PullConsumerRunner<RecordAuditCommand>;

  /** This suite's own durable. Named once so teardown can remove exactly it. */
  const AUDIT_DURABLE = 'audit-consumer-e2e';

  /** A valid RecordAuditCommand with sane defaults, one field overridable at a
   * time. Module scope for the same reason as waitUntil() above — no closure. */
  const auditCommand = (
    overrides: Partial<RecordAuditCommand> = {},
  ): RecordAuditCommand => {
    return {
      // Fresh per command: two calls are two ACTS, and reusing one id would
      // make every test in this file dedupe against the last.
      eventId: faker.string.uuid(),
      action: AuditAction.USER_CREATED,
      organizationId: faker.string.uuid(),
      userId: faker.string.uuid(),
      origin: { ip: '203.0.113.7', userAgent: 'jest' },
      resourceType: AuditResourceType.USER,
      resourceId: faker.string.uuid(),
      metadata: { before: { fullName: 'Old' }, after: { fullName: 'New' } },
      occurredAt: new Date().toISOString(),
      ...overrides,
    };
  };

  /**
   * Publishes the way `AuditPublisher` actually does — onto the stream, with
   * `eventId` as `Nats-Msg-Id`.
   *
   * `messageId` is overridable so a test can separate the two dedupe mechanisms:
   * reusing the id exercises the STREAM's publish window, while reusing the
   * `eventId` in the body with a fresh id exercises the CONSUMER's unique index.
   * They look like the same test and defend against different failures.
   */
  async function publishAndWait(
    payload: unknown,
    predicate: () => Promise<boolean>,
    timeoutMs = 5_000,
    messageId?: string,
  ): Promise<boolean> {
    const id =
      messageId ??
      (payload as RecordAuditCommand)?.eventId ??
      faker.string.uuid();
    const message = headers();
    message.set('Nats-Msg-Id', id);

    await nats
      .jetstream()
      .publish(
        AUDIT_PATTERNS.record,
        new TextEncoder().encode(JSON.stringify(payload)),
        { headers: message },
      );

    return waitUntil(predicate, timeoutMs);
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, {
      logger: false,
      abortOnError: false,
    });
    const configService = app.get(ConfigService);

    app.connectMicroservice<MicroserviceOptions>(
      createNatsTransport(configService),
    );
    await app.startAllMicroservices();
    await app.init();

    prisma = app.get(PrismaService);
    nats = app.get<NatsConnection>(JETSTREAM_CONNECTION);

    const monitorUrl = configService.getOrThrow<string>('NATS_MONITOR_URL');
    await ensureStream(nats, JETSTREAM_STREAMS.AUDIT, monitorUrl);
    await ensureStream(nats, JETSTREAM_STREAMS.DLQ, monitorUrl);

    // **Both of these clean up state that OUTLIVES a run, and a durable
    // consumer is exactly that.** The name is stable — that is the whole point
    // of durability — so a previous run's unacked messages are still pending
    // against it, and this suite would spend its first tests draining a backlog
    // while asserting `count() === 1`. Seen for real: seven messages pending
    // from an earlier run, failing two tests that pass in isolation.
    //
    // Deleting only what this suite NAMED, per the rule known-gaps #14 records.
    // The stream itself is left alone.
    const manager = await nats.jetstreamManager();
    await manager.consumers
      .delete(JETSTREAM_STREAMS.AUDIT.name, AUDIT_DURABLE)
      .catch(() => undefined);
    await manager.streams.purge(JETSTREAM_STREAMS.AUDIT.name);

    // A durable name of its own, so a leftover consumer from the service's real
    // bootstrap cannot steal this suite's messages — WorkQueue retention means
    // exactly one reader gets each one.
    runner = new PullConsumerRunner<RecordAuditCommand>({
      connection: nats,
      stream: JETSTREAM_STREAMS.AUDIT.name,
      durable: AUDIT_DURABLE,
      filterSubject: AUDIT_PATTERNS.record,
      handler: (command) => app.get(AuditConsumer).record(command),
      // Production waits 30/45/60/90s, which is 225s no jest run can sit
      // through. These tests assert the retry MECHANISM — that a nak comes back,
      // that the fifth failure parks — not the durations, which
      // `jetstream.config.spec.ts` checks against the dedupe window instead.
      //
      // Not arbitrarily small: each entry also replaces `ack_wait`, so a value
      // under the handler's own runtime would redeliver a message still being
      // written and every test here would see phantom duplicates.
      backoffMs: [1_500, 1_500, 1_500, 1_500],
    });
    await runner.start();
  }, 30_000);

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
  });

  afterAll(async () => {
    await stopWorkers(app);
    await runner?.stop();

    // Removed rather than left pending, so the next run starts empty. Without
    // this the consumer is the thing that leaks, not the messages.
    const manager = await nats.jetstreamManager();
    await manager.consumers
      .delete(JETSTREAM_STREAMS.AUDIT.name, AUDIT_DURABLE)
      .catch(() => undefined);

    // `nats` is the container's connection; `app.close()` drains it.
    await app?.close();
  });

  it('1. a full payload creates exactly ONE row with matching fields', async () => {
    const command = auditCommand();

    const arrived = await publishAndWait(
      command,
      async () => (await prisma.auditLog.count()) === 1,
    );
    expect(arrived).toBe(true);

    const row = await prisma.auditLog.findFirstOrThrow();
    expect(row.organizationId).toBe(command.organizationId);
    expect(row.userId).toBe(command.userId);
    expect(row.action).toBe(command.action);
    expect(row.resourceType).toBe(command.resourceType);
    expect(row.resourceId).toBe(command.resourceId);
    expect(row.ipAddress).toBe(command.origin.ip);
    expect(row.userAgent).toBe(command.origin.userAgent);
    expect(row.metadata).toEqual(command.metadata);
  });

  it('**1c. the SAME event delivered twice writes ONE row**', async () => {
    // The half that makes at-least-once delivery safe. JetStream WILL deliver
    // the same message twice — a nak, an AckWait expiry, a consumer restart
    // mid-ack — and an audit trail that counted it twice would inflate "how
    // many times did X happen", the question it exists to answer.
    //
    // This is CONSUMER idempotency, and it is not the same thing as the
    // stream's publish dedupe: `Nats-Msg-Id` collapses two PUBLISHES inside a
    // window, and cannot see a redelivery of a message it already accepted.
    // Two mechanisms, two failures, and testing one does not cover the other.
    const command = auditCommand();

    await publishAndWait(
      command,
      async () => (await prisma.auditLog.count()) === 1,
    );

    // The identical command again — same `eventId`, which is what a redelivery
    // is. **A fresh `Nats-Msg-Id` is essential**: leaving it defaulted to
    // `eventId` makes the STREAM collapse the second publish, so the consumer
    // never sees it and this test passes without the unique index existing at
    // all. That is the exact conflation the two mechanisms invite.
    await publishAndWait(
      command,
      async () => (await prisma.auditLog.count()) === 1,
      5_000,
      faker.string.uuid(),
    );

    // Given a moment to write a second row if it were going to.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await prisma.auditLog.count()).toBe(1);
  });

  it('**1e. and a redelivery is not logged as a FAILURE**', async () => {
    // 1c cannot tell these two apart, which is why this test exists. Delete the
    // consumer's `isUniqueConstraintViolation` arm and 1c still passes: the
    // unique index rejects the second INSERT either way, so the row count is 1
    // whether the handler understood the duplicate or merely survived it.
    //
    // What changes is the log level. Falling through to the generic arm files
    // an ERROR for something that is normal and expected under at-least-once
    // delivery — so a healthy consumer emits alert-worthy noise on every
    // redelivery, and the operator learns to ignore the one channel that would
    // have told them about a real failure.
    const error = faults.replace(Logger.prototype, 'error', () => {});

    const command = auditCommand();

    await publishAndWait(
      command,
      async () => (await prisma.auditLog.count()) === 1,
    );
    // Fresh message id, for the reason spelled out in 1c.
    await publishAndWait(
      command,
      async () => (await prisma.auditLog.count()) === 1,
      5_000,
      faker.string.uuid(),
    );

    // Given the same moment 1c gives it to do the wrong thing.
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(await prisma.auditLog.count()).toBe(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('1d. and two DISTINCT acts that are otherwise identical both write', async () => {
    // The other side, and the reason `eventId` is generated rather than hashed
    // from the contents: the same admin locking the same user twice in one
    // second is two events, and a content hash would silently record one.
    const first = auditCommand();
    const second = { ...first, eventId: faker.string.uuid() };

    await publishAndWait(
      first,
      async () => (await prisma.auditLog.count()) === 1,
    );
    await publishAndWait(
      second,
      async () => (await prisma.auditLog.count()) === 2,
    );

    expect(await prisma.auditLog.count()).toBe(2);
  });

  it('**1f. the same Nats-Msg-Id twice STREAMS one message**', async () => {
    // The publisher-side half, and the one §7 flags as most likely to be skipped
    // and most likely to be wrong. `duplicate_window` collapses two PUBLISHES;
    // the unique index absorbs two DELIVERIES. Testing either does not cover the
    // other.
    //
    // The discriminator is a DIFFERENT `eventId` under the SAME `Nats-Msg-Id`.
    // If the stream dedupes, one message is stored and one row written. If it
    // does not, two messages arrive carrying ids the consumer has every right to
    // treat as distinct acts — so it writes two, and the count tells them apart.
    // Publishing identical bodies would give one row either way.
    const messageId = faker.string.uuid();

    await publishAndWait(
      auditCommand(),
      async () => (await prisma.auditLog.count()) === 1,
      5_000,
      messageId,
    );
    await publishAndWait(
      auditCommand(),
      async () => (await prisma.auditLog.count()) === 1,
      5_000,
      messageId,
    );

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await prisma.auditLog.count()).toBe(1);
  });

  it("1b. createdAt is the PUBLISHER's clock, not the consumer's", async () => {
    // A consumer restart must not backdate a backlog of events to the moment it
    // caught up — the point of an audit timestamp is when the thing happened.
    const occurredAt = new Date('2026-01-15T09:30:00.000Z');
    const command = auditCommand({ occurredAt: occurredAt.toISOString() });

    await publishAndWait(
      command,
      async () => (await prisma.auditLog.count()) === 1,
    );

    const row = await prisma.auditLog.findFirstOrThrow();
    expect(row.createdAt.toISOString()).toBe(occurredAt.toISOString());
  });

  it('3. organizationId NULL is preserved, never coerced to a tenant', async () => {
    // A platform-level act belongs to the platform (RDM §1.7). Filing it under
    // the actor's own tenant would put an operator's action inside a customer's
    // audit trail — wrong, and a disclosure. This is Domain A's invariant now
    // exercised end to end, through NATS, into Domain B's table.
    const command = auditCommand({
      organizationId: null,
      action: AuditAction.PLATFORM_ORGANIZATION_CREATED,
      resourceType: AuditResourceType.ORGANIZATION,
    });

    const arrived = await publishAndWait(
      command,
      async () => (await prisma.auditLog.count()) === 1,
    );
    expect(arrived).toBe(true);

    const row = await prisma.auditLog.findFirstOrThrow();
    expect(row.organizationId).toBeNull();
    expect(row.userId).toBe(command.userId);
  });

  it('a system actor with NO userId is stored, not rejected', async () => {
    // Cron and system actors have no user row acting for them, so a validator
    // that required `userId` would drop exactly the events nobody can otherwise
    // account for.
    const command = auditCommand({ userId: null });

    const arrived = await publishAndWait(
      command,
      async () => (await prisma.auditLog.count()) === 1,
    );
    expect(arrived).toBe(true);
    expect((await prisma.auditLog.findFirstOrThrow()).userId).toBeNull();
  });

  describe('2. malformed payloads are dropped, never thrown', () => {
    // A handler that throws does not fail safely: with a durable subscription
    // it redelivers the same bad event forever and buries every good one. The
    // proof that it drops rather than throws is that a GOOD event published
    // immediately afterwards still lands.
    const malformed: [string, unknown][] = [
      [
        'no action',
        { organizationId: null, occurredAt: new Date().toISOString() },
      ],
      ['no occurredAt', { action: AuditAction.USER_CREATED }],
      [
        'unparseable occurredAt',
        { action: AuditAction.USER_CREATED, occurredAt: 'not-a-date' },
      ],
      ['an empty object', {}],
      ['a bare string', 'nonsense'],
      ['a number', 42],
    ];

    it.each(malformed)(
      'drops %s and keeps consuming',
      async (_label, payload) => {
        const dropped = await publishAndWait(
          payload,
          async () => (await prisma.auditLog.count()) > 0,
          750,
        );
        expect(dropped).toBe(false);
        expect(await prisma.auditLog.count()).toBe(0);

        // The consumer is still alive: a well-formed event published after the
        // bad one still lands. This is the assertion that distinguishes "dropped"
        // from "the subscription died".
        const recovered = await publishAndWait(
          auditCommand(),
          async () => (await prisma.auditLog.count()) === 1,
        );
        expect(recovered).toBe(true);
      },
    );
  });

  it('a payload with EXTRA unknown fields is still stored', async () => {
    // Forward compatibility in the direction that actually happens: a newer
    // publisher adds a field, an older consumer must not reject the event over
    // something it does not read.
    const command = {
      ...auditCommand(),
      somethingAddedLater: 'from a newer auth-service',
    };

    const arrived = await publishAndWait(
      command,
      async () => (await prisma.auditLog.count()) === 1,
    );
    expect(arrived).toBe(true);
  });

  it('two events produce two rows — the consumer is not one-shot', async () => {
    await publishAndWait(
      auditCommand(),
      async () => (await prisma.auditLog.count()) === 1,
    );
    const both = await publishAndWait(
      auditCommand(),
      async () => (await prisma.auditLog.count()) === 2,
    );

    expect(both).toBe(true);
  });

  it('**a PERMANENT failure is parked in the DLQ after MAX_DELIVER**', async () => {
    // The other end of the same mechanism, and the reason `MAX_DELIVER` exists.
    // AUDIT is a WorkQueue stream, so a message that is nak'd forever is not
    // merely stuck — it holds its place and everything behind it waits. This is
    // doc 40 §3 and doc 49 §2 arriving from a third direction.
    //
    // Parked rather than dropped: `term()` alone is a silent loss, and the whole
    // point of a durable subject is that nothing vanishes without a trace.
    faults.replace(Logger.prototype, 'error', (() => {}) as never);
    faults.replace(Logger.prototype, 'warn', (() => {}) as never);
    faults.fail(prisma.auditLog, 'create', new Error('permanently broken'));

    const before = (
      await nats.jetstreamManager().then((m) => m.streams.info('DLQ'))
    ).state.messages;

    // `async` with nothing awaited, and it stays: `waitUntil` takes
    // `() => Promise<boolean>`, so `() => false` does not typecheck. The
    // predicate is deliberately never satisfied — this call is "publish, then
    // wait a beat", and the parking is asserted below.
    // eslint-disable-next-line @typescript-eslint/require-await
    await publishAndWait(auditCommand(), async () => false, 1_000);

    // MAX_DELIVER naks, each immediate, then the republish and the term.
    const parked = await waitUntil(async () => {
      const manager = await nats.jetstreamManager();
      const info = await manager.streams.info('DLQ');

      return info.state.messages > before;
    }, 25_000);

    expect(parked).toBe(true);
    // And the row was never written, so nothing was half-done.
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('**a command with no eventId is PARKED without retrying**', async () => {
    // The gap the type does not close. `RecordAuditCommand.eventId` is `string`,
    // but this subject has no `@EventPattern` and so no deserializer — whatever
    // JSON reaches the stream reaches the handler. Written as NULL it would not
    // conflict in the unique index, so the row and every redelivery of it are
    // inserted again: the dedupe guard bypassed rather than missing.
    faults.replace(Logger.prototype, 'error', (() => {}) as never);

    const manager = await nats.jetstreamManager();
    const before = (await manager.streams.info('DLQ')).state.messages;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { eventId: _dropped, ...withoutEventId } = auditCommand();
    // eslint-disable-next-line @typescript-eslint/require-await
    await publishAndWait(withoutEventId, async () => false, 1_000);

    const parked = await waitUntil(async () => {
      const info = await manager.streams.info('DLQ');

      return info.state.messages > before;
    }, 15_000);

    expect(parked).toBe(true);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('**and parks it on the FIRST delivery, spending no retry budget**', async () => {
    // The half that separates `UnprocessableMessage` from an ordinary throw. A
    // missing field cannot become present on redelivery, so naking it five times
    // enters the poison-message loop MAX_DELIVER exists to bound — deliberately,
    // and 225s of backoff later it parks in the same place.
    //
    // Asserted through the WARN the retry path logs: the parked path must not
    // produce one.
    const warn = faults.replace(Logger.prototype, 'warn', (() => {}) as never);
    faults.replace(Logger.prototype, 'error', (() => {}) as never);

    const manager = await nats.jetstreamManager();
    const before = (await manager.streams.info('DLQ')).state.messages;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { eventId: _dropped, ...withoutEventId } = auditCommand();
    // eslint-disable-next-line @typescript-eslint/require-await
    await publishAndWait(withoutEventId, async () => false, 1_000);

    await waitUntil(async () => {
      const info = await manager.streams.info('DLQ');

      return info.state.messages > before;
    }, 15_000);

    const retries = warn.mock.calls.filter(([message]) =>
      String(message).includes('retrying in'),
    );
    expect(retries).toHaveLength(0);
  });

  it('**a transient failure is NAKd and the redelivery succeeds**', async () => {
    // The test that proves ack semantics are wired at all. Everything else in
    // this file would pass against a consumer that acked on delivery.
    //
    // A database error is NOT a malformed payload, and the two take opposite
    // paths on purpose: a malformed event can never succeed, so it is dropped
    // and acked, while a failed write is exactly what redelivery exists for.
    // Before ADR 0041 both were swallowed, because there was no redelivery to
    // ask for.
    const error = faults.replace(
      Logger.prototype,
      'error',
      (() => {}) as never,
    );
    // `failOnce`, not `fail`: the first delivery must fail and the SECOND must
    // succeed, which is the whole assertion. A permanent fault would only prove
    // it kept retrying.
    faults.failOnce(
      prisma.auditLog,
      'create',
      new Error('database is on fire'),
    );

    // No fault is lifted by hand here — the row can only appear on a delivery
    // after the first, so its existence IS the redelivery.
    const redelivered = await publishAndWait(
      auditCommand(),
      async () => (await prisma.auditLog.count()) === 1,
      15_000,
    );

    expect(redelivered).toBe(true);
    expect(error).toHaveBeenCalled();
  });
});
