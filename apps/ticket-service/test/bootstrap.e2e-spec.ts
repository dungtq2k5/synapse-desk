import { NestFactory } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { credentials, loadPackageDefinition } from '@grpc/grpc-js';
import type { GrpcObject, ServiceClientConstructor } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { connect, NatsConnection } from 'nats';
import {
  GRPC_CHANNEL_OPTIONS,
  GRPC_LOADER_OPTIONS,
  TICKET_PACKAGE_NAME,
  TICKET_PROTO_PATHS,
} from '@synapsedesk/grpc-proto';
import {
  compareAlphabetically,
  createNatsTransport,
} from '@synapsedesk/common';
import { bootstrapE2eTest, E2eFixture } from './utils/bootstrap';
import { buildTenant, buildTicket } from './factories';
import { AppModule } from '../src/app.module';
import { stopWorkers } from './utils';

/**
 * Proves the ticket-service fixture itself, before any suite depends on it.
 *
 * Same reasoning as auth-service's equivalent: every failure below is one that
 * would otherwise surface as a confusing failure in an unrelated module suite —
 * a missing partial index making a concurrency test pass for the wrong reason,
 * or a reset that leaves rows behind and makes the next test's counts wrong.
 */
describe('e2e bootstrap (ticket-service)', () => {
  let fx: E2eFixture;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  });

  beforeEach(() => fx.reset());
  afterAll(() => fx.close());

  it('points at the TEST database, never the dev one', () => {
    expect(process.env.DATABASE_URL).toContain('synapsedesk_ticket_test');
    expect(process.env.DATABASE_URL).not.toMatch(/synapsedesk_ticket\?/);
  });

  it('applies the partial unique index that schema.prisma cannot express', async () => {
    // Without it, the concurrent-reassign test in §2.4 passes for the wrong
    // reason: the service-layer transaction alone cannot stop two callers both
    // reading "no current assignment" and both inserting one.
    const indexes = await fx.prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
    `;

    expect(indexes.map((i) => i.indexname)).toContain(
      'ticket_assignments_current_key',
    );
  });

  it('applies the CHECK constraint on feedback rating', async () => {
    const constraints = await fx.prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
    `;

    expect(constraints.map((c) => c.conname)).toContain(
      'ai_response_feedbacks_rating_check',
    );
  });

  it('the partial index REFUSES a second current assignment for one ticket', async () => {
    // The index is only worth having if it actually bites. Asserting it exists
    // in pg_indexes proves it was created; this proves it was created with the
    // right predicate.
    const tenant = buildTenant();
    const ticket = await fx.prisma.ticket.create({
      data: buildTicket(tenant),
    });

    const row = {
      ticketId: ticket.id,
      departmentId: tenant.departmentId,
      isCurrent: true,
    };

    await fx.prisma.ticketAssignment.create({
      data: { ...row, assignedToId: tenant.agentId },
    });

    await expect(
      fx.prisma.ticketAssignment.create({
        data: { ...row, assignedToId: tenant.userId },
      }),
    ).rejects.toThrow();

    // ...while a NON-current second row is perfectly fine, which is the whole
    // point of the index being partial: the history must stay unbounded.
    await expect(
      fx.prisma.ticketAssignment.create({
        data: { ...row, assignedToId: tenant.userId, isCurrent: false },
      }),
    ).resolves.toBeDefined();
  });

  it('the CHECK constraint REFUSES a rating outside {1, -1}', async () => {
    const tenant = buildTenant();
    const ticket = await fx.prisma.ticket.create({ data: buildTicket(tenant) });
    const message = await fx.prisma.ticketMessage.create({
      data: { ticketId: ticket.id, content: 'x', isAiGenerated: true },
    });

    await expect(
      fx.prisma.aiResponseFeedback.create({
        data: {
          ticketMessageId: message.id,
          userId: tenant.userId,
          organizationId: tenant.organizationId,
          rating: 7,
        },
      }),
    ).rejects.toThrow();
  });

  it('reset() empties every table', async () => {
    const tenant = buildTenant();
    const ticket = await fx.prisma.ticket.create({ data: buildTicket(tenant) });
    await fx.prisma.ticketMessage.create({
      data: { ticketId: ticket.id, content: 'hello' },
    });

    await fx.reset();

    expect(await fx.prisma.ticket.count()).toBe(0);
    expect(await fx.prisma.ticketMessage.count()).toBe(0);
  });

  it('3. concurrent creates produce DISTINCT, sequential ticket numbers', async () => {
    // Proves the Postgres sequence rather than an app-level `MAX() + 1`, which
    // is the way this gets built by accident and the way it silently produces
    // duplicates the first time two people file a ticket at once.
    //
    // `ticket_number` is a global sequence shared by every tenant, so these
    // five come from two different tenants on purpose — the numbers must still
    // be distinct across them.
    const a = buildTenant();
    const b = buildTenant();

    const created = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        fx.prisma.ticket.create({
          data: buildTicket(i % 2 === 0 ? a : b, { title: `Concurrent ${i}` }),
        }),
      ),
    );

    const numbers = created
      .map((t) => Number(t.ticketNumber))
      .sort((x, y) => x - y);

    expect(new Set(numbers).size).toBe(5);
    // Sequential with no gap: `reset()` restarts the identity, so the run
    // begins at 1 regardless of how many tests ran before it.
    expect(numbers).toEqual([1, 2, 3, 4, 5]);
  });

  it('3b. the sequence is GLOBAL, not per tenant', async () => {
    // Two tenants share one counter, so tenant A may hold #1 and #3. A
    // per-tenant sequence would be a nicer product surface and is a deliberate
    // non-goal — this test is what makes that decision visible rather than
    // something a reader has to infer from an absence.
    const a = buildTenant();
    const b = buildTenant();

    const first = await fx.prisma.ticket.create({ data: buildTicket(a) });
    const second = await fx.prisma.ticket.create({ data: buildTicket(b) });
    const third = await fx.prisma.ticket.create({ data: buildTicket(a) });

    expect(Number(second.ticketNumber)).toBe(Number(first.ticketNumber) + 1);
    expect(Number(third.ticketNumber)).toBe(Number(second.ticketNumber) + 1);
  });
});

