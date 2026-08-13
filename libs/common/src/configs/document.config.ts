/**
 * Domain C's enumerated columns and bounds.
 *
 * Every one of these is a `String` in `schema.prisma` per
 * `development-conventions.md §7.3` — Prisma enums are a migration liability and
 * this repo keeps the values in TypeScript, where they can be imported by the
 * gateway, the service and the tests as one definition.
 */

/** `documents.status` — the ingestion pipeline's view of a document. */
export enum DocumentStatus {
  /** Confirmed and queued; nothing parsed yet. */
  PENDING = 'PENDING',
  /** The worker has it. Covers parse, chunk and embed. */
  PROCESSING = 'PROCESSING',
  /** Chunked, embedded, upserted — retrievable. */
  INDEXED = 'INDEXED',
  /** Something in the pipeline gave up; `ingestion_jobs.error_log` says what. */
  FAILED = 'FAILED',
}

export const DOCUMENT_STATUSES = Object.values(DocumentStatus);

/**
 * `ingestion_jobs.status` — the OBSERVABLE walk through the pipeline.
 *
 * Deliberately finer-grained than `DocumentStatus`: a document is `PROCESSING`
 * for the whole run, and a 200-page PDF stuck for ten minutes needs to say
 * WHICH stage it is stuck in. That is the entire reason RDM Table 20 exists.
 */
export enum IngestionJobStatus {
  QUEUED = 'QUEUED',
  PARSING = 'PARSING',
  CHUNKING = 'CHUNKING',
  EMBEDDING = 'EMBEDDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export const INGESTION_JOB_STATUSES = Object.values(IngestionJobStatus);

/**
 * The stages a job may still make progress from.
 *
 * `QUEUED` is in here on purpose and it is the interesting entry: a job parked
 * because the tenant is over AI budget stays `QUEUED` and resumes at cycle roll
 * (12-doc §3). Marking it `FAILED` would discard parsing work already done and
 * would punish document onboarding for chat overspend.
 */
export const RESUMABLE_INGESTION_STATUSES = [
  IngestionJobStatus.QUEUED,
  IngestionJobStatus.PARSING,
  IngestionJobStatus.CHUNKING,
  IngestionJobStatus.EMBEDDING,
] as const;

export enum DocumentFlagType {
  /** Age past TTL, or expired year references in the text. */
  OUTDATED = 'OUTDATED',
  /** Indexed but never once retrieved — nobody's question came near it. */
  UNRETRIEVED = 'UNRETRIEVED',
  /**
   * Retrieved repeatedly and never cited.
   *
   * Worse than being ignored, and a genuinely different finding from
   * `UNRETRIEVED`: it keeps winning a context slot and never earning it, so it
   * displaces documents that would have answered.
   */
  UNCITED = 'UNCITED',
  LOW_CONFIDENCE = 'LOW_CONFIDENCE',
  NEGATIVE_FEEDBACK = 'NEGATIVE_FEEDBACK',
  CONFLICTING = 'CONFLICTING',
  /**
   * Part of the document is not in the corpus — 34-doc §6.
   *
   * **Its provenance differs from every value above it, and that is worth a
   * sentence rather than a silent addition.** The others are derived from
   * RETRIEVAL behaviour: `UNRETRIEVED` means nobody's question came near it,
   * `UNCITED` means it kept winning a context slot without earning one. Those
   * are observations made weeks after ingestion by a scheduled job.
   *
   * This one comes from ingestion itself, at index time, and is a fact about
   * the document rather than about how it has been used. The mechanism fits —
   * a Knowledge Manager reviewing a worklist is exactly who should see "three
   * pages of this could not be read" — but the provenance does not, and a
   * reader comparing them deserves to know which kind they are looking at.
   *
   * Raised when pages the parser saw are absent from the chunk rows, which
   * covers BOTH ways a page can vanish: OCR failed to read it, or it produced
   * too little text to survive `MIN_CHUNK_TOKENS`.
   */
  PAGES_NOT_INDEXED = 'PAGES_NOT_INDEXED',
}

export const DOCUMENT_FLAG_TYPES = Object.values(DocumentFlagType);

export enum DocumentFlagSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
}

export enum DocumentFlagResolution {
  FIXED = 'FIXED',
  DISMISSED = 'DISMISSED',
  DOCUMENT_REPLACED = 'DOCUMENT_REPLACED',
}

/**
 * `ai_generations.purpose` — every surface that spends.
 *
 * The list is the point: before RDM Table 29, only `CHAT_ANSWER` was ever
 * persisted, so drafts, summaries, classifications, reformulations and
 * embeddings were spend the quota gate structurally could not see.
 *
 * There is deliberately NO `GREETING_REPLY`. Detecting a greeting for free and
 * then paying a model to produce one of about six canned sentences would be
 * spending money to say "Hi!" — the reply is a lookup table (11-doc §1.2). If
 * canned replies ever prove too rigid, adding the value AND ledgering the call
 * is the change; an unmetered LLM call in the flow is not.
 */
