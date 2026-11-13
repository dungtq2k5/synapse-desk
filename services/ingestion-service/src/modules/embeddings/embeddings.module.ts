import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMBEDDING_CLIENT } from './embedding.contract';
import { GeminiEmbeddingClient } from './gemini-embedding.client';
import { OfflineEmbeddingClient } from './offline-embedding.client';
import { checkOllama, OllamaEmbeddingClient } from './ollama-embedding.client';
import {
  MODELS_BY_PROVIDER,
  OLLAMA_MODEL_DIGESTS,
} from '@synapsedesk/contracts';

/**
 * Binds the embedding capability to the provider `AI_EMBEDDING_PROVIDER`
 * names (Gemini or Ollama), or, with `INGESTION_OFFLINE_MODEL`, to the
 * model-free one the end-to-end stack runs.
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
      useFactory: async (config: ConfigService) => {
        // `String`: validated, it is a boolean; read raw, the text.
        if (String(config.get('INGESTION_OFFLINE_MODEL')) === 'true') {
          return new OfflineEmbeddingClient();
        }
        if (config.get('AI_EMBEDDING_PROVIDER') !== 'ollama') {
          return new GeminiEmbeddingClient(config);
        }
        const baseUrl = config.getOrThrow<string>('OLLAMA_BASE_URL');
        // At boot, so the first failure names the fix rather than a job.
        await checkOllama(
          baseUrl,
          MODELS_BY_PROVIDER.ollama.embeddingModel,
          OLLAMA_MODEL_DIGESTS,
        );
        return new OllamaEmbeddingClient(
          baseUrl,
          Number(config.get('OLLAMA_NUM_CTX') ?? 8192),
          Number(config.get('OLLAMA_EMBED_TIMEOUT_MS') ?? 120_000),
        );
      },
    },
  ],
  exports: [EMBEDDING_CLIENT],
})
export class EmbeddingsModule {}
