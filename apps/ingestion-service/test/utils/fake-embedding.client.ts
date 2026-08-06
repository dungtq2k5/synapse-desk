import { EMBEDDING_DIMENSION } from '@synapsedesk/common';
import {
  EmbeddingClient,
  EmbeddingResult,
} from '../../src/modules/embeddings/embedding.contract';

/**
 * A substitute that HONOURS the embedding contract — §2.3.
 *
 * The temptation with a fake is to make it maximally permissive: return
 * whatever, never throw, never validate. That fake makes every pipeline test
 * pass while the production path stays broken in exactly the way the test
 * claimed to cover. So this one keeps the properties the real client has and
 * the pipeline actually depends on:
 *
 *   - **one vector per text, in input order** — the caller zips these against
 *     chunk rows by index, so a reordered or short response silently attaches
 *     vectors to the wrong chunks;
 *   - **the right dimensionality**, so a Qdrant upsert that would be rejected
 *     in production is rejected here;
 *   - **a real `promptTokens`**, so the ledger rows and the quota counter carry
 *     numbers with the same shape as production's;
 *   - **it throws on failure**, because the pipeline's recovery path is built
 *     on that and a fake that returned empties would prove the wrong thing.
 *
 * Vectors are DETERMINISTIC from the text, which matters more than it looks:
 * the same text embeds to the same point every run, so a retrieval assertion is
 * reproducible rather than passing on whichever random vector happened to land
 * nearest.
 */
export class FakeEmbeddingClient implements EmbeddingClient {
  /** Every batch it was asked for — the "was the cap respected" assertions. */
  readonly calls: Array<{ texts: string[]; model: string }> = [];

  /** Set to make the next call fail, for the FAILED-path tests. */
  failNext: Error | null = null;

  // `async` with nothing to await, deliberately. It implements an async
  // interface, and the keyword is what turns the `failNext` throw below into a
  // REJECTED promise rather than a synchronous throw — which is the difference
  // between `embedBatch().catch(...)` working and blowing up. Returning the
  // object directly (rather than `Promise.resolve(...)`) is what `async`
  // already does for us.
  // eslint-disable-next-line @typescript-eslint/require-await
  async embedBatch(texts: string[], model: string): Promise<EmbeddingResult> {
    this.calls.push({ texts, model });

    if (this.failNext) {
      const error = this.failNext;
      // Cleared so a test can prove RECOVERY: fail once, re-run, complete.
      this.failNext = null;
      throw error;
    }

    return {
      vectors: texts.map((text) => vectorFor(text)),
      promptTokens: texts.reduce(
        (total, text) => total + Math.ceil(text.length / 4),
        0,
      ),
    };
  }

  reset(): void {
    this.calls.length = 0;
    this.failNext = null;
  }
}

/**
 * A deterministic unit-ish vector derived from the text.
 *
 * Never all-zero: cosine distance is undefined for a zero vector and Qdrant
 * rejects it, so a fake that returned zeros would fail at the upsert for a
 * reason having nothing to do with the test.
 */
function vectorFor(text: string): number[] {
  let seed = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    seed ^= text.codePointAt(index) ?? 0;
    seed = Math.imul(seed, 16_777_619);
  }

  const vector: number[] = [];
  let state = seed >>> 0;

  for (let index = 0; index < EMBEDDING_DIMENSION; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    vector.push(state / 4_294_967_296 + 0.001);
  }

  return vector;
}
