import { NestFactory } from '@nestjs/core';
import { waitUntil } from '@synapsedesk/common/testing/wait';
import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ClientProxy,
  ClientProxyFactory,
  MicroserviceOptions,
} from '@nestjs/microservices';
import { connect, NatsConnection } from 'nats';
import { faker } from '@faker-js/faker';
import {
  AUDIT_PATTERNS,
  AuditAction,
  AuditResourceType,
  createNatsTransport,
  RecordAuditCommand,
} from '@synapsedesk/common';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { faultInjector } from '@synapsedesk/common/testing/fault';
import { stopWorkers } from '../utils';

/**
 * The audit consumer, driven over a REAL NATS connection.
 *
 * Calling `consumer.record(command)` directly would prove the Prisma write and
 * nothing else — and the write is the part least likely to be wrong. What this
 * suite is for is the WIRE: that a payload published to `audit.record` by a
 * process that is not this one is decoded into the shape the handler expects.
 * That is precisely what a direct method call cannot tell you, and precisely
 * what broke silently for the whole of Domain A while nothing was subscribed.
 *
 * BOTH framings are exercised. auth-service publishes through a Nest
 * `ClientProxy`, which wraps the payload as `{ pattern, data }` — that is the
 * production path and the default here. A bare `nats.publish` takes a different
 * branch of Nest's deserializer, which maps a payload carrying neither
 * `pattern` nor `data` onto the SUBJECT as its pattern; that fallback is what
 * lets a non-Nest producer reach a `@EventPattern` handler at all, and it has
 * one test of its own.
 */
describe('AuditConsumer over NATS (e2e)', () => {
  // Every injected fault in this file is registered here and restored in an
  // `afterEach` that runs whether the test passed, failed or threw — 16-doc §9.
  const faults = faultInjector();

  let app: INestApplication;
  let prisma: PrismaService;
  let nats: NatsConnection;
  let client: ClientProxy;

  /** A valid RecordAuditCommand with sane defaults, one field overridable at a
   * time. Module scope for the same reason as waitUntil() above — no closure. */
  const auditCommand = (
    overrides: Partial<RecordAuditCommand> = {},
  ): RecordAuditCommand => {
    return {
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
   * Publishes the way auth-service actually does — through a Nest `ClientProxy`,
   * which wraps the payload as `{ pattern, data }`.
   *
   * This is the PRODUCTION framing and therefore the default here. A bare
   * `nats.publish` takes a different path through Nest's deserializer (see the
   * raw-publish test below), and testing only that one would leave the framing
   * every real event uses unexercised.
   */
  async function publishAndWait(
    payload: unknown,
    predicate: () => Promise<boolean>,
    timeoutMs = 5_000,
  ): Promise<boolean> {
    await new Promise<void>((resolve, reject) => {
      client.emit(AUDIT_PATTERNS.record, payload).subscribe({
        complete: () => resolve(),
        error: reject,
      });
    });

    return waitUntil(predicate, timeoutMs);
  }

  /** Publishes with no Nest envelope at all, as a non-Nest producer would. */
  async function publishRawAndWait(
    payload: unknown,
    predicate: () => Promise<boolean>,
    timeoutMs = 5_000,
  ): Promise<boolean> {
    nats.publish(
      AUDIT_PATTERNS.record,
      new TextEncoder().encode(JSON.stringify(payload)),
    );
    await nats.flush();

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
    nats = await connect({ servers: [configService.getOrThrow('NATS_URL')] });
    client = ClientProxyFactory.create(createNatsTransport(configService));
    await client.connect();
  }, 30_000);

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
  });

  afterAll(async () => {
    await stopWorkers(app);
    await client?.close();
    await nats?.close();
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

  it('a RAW publish reaches the handler too — the non-Nest producer path', async () => {
    // Nest's deserializer decides whether a payload is already an envelope by
    // asking whether it carries `pattern`/`data`. A `RecordAuditCommand` has
    // neither, so a bare publish falls through to the subject-as-pattern
    // fallback — which is what lets a future Python service, a CLI probe or an
    // ops script write to the trail without speaking Nest's framing.
    //
    // Worth its own test because the fallback is invisible: it is a branch in a
    // library, and nothing in this repo would notice if a config change
    // disabled it.
    const arrived = await publishRawAndWait(
      auditCommand(),
      async () => (await prisma.auditLog.count()) === 1,
    );

    expect(arrived).toBe(true);
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

  it('the handler logs and swallows a PERSISTENCE failure', async () => {
    // The other half of "never throws": a database error is not a malformed
    // payload, and it must not escape either.
    const error = faults.replace(
      Logger.prototype,
      'error',
      (() => {}) as never,
    );
    // Restored mid-test on purpose — the recovery assertion below needs the
    // write working again. The injector still restores it at teardown, so a
    // failure before that line cannot leak the fault.
    const create = faults.fail(
      prisma.auditLog,
      'create',
      new Error('database is on fire'),
    );

    await publishAndWait(auditCommand(), () =>
      Promise.resolve(error.mock.calls.length > 0),
    );

    expect(error).toHaveBeenCalled();
    create.mockRestore();

    // And it is still consuming afterwards.
    const recovered = await publishAndWait(
      auditCommand(),
      async () => (await prisma.auditLog.count()) === 1,
    );
    expect(recovered).toBe(true);
  });
});
