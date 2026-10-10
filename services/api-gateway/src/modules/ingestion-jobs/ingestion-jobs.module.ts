import { Module } from '@nestjs/common';
import { IngestionJobsController } from './ingestion-jobs.controller';
import { IngestionJobsService } from './ingestion-jobs.service';
import { IngestionJobsGrpcClient } from './ingestion-jobs-grpc.client';
import { IngestionJobsResolver } from './ingestion-jobs.resolver';

/**
 * The ingestion pipeline worklist.
 *
 * Both surfaces. The GraphQL one earns its place on the `document` edge alone:
 * the REST shape carries `documentId` and no title, so the pipeline dashboard is
 * two round trips without it. The read-side subset rule still holds
 * — `resolvers.spec.ts` pins the file list, so this addition was a deliberate
 * edit there too.
 */
@Module({
  controllers: [IngestionJobsController],
  providers: [
    IngestionJobsService,
    IngestionJobsGrpcClient,
    IngestionJobsResolver,
  ],
  exports: [IngestionJobsService],
})
export class IngestionJobsModule {}
