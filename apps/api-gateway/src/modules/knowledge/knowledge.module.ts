import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { KnowledgeGrpcClient } from './knowledge-grpc.client';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeController } from './knowledge.controller';

/**
 * `RAG_GRPC_CLIENT` needs no import here: `RagGrpcModule` is `@Global`, for the
 * same reason the other channels are — chat and the co-pilot will both reach
 * rag-service from different gateway modules, and every one must share ONE
 * channel to the same peer.
 */
@Module({
  imports: [AuthModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeGrpcClient, KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
