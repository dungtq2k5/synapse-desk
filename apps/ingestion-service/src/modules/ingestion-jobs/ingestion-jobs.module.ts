import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { IngestionJobsService } from './ingestion-jobs.service';

/**
 * The pipeline worklist.
 *
 * Provides {@link IngestionJobsService} only. The five RPCs are declared on
 * `DocumentService`, so `DocumentsGrpcController` is their transport adapter.
 */
@Module({
  imports: [
    PrismaModule,
    // IMPORTED, never re-provided: `IngestionQueueService` holds the one
    // `Queue` instance, and a second would enqueue retries onto a queue no
    // worker reads.
    IngestionModule,
  ],
  providers: [IngestionJobsService],
  exports: [IngestionJobsService],
})
export class IngestionJobsModule {}
