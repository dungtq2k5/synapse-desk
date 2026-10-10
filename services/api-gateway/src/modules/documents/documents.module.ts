import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsGrpcClient } from './documents-grpc.client';
import { DocumentsService } from './documents.service';
import { IngestionJobsModule } from '../ingestion-jobs/ingestion-jobs.module';
import { DocumentsController } from './documents.controller';
import { DocumentsResolver } from './documents.resolver';

// `INGESTION_GRPC_CLIENT` needs no import here: `IngestionGrpcModule` is
// `@Global`, so every module shares the one channel to ingestion-service.
@Module({
  imports: [
    // `GET /documents/:id/ingestion-jobs` is a document sub-resource, so its
    // route lives on this controller.
    IngestionJobsModule,
    AuthModule,
  ],
  controllers: [DocumentsController],
  providers: [DocumentsGrpcClient, DocumentsService, DocumentsResolver],
  // `DocumentsGrpcClient` is exported for the two composites that need
  // ingestion's TENANT-SCOPED usage read: the usage meter and the plan-change
  // block. Both are folds the gateway performs because auth cannot dial
  // ingestion, and both must go through this one client rather than opening a
  // second — `IngestionGrpcModule` is `@Global` precisely so there is one
  // channel to that peer.
  exports: [DocumentsService, DocumentsGrpcClient],
})
export class DocumentsModule {}
