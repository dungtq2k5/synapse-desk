import { Module } from '@nestjs/common';
import { IngestionJobsController } from './ingestion-jobs.controller';
import { IngestionJobsService } from './ingestion-jobs.service';
import { IngestionJobsGrpcClient } from './ingestion-jobs-grpc.client';

/**
 * The ingestion pipeline worklist.
 *
 * Controller only — no resolver. The GraphQL surface is a read-side subset
 * rather than a mirror, and `resolvers.spec.ts` pins its file list.
 */
@Module({
  controllers: [IngestionJobsController],
  providers: [IngestionJobsService, IngestionJobsGrpcClient],
  exports: [IngestionJobsService],
})
export class IngestionJobsModule {}
