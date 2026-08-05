import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsGrpcClient } from './documents-grpc.client';
import { DocumentsController } from './documents.controller';

/**
 * `INGESTION_GRPC_CLIENT` needs no import: `IngestionGrpcModule` is `@Global`,
 * because Domain C's surface will span several gateway modules and every one
 * must share the single channel to ingestion-service.
 */
@Module({
  imports: [AuthModule],
  controllers: [DocumentsController],
  providers: [DocumentsGrpcClient],
  exports: [DocumentsGrpcClient],
})
export class DocumentsModule {}
