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
