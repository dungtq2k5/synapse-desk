import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LimitAlertsModule } from '../limit-alerts/limit-alerts.module';
import { AuthClientModule } from '../auth-client/auth-client.module';
import { StorageClientModule } from '../storage-client/storage-client.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { IngestionJobsModule } from '../ingestion-jobs/ingestion-jobs.module';
import { DocumentFlagsModule } from '../document-flags/document-flags.module';
import { KnowledgeArticlesModule } from '../knowledge-articles/knowledge-articles.module';
import { DocumentsService } from './documents.service';
import { DocumentsGrpcController } from './documents-grpc.controller';

@Module({
  imports: [
    LimitAlertsModule,
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
    // Same arrangement again: the article RPCs are declared on
    // `DocumentService`, so this module's controller adapts them.
    KnowledgeArticlesModule,
    PrismaModule,
    AuthClientModule,
    StorageClientModule,
  ],
  controllers: [DocumentsGrpcController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
