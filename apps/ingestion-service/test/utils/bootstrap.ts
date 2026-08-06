import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { INGESTION_QUEUE, SCOPE_FANOUT_QUEUE } from '@synapsedesk/common';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { DatabaseSeeder } from '../../src/modules/prisma/database.seeder';
import { EMBEDDING_CLIENT } from '../../src/modules/embeddings/embedding.contract';
import { FakeEmbeddingClient } from './fake-embedding.client';

export type E2eFixture = {
  moduleRef: TestingModule;
  prisma: PrismaService;
  /** The substitute the pipeline embeds through. Assert against it. */
  embeddings: FakeEmbeddingClient;
  /** Empty every table. Call in `beforeEach`. */
  reset: () => Promise<void>;
  close: () => Promise<void>;
};

/**
 * Boots the real ingestion-service wiring — real Prisma, real services, real
 * seeder — against the TEST database (see .env.test).
 *
 * Same shape as ticket-service's, and `reset()` is TRUNCATE for the same
 * reason: Domain C seeds no ROWS at all, only DDL, so every row in this
 * database belongs to a test and emptying all of them is exactly right.
 */
export async function bootstrapE2eTest(): Promise<E2eFixture> {
  // The ONE provider replaced, and it has to be replaced before `compile()`
  // rather than after: the real client reads GEMINI_API_KEY in its
  // CONSTRUCTOR, so a test that overrode it later would already have failed
  // to build the container.
  const embeddings = new FakeEmbeddingClient();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(EMBEDDING_CLIENT)
    .useValue(embeddings)
    .compile();

  const prisma = moduleRef.get(PrismaService);
  const seeder = moduleRef.get(DatabaseSeeder);

  // `compile()` alone does not fire `onModuleInit`, so nothing has connected.
  // `init()` runs the module lifecycle without binding a gRPC listener or a
  // NATS connection, neither of which most suites want.
  await moduleRef.init();

  // Explicit, rather than relying on OnApplicationBootstrap: SEED_ON_BOOTSTRAP
  // is false in .env.test precisely so there is ONE seeding path. This is what
  // applies `documents_org_hash_key` and the FTS index — skip it and the dedup
  // test passes on nothing, because the constraint it targets was never made.
  await seeder.seed();

  // Live workers, on queues shared by every suite in this run.
  //
  // `ScopeFanoutProcessor` and `IngestionWorker` are `@Processor`s, so booting
  // the app starts them consuming — and a job enqueued by one test is picked up
  // whenever the worker gets to it, which may be during the NEXT test or the
  // next FILE.
  //
  // That is how `documents.e2e-spec › restore un-flips the chunks` failed under
  // `--randomize` and passed in isolation: the delete had enqueued a fan-out
  // carrying `isDeleted: true`, the restore un-flipped the chunks, and then the
  // deferred job re-applied the stale scope. Identical in shape to the mock
  // leak in 16-doc §9, and it needs the same rule — WORK must not escape its
  // test either.
  const queues = [INGESTION_QUEUE, SCOPE_FANOUT_QUEUE].map((name) =>
    moduleRef.get<Queue>(getQueueToken(name)),
  );

  const reset = async (): Promise<void> => {
    // BEFORE the truncate, and `obliterate` rather than `drain`: `drain` leaves
    // jobs that are already ACTIVE running, and an active job is exactly the
    // one about to write to the table this is emptying.
    await Promise.all(queues.map((queue) => queue.obliterate({ force: true })));

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "document_flags",
        "document_chunks",
        "ingestion_jobs",
        "department_documents",
        "ai_generations",
        "documents"
      RESTART IDENTITY CASCADE;
    `);
  };

  const close = async (): Promise<void> => {
    await reset();
    await moduleRef.close();
  };

  return { moduleRef, prisma, embeddings, reset, close };
}
