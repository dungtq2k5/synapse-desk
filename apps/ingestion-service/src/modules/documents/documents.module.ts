import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthClientModule } from '../auth-client/auth-client.module';
import { StorageClientModule } from '../storage-client/storage-client.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { IngestionJobsModule } from '../ingestion-jobs/ingestion-jobs.module';
import { DocumentFlagsModule } from '../document-flags/document-flags.module';
import { DocumentsService } from './documents.service';
import { DocumentsGrpcController } from './documents-grpc.controller';

@Module({
  imports: [
    // For `ScopeWriterService` and the reconciler queue. The document surface
    // is what TRIGGERS a scope change; the ingestion module owns how it is
    // applied, so the ordering rule lives in one place rather than two.
    IngestionModule,
    // The job RPCs are declared on `DocumentService`, so this module's
    // controller adapts them — see `IngestionJobsModule`.
    IngestionJobsModule,
    // Same arrangement as the jobs module: the flag RPCs are declared on
    // `DocumentService`, so this module's controller adapts them.
    DocumentFlagsModule,
    PrismaModule,
    AuthClientModule,
    StorageClientModule,
  ],
  controllers: [DocumentsGrpcController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
