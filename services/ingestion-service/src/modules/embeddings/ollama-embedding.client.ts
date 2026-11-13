import { Logger } from '@nestjs/common';
import { EMBEDDING_DIMENSION } from '@synapsedesk/contracts';
import {
  DEFAULT_RATE_LIMIT_WAIT_MS,
  EmbeddingClient,
  EmbeddingResult,
  isTimeout,
  RateLimited,
} from './embedding.contract';

/**
 * The document side of nomic-embed-text's asymmetric space. Queries go in with
 * `search_query: `, in rag-service's `ollama.py`, which is why it is stated in
 * both places, as Gemini's task types are.
 */
export const DOCUMENT_PREFIX = 'search_document: ';

/**
 * Chunk embeddings from an Ollama server (`OLLAMA_BASE_URL`).
 *
 * **It names no model.** The model arrives as an argument, resolved by the
 * caller from `settingsFor(orgId)`, exactly as for {@link GeminiEmbeddingClient}.
 *
 * `num_ctx` is sent on every call: Ollama's default context is small, and a
 * chunk longer than it is truncated silently before it is embedded.
 *
 * @example
 * const { vectors } = await client.embedBatch(['Refunds take 5 days.'], model);
 */
export class OllamaEmbeddingClient implements EmbeddingClient {
  private readonly logger = new Logger(OllamaEmbeddingClient.name);

  constructor(
    private readonly baseUrl: string,
    private readonly numCtx: number,
    /** The whole request's deadline, from `OLLAMA_EMBED_TIMEOUT_MS`. */
    private readonly timeoutMs = 120_000,
  ) {}

  async embedBatch(texts: string[], model: string): Promise<EmbeddingResult> {
    if (texts.length === 0) return { vectors: [], promptTokens: 0 };

    const response = await fetch(new URL('/api/embed', this.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input: texts.map((text) => DOCUMENT_PREFIX + text),
        options: { num_ctx: this.numCtx },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch((error: unknown) => {
      // Past the deadline: retried like a full queue, within the same cap.
      if (isTimeout(error)) {
        throw new RateLimited(DEFAULT_RATE_LIMIT_WAIT_MS, error);
      }
      throw error;
    });

    // Ollama answers 503 when its queue (`OLLAMA_MAX_QUEUE`) is full: the same
    // instruction as a provider's 429, so the job waits and sends it again.
    if (response.status === 503) {
      throw new RateLimited(DEFAULT_RATE_LIMIT_WAIT_MS);
    }
    if (!response.ok) {
      throw new Error(
        `Ollama answered ${response.status} for ${model}: ${await response.text()}`,
      );
    }

    const body = (await response.json()) as {
      embeddings?: number[][];
      prompt_eval_count?: number;
    };
    const vectors = body.embeddings ?? [];

    // Zipped against chunk rows by INDEX, so a short answer must fail rather
    // than attach vectors to the wrong chunks.
    if (vectors.length !== texts.length) {
      throw new Error(
        `Embedding provider returned ${vectors.length} vectors for ${texts.length} texts`,
      );
    }
    for (const vector of vectors) {
      if (vector.length !== EMBEDDING_DIMENSION) {
        throw new Error(
          `Embedding provider returned a ${vector.length}-dim vector; the collection is ${EMBEDDING_DIMENSION}-dim`,
        );
      }
    }

    return {
      vectors,
      promptTokens:
        body.prompt_eval_count && body.prompt_eval_count > 0
          ? body.prompt_eval_count
          : this.fallbackTokens(texts),
    };
  }

  /** Never zero: a zero-token call meters as free. Errs high. */
  private fallbackTokens(texts: string[]): number {
    this.logger.warn('Ollama reported no token count; charging an estimate');
    return texts.reduce((total, text) => total + Math.ceil(text.length / 4), 0);
  }
}

/**
 * Fails the boot with the fix named: Ollama unreachable, the model not
 * pulled, or the tag re-pulled onto other weights than the pinned digest.
 *
 * @example
 * await checkOllama('http://localhost:11434', 'nomic-embed-text:v1.5', OLLAMA_MODEL_DIGESTS);
 */
export async function checkOllama(
  baseUrl: string,
  model: string,
  digests: Readonly<Record<string, string>>,
): Promise<void> {
  let tags: { models?: { name: string; digest?: string }[] };
  try {
    const response = await fetch(new URL('/api/tags', baseUrl), {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    tags = (await response.json()) as typeof tags;
  } catch (error) {
    throw new Error(
      `OLLAMA_BASE_URL ${baseUrl} doesn't answer (${String(error)}). Start it with ` +
        '`docker compose up -d ollama`, or set AI_EMBEDDING_PROVIDER back to gemini.',
      { cause: error },
    );
  }

  const pulled = (tags.models ?? []).find((entry) => entry.name === model);
  if (!pulled) {
    throw new Error(
      `Ollama at ${baseUrl} has no ${model}: run \`ollama pull ${model}\`.`,
    );
  }
  const expected = digests[model];
  if (expected && pulled.digest !== expected) {
    throw new Error(
      `Ollama's ${model} is ${String(pulled.digest).slice(0, 12)}, not the pinned ` +
        `${expected.slice(0, 12)}: the tag was re-pulled onto other weights. Pull ` +
        'the pinned digest, or re-measure and update OLLAMA_MODEL_DIGESTS.',
    );
  }
}
