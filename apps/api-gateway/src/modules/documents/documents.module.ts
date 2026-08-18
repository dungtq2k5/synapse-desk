import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsGrpcClient } from './documents-grpc.client';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { DocumentsResolver } from './documents.resolver';

// `INGESTION_GRPC_CLIENT` needs no import here: `IngestionGrpcModule` is
// `@Global`, so every module shares the one channel to ingestion-service.
@Module({
  imports: [AuthModule],
  controllers: [DocumentsController],
  providers: [DocumentsGrpcClient, DocumentsService, DocumentsResolver],
  exports: [DocumentsService],
})
export class DocumentsModule {}
