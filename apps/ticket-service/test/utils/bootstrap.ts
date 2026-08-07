import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { DatabaseSeeder } from '../../src/modules/prisma/database.seeder';
import { stopExportWorker } from './export-worker';

export type E2eFixture = {
  moduleRef: TestingModule;
  prisma: PrismaService;
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

  // The export worker, stopped — see `stopExportWorker` for both reasons.
  await stopExportWorker(moduleRef);

  // Explicit, rather than relying on OnApplicationBootstrap: SEED_ON_BOOTSTRAP
  // is false in .env.test precisely so there is ONE seeding path. This is what
  // applies `ticket_assignments_current_key` — skip it and the concurrent-
  // reassign test passes for the wrong reason, because the index it targets was
  // never created.
  await seeder.seed();

  const reset = async (): Promise<void> => {
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
        "ticket_daily_stats",
        "agent_daily_stats",
        "tickets"
      RESTART IDENTITY CASCADE;
    `);

    // Cheap — everything it creates already exists — but kept because it is
    // idempotent DDL, and a test that drops an index cannot then leak into the
    // next one.
    await seeder.seed();
  };

  const close = async (): Promise<void> => {
    await moduleRef.close();
  };

  return { moduleRef, prisma, reset, close };
}
