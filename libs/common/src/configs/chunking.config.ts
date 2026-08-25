/**
 * How a document becomes chunks — the shape of every citation in the product.
 *
 * These numbers are not tuning knobs in the settings-layer sense: they are
 * baked into the vectors the moment a document is ingested, so changing one
 * only affects documents ingested afterwards. A corpus chunked two ways
 * retrieves inconsistently and no query can tell which half it is reading.
 * Treat a change here as a re-ingest, not a config edit.
 */

/**
 * Target chunk size in TOKENS, not characters.
 *
 * The limit that matters downstream is the model's context window, which is
 * counted in tokens, and the ratio of characters to tokens varies by a factor
 * of three or more across languages — sizing in characters gives Latin-script
 * documents the intended chunk and CJK documents a third of it.
 */
export const CHUNK_TARGET_TOKENS = 512;

/**
 * The overlap between adjacent chunks, in tokens.
 *
 * Without it, a sentence that straddles a boundary is in neither chunk in
 * usable form — the retriever finds half an answer and the generator reports
 * the other half missing. The cost is a percentage of duplicated storage,
 * which is the cheaper of the two problems by a wide margin.
 */
export const CHUNK_OVERLAP_TOKENS = 64;

/**
 * Below this, a chunk is dropped rather than stored.
 *
 * A three-token chunk ("Appendix B") is a retrieval hazard: it embeds to
 * something, so it can win a similarity comparison, and it carries no
 * information a generator can use. It then occupies a context slot a useful
 * chunk would have held — the `UNCITED` failure mode, created
 * at ingestion rather than discovered later.
 */
export const MIN_CHUNK_TOKENS = 16;

/**
 * **The chunker counts with `js-tiktoken` (`cl100k_base`), and that is an
 * ESTIMATE of the tokenizer that actually bills us**.
 *
 * **Trap 1: treating a `cl100k_base` count as exact.** It is
 * **OpenAI's** tokenizer. We embed with Gemini `gemini-embedding-2` and
 * generate with Gemini, whose tokenizer is a different one with no JS
 * implementation. So this is a far better estimate than `chars / 4` — measured
 * on CJK, `chars / 4` says 6 tokens where the real count is 22, a 3.7x
 * under-count that silently overflows a chunk — but it remains an estimate.
 *
 * Two consequences, both deliberate:
 *
 *   - `CHUNK_TARGET_TOKENS` keeps a **safety margin** below the embedding
 *     model's input limit rather than being treated as exact. Treating 512 as
 *     a guarantee is how a document ingests fine for a year and then fails on
 *     one page of dense CJK.
 *   - Billing is unaffected. The exact count for spend comes from the
 *     embedding API's own response and is never estimated here (RDM §1.14).
 */
export const CHUNK_TOKENIZER = 'cl100k_base';

/**
 * How far below the embedding model's real input limit the target sits.
 *
 * `gemini-embedding-2` accepts 2048 tokens, so 512 is comfortable already —
 * this constant exists to make the margin a STATED decision rather than an
 * accident of the number above, so that raising the target is a conversation
 * about how wrong the estimate can be rather than a one-character edit.
 */
export const EMBEDDING_INPUT_TOKEN_LIMIT = 2048;

/**
 * How many chunks are embedded in one API call.
 *
 * Batched because per-chunk calls make a 400-chunk document 400 round trips,
 * and because the ledger writes one row per BATCH: at one row per chunk the
 * `ai_generations` table would be dominated by ingestion noise, and the
 * retention rollups that exist to control its size would be fighting a problem
 * that batching removes for free.
 */
export const EMBEDDING_BATCH_SIZE = 32;

/**
 * The markdown heading levels that start a new chunk.
 *
 * Splitting on structure before splitting on length is what makes "page 4,
 * " a real citation rather than a character offset. A section shorter than
 * the target simply stays whole — a chunk is allowed to be small when the
 * document says it is a unit.
 */
export const CHUNK_HEADING_LEVELS = [1, 2, 3] as const;

/**
 * The most chunks one document may produce before it is refused.
 *
 * **The bound that was missing at every size.** `MAX_OCR_PAGES_PER_DOCUMENT`
 * caps the path that LOOKS expensive — scanned pages — while a text-dense PDF
 * generates the embedding calls and had no ceiling at all. Raising
 * `MAX_DOCUMENT_BYTES` to 100 MB made that visible rather than creating it.
 *
 * **Derived, because there is no corpus to measure.** Both ingestion databases
 * are empty, so this comes from the arithmetic rather than from a percentile —
 * and the arithmetic is written down so the number can be re-derived when there
 * is data. At a stride of {@link CHUNK_TARGET_TOKENS} − {@link CHUNK_OVERLAP_TOKENS}
 * = 448 tokens, and roughly four characters per token for Latin script:
 *
 * | Document | Chunks | Embedding calls |
 * | :---- | :---- | :---- |
 * | 500-page manual (~250k words) | ~840 | ~27 |
 * | 100 MB PDF, ~15% extractable text | ~8,800 | ~275 |
 * | 100 MB of pure text | ~58,500 | ~1,830 |
 *
 * 20,000 sits between the third row and the second: it admits a 100 MB PDF at
 * realistic text density with room to spare, admits a manual twenty times
 * longer than any this product has seen, and refuses the pathological case that
 * would spend ~1,800 embedding calls on one upload.
 *
 * **Breaching it is TERMINAL, not a retry.** A document too large to chunk is
 * exactly as too large on attempt three, and `attempts: 3` would spend the
 * budget twice more before giving up.
 */
export const MAX_CHUNKS_PER_DOCUMENT = 20_000;