/**
 * The hybrid-app claim from §1.2, proven rather than asserted in a comment.
 *
 * Separate `describe` because it boots its OWN application with both transports
 * actually bound — the shared fixture deliberately does not, since almost no
 * suite needs a listening socket and binding one per file would make the whole
 * run slower and port-collision-prone.
 */
describe('2. ticket-service boots as a hybrid app (e2e)', () => {
  let app: INestApplication;
  let nats: NatsConnection;
  const url = '127.0.0.1:50253';

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    const configService = app.get(ConfigService);

    app.connectMicroservice<MicroserviceOptions>({
      transport: Transport.GRPC,
      options: {
        package: TICKET_PACKAGE_NAME,
        protoPath: TICKET_PROTO_PATHS,
        url,
        ...GRPC_CHANNEL_OPTIONS,
        loader: GRPC_LOADER_OPTIONS,
      },
    });
    app.connectMicroservice<MicroserviceOptions>(
      createNatsTransport(configService),
    );

    await app.startAllMicroservices();
    // `init()`, not `listen()` — see main.ts. The service serves no HTTP and
    // must not bind a port.
    await app.init();

    nats = await connect({ servers: [process.env.NATS_URL as string] });
  }, 30_000);

  afterAll(async () => {
    // This app has its OWN export worker — see `stopWorkers`.
    await stopWorkers(app);
    await nats?.close();
    await app?.close();
  });

  it('the gRPC server accepts a connection and answers a declared service', async () => {
    const pkg = loadPackageDefinition(
      loadSync(TICKET_PROTO_PATHS, GRPC_LOADER_OPTIONS),
    );
    const ticketPackage = TICKET_PACKAGE_NAME.split('.').reduce<GrpcObject>(
      (node, segment) => node[segment] as GrpcObject,
      pkg,
    );

    const services = Object.entries(ticketPackage)
      .filter(
        ([, entry]) =>
          typeof entry === 'function' &&
          Boolean((entry as Partial<ServiceClientConstructor>).service),
      )
      .map(([name]) => name)
      .sort(compareAlphabetically);

    expect(services).toEqual(
      [
        'AiService',
        // The read projection over Domain B. Served from here rather
        // than from an `analytics-service`, which deliberately does not exist.
        'AnalyticsService',
        'AssignmentService',
        'AuditService',
        'FeedbackService',
        'MessageService',
        'TicketService',
      ].sort(compareAlphabetically),
    );

    // A real channel, actually connected — `waitForReady` fails if nothing is
    // listening, which is the assertion. No RPC is called: there are no
    // handlers registered yet (that is §2.3 onward), and this test is about the
    // TRANSPORT accepting a connection.
    const ctor = ticketPackage.TicketService as ServiceClientConstructor;
    const client = new ctor(url, credentials.createInsecure());

    await new Promise<void>((resolve, reject) => {
      client.waitForReady(Date.now() + 5_000, (error) =>
        error ? reject(error) : resolve(),
      );
    });

    (client as unknown as { close: () => void }).close();
  }, 15_000);

  it('the NATS transport is connected and accepts a publish', async () => {
    // The consumer side has no handler yet either (§2.2 adds AuditConsumer), so
    // what is provable here is that the second transport came up alongside the
    // first — the specific thing `createMicroservice` alone could never do.
    expect(nats.isClosed()).toBe(false);

    nats.publish('ticket.bootstrap.probe', new TextEncoder().encode('{}'));
    await nats.flush();
  });
});
