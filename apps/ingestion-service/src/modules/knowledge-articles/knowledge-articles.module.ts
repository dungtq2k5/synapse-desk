import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { KnowledgeArticlesService } from './knowledge-articles.service';

/**
 * The end-user help centre.
 *
 * Provides {@link KnowledgeArticlesService} only. The RPCs are declared on
 * `DocumentService`, so `DocumentsGrpcController` is their transport adapter.
 */
@Module({
  imports: [PrismaModule],
  providers: [KnowledgeArticlesService],
  exports: [KnowledgeArticlesService],
})
export class KnowledgeArticlesModule {}
