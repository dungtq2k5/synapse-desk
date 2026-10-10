import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { KnowledgeGrpcClient } from './knowledge-grpc.client';
import { KnowledgeArticlesGrpcClient } from './knowledge-articles-grpc.client';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeArticlesService } from './knowledge-articles.service';
import { KnowledgeController } from './knowledge.controller';

/**
 * Neither `RAG_GRPC_CLIENT` nor `INGESTION_GRPC_CLIENT` needs importing here:
 * both channel modules are `@Global`.
 *
 * `RAG_GRPC_CLIENT` needs no import here: `RagGrpcModule` is `@Global`, for the
 * same reason the other channels are — chat and the co-pilot will both reach
 * rag-service from different gateway modules, and every one must share ONE
 * channel to the same peer.
 */
@Module({
  imports: [AuthModule],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeGrpcClient,
    KnowledgeService,
    // A SECOND peer from one module: the help centre reads ingestion-service
    // while search and ask reach rag-service.
    KnowledgeArticlesGrpcClient,
    KnowledgeArticlesService,
  ],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
