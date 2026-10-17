import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMBEDDING_CLIENT } from './embedding.contract';
import { GeminiEmbeddingClient } from './gemini-embedding.client';
import { OfflineEmbeddingClient } from './offline-embedding.client';

/**
 * Binds the embedding capability to its real implementation, or, with
 * `INGESTION_OFFLINE_MODEL`, to the model-free one the end-to-end stack runs.
 *
 * The indirection is what lets the pipeline\'s e2e tests run with no API key
 * and no network while still exercising the real batching, the real ledger
 * writes and the real Qdrant upserts — they override this one token,
 * and every other collaborator stays genuine.
 */
@Module({
  providers: [
    {
      provide: EMBEDDING_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        // `String`: validated, it is a boolean; read raw, the text.
        String(config.get('INGESTION_OFFLINE_MODEL')) === 'true'
          ? new OfflineEmbeddingClient()
          : new GeminiEmbeddingClient(config),
    },
  ],
  exports: [EMBEDDING_CLIENT],
})
export class EmbeddingsModule {}
