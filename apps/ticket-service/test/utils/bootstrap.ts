import { Test, TestingModule } from '@nestjs/testing';
import { obliterateQueues } from '@synapsedesk/common/testing/queues';
import {
  ANALYTICS_EXPORT_QUEUE,
  AuditPublisher,
  MAX_ANALYTICS_RANGE_DAYS,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  SCHEDULER_QUEUE,
} from '@synapsedesk/common';
import { AuthReferenceService } from '../../src/modules/auth-client/auth-reference.service';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { DatabaseSeeder } from '../../src/modules/prisma/database.seeder';
import { stopWorkers } from './export-worker';

export type E2eFixture = {
  moduleRef: TestingModule;
  prisma: PrismaService;
  /**
   * The audit publisher, STUBBED.
   *
   * Not merely observed: `record()` emits to NATS, and this service now
   * publishes as well as consuming — an unstubbed suite would put test rows on
   * a developer's broker and mirror every one to the log.
   */
  audit: { record: jest.SpyInstance };
  /** Empty every table, then re-apply the DDL. Call in `beforeEach`. */
  reset: () => Promise<void>;
  close: () => Promise<void>;
};

/**
 * Boots the real ticket-service wiring — real Prisma, real services, real
 * seeder — against the TEST database (see .env.test).
 *
 * Same shape as auth-service's, deliberately: a developer who has read one
 * already knows how this one works. What differs is `reset()`, and only because
 * Domain B has no seeded reference data to preserve — see below.
 */
export async function bootstrapE2eTest(): Promise<E2eFixture> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const prisma = moduleRef.get(PrismaService);
  const seeder = moduleRef.get(DatabaseSeeder);

  // `compile()` alone does not run `onModuleInit`, so nothing has connected
  // yet. `init()` fires the module lifecycle (PrismaService.$connect) without
  // binding a gRPC listener or a NATS connection — neither of which most suites
  // want. The bootstrap smoke spec starts those explicitly.
  await moduleRef.init();

  // The export worker, stopped — see `stopWorkers` for both reasons.
  await stopWorkers(moduleRef);

  // Explicit, rather than relying on OnApplicationBootstrap: SEED_ON_BOOTSTRAP
  // is false in .env.test precisely so there is ONE seeding path. This is what
  // applies `ticket_assignments_current_key` — skip it and the concurrent-
  // reassign test passes for the wrong reason, because the index it targets was
  // never created.
  await seeder.seed();

  // Stubbed BEFORE anything can call it. `AuditPublisher` lives in
  // `libs/common` and is provided by the @Global `EventsModule`, so one spy
  // covers every caller in the service.
  const auditPublisher = moduleRef.get(AuditPublisher);
  const audit = {
    record: jest.spyOn(auditPublisher, 'record').mockImplementation(() => {}),
  };

  // **The tenant attachment ceilings, defaulted to the platform ones.**
  //
  // `getAttachmentLimits` calls auth-service, which is not running for these
  // suites, and it FAILS CLOSED — so without this every message-create and
  // every attachment presign in the service answers UNAVAILABLE.
  //
  // Defaulted here rather than per suite because "no override configured" is
  // the state almost every test means, and it is what the constants alone used
  // to express. A suite testing a NARROWED tenant overrides this spy; the
  // failure mode itself is covered by `limit-composition.spec.ts` on the
  // ingestion side, where the composition lives.
  // **Re-armed in `reset()`, not just here.** Several suites call
  // `jest.restoreAllMocks()` in `afterEach`, which removes a spy installed at
  // bootstrap — so a one-time install works for exactly the first test in those
  // files and then every later one answers UNAVAILABLE.
  const authReference = moduleRef.get(AuthReferenceService);
  const armAttachmentLimits = () => {
    jest.spyOn(authReference, 'getAttachmentLimits').mockResolvedValue({
      maxBytes: MAX_ATTACHMENT_BYTES,
      maxPerMessage: MAX_ATTACHMENTS_PER_MESSAGE,
    });
    // Same reasoning, same failure direction: `getAnalyticsRangeDays` reads
    // auth and fails closed, so without it every analytics read in the service
    // answers UNAVAILABLE. A suite testing a NARROWED window overrides it.
    jest
      .spyOn(authReference, 'getAnalyticsRangeDays')
      .mockResolvedValue(MAX_ANALYTICS_RANGE_DAYS);
  };

  armAttachmentLimits();

  const reset = async (): Promise<void> => {
    audit.record.mockClear();
    armAttachmentLimits();
    // TRUNCATE, unlike auth-service's careful DELETE-with-predicate, because
    // Domain B seeds no ROWS at all: there is no permission catalogue, no system
    // actor and no global role to preserve. Every row in this database belongs
    // to a test, so emptying all of them is exactly right.
    //
    // RESTART IDENTITY resets `tickets.ticket_number` too, which matters: the
    // sequence is global and shared, so without this a suite's expectations
    // about ticket numbers would depend on how many tests ran before it.
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "message_attachments",
        "ticket_messages",
        "ticket_assignments",
        "ai_summaries",
        "ai_response_feedbacks",
        "audit_logs",
        "analytics_exports",
        -- Inbound-email idempotency. A row surviving into the
        -- next test makes the FIRST delivery of a message look like a
        -- redelivery, which fails as ALREADY_EXISTS — a failure that reads as
        -- a dedup bug rather than as a dirty fixture.
        "inbound_emails",
        "ticket_daily_stats",
        "agent_daily_stats",
        -- The heartbeat. Not tenant data, but a row surviving into the next
        -- test carries its consecutive_failures with it — which made a
        -- two-failure assertion read 3.
        "job_runs",
        "tickets"
      RESTART IDENTITY CASCADE;
    `);

    // Cheap — everything it creates already exists — but kept because it is
    // idempotent DDL, and a test that drops an index cannot then leak into the
    // next one.
    await seeder.seed();
  };

  const close = async (): Promise<void> => {
    // BEFORE the module closes: the registrar's repeat entries outlive this
    // process otherwise, and the next suite to boot a worker on
    // `scheduler-ticket` executes them. The export queue rides along for the
    // same reason ingestion obliterates its work queues — a leftover job is a
    // leftover job.
    await obliterateQueues([SCHEDULER_QUEUE.ticket, ANALYTICS_EXPORT_QUEUE]);
    await moduleRef.close();
  };

  return { moduleRef, prisma, audit, reset, close };
}
