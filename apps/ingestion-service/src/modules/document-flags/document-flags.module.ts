import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DocumentFlagsService } from './document-flags.service';

/**
 * The quality worklist.
 *
 * Provides {@link DocumentFlagsService} only. The RPCs are declared on
 * `DocumentService`, so `DocumentsGrpcController` is their transport adapter.
 */
@Module({
  imports: [PrismaModule],
  providers: [DocumentFlagsService],
  exports: [DocumentFlagsService],
})
export class DocumentFlagsModule {}
