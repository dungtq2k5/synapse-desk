import { Module } from '@nestjs/common';
import { EMBEDDING_CLIENT } from './embedding.contract';
import { GeminiEmbeddingClient } from './gemini-embedding.client';

/**
 * Binds the embedding capability to its real implementation.
 *
 * The indirection is what lets the pipeline\'s e2e tests run with no API key
 * and no network while still exercising the real batching, the real ledger
 * writes and the real Qdrant upserts — they override this one token
 * (§2.6), and every other collaborator stays genuine.
 */
@Module({
  providers: [{ provide: EMBEDDING_CLIENT, useClass: GeminiEmbeddingClient }],
  exports: [EMBEDDING_CLIENT],
})
export class EmbeddingsModule {}
