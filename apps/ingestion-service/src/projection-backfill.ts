/**
 * @file The chunk-usage backfill, as a process rather than a scheduled step.
 *
 * **Where the counters get their starting values.** `ChunkUsageProjection`
 * ADDS to `document_chunks.retrieval_count` / `citation_count` over the
 * interval since its cursor, so it needs a cursor to add from — and the
 * nightly job refuses to invent one.
 *
 * **Why this is not the first nightly run.** Deriving the counters from the
 * whole ledger means resetting them first, and a reset is an `UPDATE` over
 * every chunk row: it row-locks the same table `writeChunkRows` deletes from
 * and inserts into on every upload. Inside a 02:00 job that lock lands on live
 * ingestion with nobody watching. Here it is batched, and it is somebody's
 * deliberate command.
 *
 * Run once per database:
 *
 *   npm run projection:backfill -w @synapsedesk/ingestion-service
 *
 * Safe to re-run: it finds the cursor, skips the reset, and projects whatever
 * interval is outstanding. An interrupted run resumes for the same reason —
 * each window commits its own cursor.
 *
 * The application context is created rather than a `PrismaClient` built by
 * hand, so the work runs through the same provider the scheduler uses.
 */

import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { PROJECTION_LAG_MS } from '@synapsedesk/common';
import { envValidationSchema } from './common/configs/env.validation';
import { PrismaModule } from './modules/prisma/prisma.module';
import { ChunkUsageProjection } from './modules/scheduled/chunk-usage.projection';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true },
    }),
    PrismaModule,
  ],
  providers: [ChunkUsageProjection],
})
class ProjectionBackfillModule {}

async function main(): Promise<void> {
  const logger = new Logger('projection-backfill');
  const context = await NestFactory.createApplicationContext(
    ProjectionBackfillModule,
  );

  try {
    // The same lag the nightly run uses, and for the same reason: a generation
    // committing a moment after this statement began would otherwise be skipped
    // forever, because the cursor has already moved past it.
    const updated = await context
      .get(ChunkUsageProjection)
      .backfill(new Date(Date.now() - PROJECTION_LAG_MS));

    logger.log(`Backfill applied ${updated} chunk counter update(s)`);
  } finally {
    await context.close();
  }
}

// A non-zero exit is the contract, as with `schema-apply`: an operator running
// this needs to know it did not finish.
main().catch((error: unknown) => {
  new Logger('projection-backfill').error(
    `Backfill failed: ${(error as Error).message}`,
    (error as Error).stack,
  );
  process.exit(1);
});
