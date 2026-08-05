import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthClientModule } from '../auth-client/auth-client.module';
import { StorageClientModule } from '../storage-client/storage-client.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { DocumentsService } from './documents.service';
import { DocumentsGrpcController } from './documents-grpc.controller';

@Module({
  imports: [
    // For `ScopeWriterService` and the reconciler queue. The document surface
    // is what TRIGGERS a scope change; the ingestion module owns how it is
    // applied, so the ordering rule lives in one place rather than two.
    IngestionModule,
    PrismaModule,
    AuthClientModule,
    StorageClientModule,
  ],
  controllers: [DocumentsGrpcController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
