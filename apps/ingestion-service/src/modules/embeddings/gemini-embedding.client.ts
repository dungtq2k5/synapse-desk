import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { EMBEDDING_DIMENSION } from '@synapsedesk/common';
import { EmbeddingClient, EmbeddingResult } from './embedding.contract';

/**
 * The real embedding provider.
 *
 * **It names no model.** The model arrives as an argument, resolved by the
 * caller from `settingsFor(orgId)` — doc 15 §1.2, and the reason
 * `scripts/check-model-literals.mjs` passes over this file rather than
 * allowlisting it.
 */
@Injectable()
export class GeminiEmbeddingClient implements EmbeddingClient {
  private readonly logger = new Logger(GeminiEmbeddingClient.name);

  private readonly client: GoogleGenAI;

  constructor(private readonly configService: ConfigService) {
    this.client = new GoogleGenAI({
      apiKey: this.configService.getOrThrow<string>('GEMINI_API_KEY'),
    });
  }

  async embedBatch(texts: string[], model: string): Promise<EmbeddingResult> {
    if (texts.length === 0) return { vectors: [], promptTokens: 0 };

    const response = await this.client.models.embedContent({
      model,
      contents: texts,
      config: {
        // `RETRIEVAL_DOCUMENT`, not the default. Gemini embeds asymmetrically:
        // documents and queries go into the same space through different task
        // types, and using one type for both measurably degrades retrieval.
        // The query side passes `RETRIEVAL_QUERY` — in the other service, in
        // the other language, which is exactly why it is stated here too.
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: EMBEDDING_DIMENSION,
      },
    });

    const embeddings = response.embeddings ?? [];

    // A short response is not something to paper over with empty vectors. The
    // caller zips these against chunk rows by INDEX, so a length mismatch
    // silently attaches vectors to the wrong chunks and retrieval returns
    // confidently wrong passages with nothing failing anywhere.
    if (embeddings.length !== texts.length) {
      throw new Error(
        `Embedding provider returned ${embeddings.length} vectors for ${texts.length} texts`,
      );
    }

    const vectors = embeddings.map((embedding) => {
      const values = embedding.values ?? [];
      if (values.length !== EMBEDDING_DIMENSION) {
        throw new Error(
          `Embedding provider returned a ${values.length}-dim vector; the collection is ${EMBEDDING_DIMENSION}-dim`,
        );
      }
      return values;
    });

    return {
      vectors,
      // From the provider, never estimated — this number is money.
      promptTokens:
        response.metadata?.billableCharacterCount ?? this.fallbackTokens(texts),
    };
  }

  /**
   * Used only when the provider reports no usage at all.
   *
   * An estimate is wrong in a way that a ZERO is not merely wrong but
   * dangerous: zero-cost calls meter as free, which is precisely the hole the
   * pricing table exists to close (12-doc §1.3). An approximate charge that
   * errs high is the safe direction.
   */
  private fallbackTokens(texts: string[]): number {
    this.logger.warn(
      'Embedding response carried no usage metadata; charging an estimate',
    );

    return texts.reduce((total, text) => total + Math.ceil(text.length / 4), 0);
  }
}
