/**
 * The embedding capability, as an interface plus a token.
 *
 * A TypeScript interface is erased at compile time and cannot be an injection
 * token (§2.6), so the symbol below is what modules actually bind. The value of
 * doing it this way is not abstraction for its own sake: it is that the
 * pipeline's tests run against a substitute with **no network and no API key**,
 * and they still exercise the real batching, the real ledger writes and the
 * real Qdrant upserts.
 *
 * Any substitute must honour this contract completely (§2.3): same return
 * shape, same failure mode, same relationship between input and output length.
 * A fake that returns fewer vectors than it was given texts, or that never
 * throws, makes the pipeline tests pass while the production path is broken in
 * exactly the way the test claimed to cover.
 */
export const EMBEDDING_CLIENT = Symbol('EMBEDDING_CLIENT');

export type EmbeddingResult = {
  /**
   * One vector per input text, **in the same order**.
   *
   * The order is load-bearing: the caller zips these against the chunk rows it
   * already wrote, so a reordered response silently attaches every chunk's
   * vector to a different chunk. Nothing errors — retrieval simply returns
   * confidently wrong passages.
   */
  vectors: number[][];
  /**
   * Prompt tokens as reported BY THE API, never estimated.
   *
   * The chunker's token counts are a deliberate approximation used for
   * splitting; this number is money (RDM §1.14), so it comes from the provider
   * or it is not used.
   */
  promptTokens: number;
};

export interface EmbeddingClient {
  /**
   * Embeds a batch, returning one vector per text in input order.
   *
   * @throws when the provider fails. The caller marks the job FAILED and
   *   leaves the chunk rows without a `vector_point_id` — recoverable by
   *   re-running, which is why it must throw rather than return empties.
   */
  embedBatch(texts: string[], model: string): Promise<EmbeddingResult>;
}