export enum AiGenerationPurpose {
  CHAT_ANSWER = 'CHAT_ANSWER',
  DRAFT = 'DRAFT',
  SUMMARY = 'SUMMARY',
  CLASSIFY = 'CLASSIFY',
  SUGGESTIONS = 'SUGGESTIONS',
  GREETING_CLASSIFY = 'GREETING_CLASSIFY',
  REFORMULATION = 'REFORMULATION',
  EMBEDDING = 'EMBEDDING',
  /**
   * The co-pilot's review pass — 13-doc §4.2.
   *
   * A distinct purpose because it is a distinct COST: a draft with two review
   * passes is three generations, and folding them under `DRAFT` would make the
   * per-draft cost look like one call — understating the co-pilot's true price
   * by the exact factor that makes it worth having.
   */
  REVIEW = 'REVIEW',
  /**
   * Prompt-injection detection on `Ask` and `Draft` — 33-doc §3.3.
   *
   * **`Chat` does not book this.** Its detection is fused into the greeting
   * classification it already made, so that call keeps `GREETING_CLASSIFY` —
   * the same call, one label wider. Booking it twice would report a cost that
   * did not change as though it had.
   */
  INJECTION_CLASSIFY = 'INJECTION_CLASSIFY',
}

export const AI_GENERATION_PURPOSES = Object.values(AiGenerationPurpose);

/**
 * A FAILED call still consumed prompt tokens and still cost money.
 *
 * Recording only successes under-counts spend, which is the direction that
 * matters — an under-count lets a tenant keep spending past their cap.
 */
export enum AiGenerationStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/** Drafts only, written after the fact when the agent acts (or a sweep gives up). */
export enum AiGenerationOutcome {
  ACCEPTED = 'ACCEPTED',
  EDITED = 'EDITED',
  DISCARDED = 'DISCARDED',
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

export const MAX_DOCUMENT_TITLE_LENGTH = 255;

/**
 * The file types the DOCUMENT purpose accepts.
 *
 * Mirrors `PURPOSE_POLICY[DOCUMENT]` in storage-service, and the duplication is
 * the same two-layer guard every other upload has: this one refuses a bad type
 * before it costs a network hop and documents the limit in the API contract,
 * that one holds no matter which service is asking. Widen BOTH when the real
 * parser lands.
 */
export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
] as const;
export type AllowedDocumentMimeType =
  (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number];

/**
 * The languages OCR can be asked for — 34-doc §4.
 *
 * **Here rather than in `ocr.config` because this is API contract, not engine
 * tuning.** The gateway validates uploads against this set, it appears in a
 * DTO, and a change to it is a change to what callers may send.
 * `ocr.config` holds the worker's own knobs — the character floor, the DPI and
 * the two ceilings — which no caller can see.
 *
 * **The same eight the rest of the product speaks**, matching the greeting and
 * refusal tables in rag-service: a ninth language is a decision made in one
 * place rather than a code someone adds here because tesseract happens to ship
 * a model for it.
 *
 * **ISO 639-1, because the API speaks ISO 639-1** (§4.2.1). Tesseract's own
 * codes are 639-2 (`vie`, `jpn`) and its apt packages are a third spelling
 * again (`tesseract-ocr-chi-sim`, hyphen where the language code has an
 * underscore). Storing the engine's alphabet would make the column unportable
 * and put `chi_sim` in a DTO.
 */
export const OCR_LANGUAGES = [
  'en',
  'es',
  'fr',
  'de',
  'pt',
  'vi',
  'ja',
  'zh',
] as const;
export type OcrLanguage = (typeof OCR_LANGUAGES)[number];

/**
 * ISO 639-1 -> tesseract's `-l` code — 34-doc §4.2.1.
 *
 * **Exported once so the parser never spells a code itself.** Three alphabets
 * for the same language is the kind of mistake that type-checks: `zh` is
 * `chi_sim` to the engine and `chi-sim` to apt, and a hand-written `-l zh`
 * fails at runtime with "Failed loading language" rather than at compile time.
 *
 * The apt names are deliberately absent. They are packaging, not domain, and
 * they live in `docker/node-service.Dockerfile` — a third mapping in code would
 * be a third place to get `chi-sim` wrong.
 */
export const TESSERACT_CODE_BY_LANGUAGE: Record<OcrLanguage, string> = {
  en: 'eng',
  es: 'spa',
  fr: 'fra',
  de: 'deu',
  pt: 'por',
  vi: 'vie',
  ja: 'jpn',
  zh: 'chi_sim',
};

