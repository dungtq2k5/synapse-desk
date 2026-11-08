import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiError, GoogleGenAI } from '@google/genai';
import { EMBEDDING_DIMENSION } from '@synapsedesk/contracts';
import {
  DEFAULT_RATE_LIMIT_WAIT_MS,
  EmbeddingClient,
  EmbeddingResult,
  RateLimited,
} from './embedding.contract';

/**
 * The wait a Gemini 429 asks for, in milliseconds: its `RetryInfo` detail's
 * `retryDelay` (`"7s"`, `"0.5s"`), which the SDK leaves inside the error's
 * message as JSON. The default when it carries none.
 *
 * @example retryDelayMs('{"error":{"details":[{"retryDelay":"7s"}]}}') // 7000
 */
export function retryDelayMs(message: string): number {
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(message);
  return match
    ? Math.ceil(Number(match[1]) * 1000)
    : DEFAULT_RATE_LIMIT_WAIT_MS;
}

/**
 * The real embedding provider.
 *
 * **It names no model.** The model arrives as an argument, resolved by the
 * caller from `settingsFor(orgId)`, and the reason
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

    const response = await this.client.models
      .embedContent({
        model,
        // **One content per text, not the strings themselves.** The SDK reads a
        // string array as the parts of ONE content, and the model then answers
        // with one vector for the whole batch (measured: 3 texts, 1 vector).
        contents: texts.map((text) => ({ role: 'user', parts: [{ text }] })),
        config: {
          // `RETRIEVAL_DOCUMENT`, not the default. Gemini embeds asymmetrically:
          // documents and queries go into the same space through different task
          // types, and using one type for both measurably degrades retrieval.
          // The query side passes `RETRIEVAL_QUERY` — in the other service, in
          // the other language, which is exactly why it is stated here too.
          taskType: 'RETRIEVAL_DOCUMENT',
          outputDimensionality: EMBEDDING_DIMENSION,
        },
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 429) {
          throw new RateLimited(retryDelayMs(error.message), error);
        }
        throw error;
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
   * pricing table exists to close. An approximate charge that
   * errs high is the safe direction.
   */
  private fallbackTokens(texts: string[]): number {
    this.logger.warn(
      'Embedding response carried no usage metadata; charging an estimate',
    );

    return texts.reduce((total, text) => total + Math.ceil(text.length / 4), 0);
  }
}
