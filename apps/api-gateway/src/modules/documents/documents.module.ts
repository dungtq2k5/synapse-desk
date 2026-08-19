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
  exports: [DocumentsService],
})
export class DocumentsModule {}