/**
 * How many languages one document may declare — 34-doc §4.3, MEASURED.
 *
 * **The measurement reversed the reasoning, so it is recorded here rather than
 * in the document that guessed.** The design expected accuracy to degrade as
 * languages were added, and hypothesised a cap of 2. It does not. Rendered at
 * 300 dpi and OCR'd with tesseract 5.3.4:
 *
 * | `-l`                    | char error rate | time  |
 * | :---------------------- | :-------------- | :---- |
 * | `vie`                   | 0.00%           |  651ms |
 * | `vie+eng`               | 0.00%           |  699ms |
 * | `vie+eng+jpn`           | 0.00%           |  739ms |
 * | `vie+eng+jpn+chi_sim`   | 0.00%           |  893ms |
 * | `eng+vie` (order swapped) | **2.41%**     |  776ms |
 * | `eng` alone             | **24.41%**      |  642ms |
 *
 * **Three findings, and only the third sets this number.**
 *
 * 1. Extra languages cost NO accuracy. Four was as exact as one.
 * 2. **Order is what costs accuracy** — naming English first on a Vietnamese
 *    document was worse than every four-language combination. Which is why the
 *    list is stored and passed in the order given, never sorted.
 * 3. Extra languages cost TIME, roughly linearly, and CJK models cost most:
 *    `jpn` 578ms against `jpn+eng+chi_sim` 1359ms.
 *
 * So the cap is a CPU bound, not an accuracy one. Four permits every realistic
 * document — one language, English technical terms, and a CJK script — while
 * holding the worst case near +40% on a path that already has a per-page
 * timeout.
 *
 * **The caveat that keeps this honest:** these were clean synthetic renders of
 * digital fonts, which is the easy case. Real scans are noisy and skewed, and
 * language confusion grows with noise. The numbers bound the BEST case, so they
 * are a reason not to tighten the cap rather than a licence to loosen it.
 */
export const MAX_OCR_LANGUAGES = 4;

/**
 * At most one of these may be named — 34-doc §4.2 rule 3.
 *
 * **The rule survives; its stated reason did not.** The design said `jpn+zho`
 * was "close to worthless — two models competing over the same Han
 * characters". Measured, it is not: `jpn+chi_sim` scored 0.00% on Japanese,
 * identical to `jpn` alone.
 *
 * What it costs is TIME — `jpn` 578ms against `jpn+chi_sim` 965ms, and
 * `jpn+eng+chi_sim` 1359ms, well over double. Since the accuracy gain is
 * exactly zero, that is spend with nothing bought, and refusing it is still
 * right. The reason is now the one the numbers support.
 */
export const NON_LATIN_OCR_LANGUAGES: readonly OcrLanguage[] = ['ja', 'zh'];

/** Used when the uploader specified nothing, which is almost every upload. */
export const DEFAULT_OCR_LANGUAGE: OcrLanguage = 'en';

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/** `documents.file_type` — the short extension, derived from the mime type. */
export const FILE_TYPE_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
};

export const DOCUMENT_SORTABLE_FIELDS = [
  'createdAt',
  'title',
  'fileSizeBytes',
] as const;
export type DocumentSortableField = (typeof DOCUMENT_SORTABLE_FIELDS)[number];

export const DOCUMENT_CHUNK_SORTABLE_FIELDS = ['chunkIndex'] as const;

/**
 * Newest first is the only ordering a flag list wants.
 *
 * `severity` is deliberately absent: it is a `VarChar` holding an enum, so
 * ordering by it would sort CRITICAL, INFO, WARNING alphabetically — an order
 * that looks deliberate and is meaningless.
 */
export const DOCUMENT_FLAG_SORTABLE_FIELDS = ['detectedAt'] as const;

export type DocumentFlagSortableField =
  (typeof DOCUMENT_FLAG_SORTABLE_FIELDS)[number];
export type DocumentChunkSortableField =
  (typeof DOCUMENT_CHUNK_SORTABLE_FIELDS)[number];

// ---------------------------------------------------------------------------
// The ingestion queue
// ---------------------------------------------------------------------------

/**
 * The BullMQ queue name, shared by the producer and the worker.
 *
 * A string that must match in two places and is not checked by anything: a
 * typo does not error, it produces a queue nobody consumes, and the symptom is
 * documents that stay PENDING forever with a healthy-looking job row.
 */
export const INGESTION_QUEUE = 'document-ingestion';

/** The job name within that queue. Same reasoning as above. */
export const INGESTION_JOB_NAME = 'ingest-document';

/**
 * The scope fan-out's queue — §2.3.
 *
 * A SEPARATE queue from ingestion, not a second job name on the same one. The
 * two have opposite shapes: ingestion jobs are long, few and CPU-heavy, so
 * their worker runs at concurrency 2; a re-scope is short, can arrive in bursts
 * (an admin reorganising departments), and must not queue behind a 200-page
 * PDF. Sharing a queue would put a security-relevant write behind a parse.
 */
export const SCOPE_FANOUT_QUEUE = 'document-scope-fanout';

/** The job name within that queue. */
export const SCOPE_FANOUT_JOB_NAME = 'reconcile-scope';
