/**
 * @file Domain C's enumerated columns and bounds.
 *
 * Every one of these is a `String` in `schema.prisma` per
 * `development-conventions.md §7.3` — Prisma enums are a migration liability and
 * this repo keeps the values in TypeScript, where they can be imported by the
 * gateway, the service and the tests as one definition.
 */

import {
  EXTENSION_BY_MIME,
  UNKNOWN_EXTENSION,
  type MimeType,
} from './mime.config';

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
  /** Stopped on request, or superseded by a retry. A job status only — a
   *  cancelled job's document is `DocumentStatus.FAILED`. */
  CANCELLED = 'CANCELLED',
}

export const INGESTION_JOB_STATUSES = Object.values(IngestionJobStatus);

/**
 * The statuses a job can still be CANCELLED from — its one consumer's question.
 *
 * Not what the worker checks: that is {@link TERMINAL_INGESTION_STATUSES} with
 * `notIn`, because a `FAILED` job is one BullMQ will retry.
 *
 * `QUEUED` is in here on purpose and it is the interesting entry: a job parked
 * because the tenant is over AI budget stays `QUEUED` and resumes at cycle roll.
 * Marking it `FAILED` would discard parsing work already done and
 * would punish document onboarding for chat overspend.
 */
export const RESUMABLE_INGESTION_STATUSES = [
  IngestionJobStatus.QUEUED,
  IngestionJobStatus.PARSING,
  IngestionJobStatus.CHUNKING,
  IngestionJobStatus.EMBEDDING,
] as const;

/**
 * The statuses a worker must refuse to move a job out of.
 *
 * Not the complement of {@link RESUMABLE_INGESTION_STATUSES}: `FAILED` is in
 * neither, because a failed job is what BullMQ retries.
 */
export const TERMINAL_INGESTION_STATUSES = [
  IngestionJobStatus.COMPLETED,
  IngestionJobStatus.CANCELLED,
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
   * Part of the document is not in the corpus.
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

export const DOCUMENT_FLAG_SEVERITIES = Object.values(DocumentFlagSeverity);

export enum DocumentFlagResolution {
  FIXED = 'FIXED',
  DISMISSED = 'DISMISSED',
  DOCUMENT_REPLACED = 'DOCUMENT_REPLACED',
}

export const DOCUMENT_FLAG_RESOLUTIONS = Object.values(DocumentFlagResolution);

/**
 * How long a `DISMISSED` flag keeps its detector quiet.
 *
 * Applies to `DISMISSED` alone. `FIXED` and `DOCUMENT_REPLACED` suppress
 * nothing — they assert the problem is gone, so a detector that finds it again
 * is reporting news rather than repeating itself.
 */
export const DISMISSAL_SUPPRESSION_DAYS = 30;

/**
 * `ai_generations.purpose` — every surface that spends.
 *
 * The list is the point: before RDM Table 29, only `CHAT_ANSWER` was ever
 * persisted, so drafts, summaries, classifications, reformulations and
 * embeddings were spend the quota gate structurally could not see.
 *
 * There is deliberately NO `GREETING_REPLY`. Detecting a greeting for free and
 * then paying a model to produce one of about six canned sentences would be
 * spending money to say "Hi!" — the reply is a lookup table. If
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
   * The co-pilot's review pass.
   *
   * A distinct purpose because it is a distinct COST: a draft with two review
   * passes is three generations, and folding them under `DRAFT` would make the
   * per-draft cost look like one call — understating the co-pilot's true price
   * by the exact factor that makes it worth having.
   */
  REVIEW = 'REVIEW',
  /**
   * Prompt-injection detection on `Ask` and `Draft`.
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
 * The longest reason a person may give when resolving a flag.
 *
 * **No column mirrors this** — `document_flags.resolution_comment` is
 * `@db.Text`, so this bounds the input rather than matching a width, and it
 * must NOT join `column-bounds.spec.ts`'s pairings for the reason that file
 * gives about `MAX_OBJECT_PATH_LENGTH`.
 *
 * Rejected on the way in rather than truncated on the way out, which is the
 * opposite of how `error_log` is handled: that is unbounded machine text with
 * a reader, this is a person's reason and losing half of it silently loses the
 * half that mattered.
 */
export const MAX_FLAG_RESOLUTION_COMMENT_LENGTH = 2_000;

/**
 * The file types the DOCUMENT purpose accepts.
 *
 * **Not mirrored — IMPORTED.** `PURPOSE_POLICY[DOCUMENT]` in storage-service
 * takes this exact list, so there is no second copy to widen and no drift to
 * guard against. This docblock described a duplication that no longer exists,
 * and said to "widen BOTH", which would send the next reader looking for a
 * second list.
 *
 * What the two layers still buy is unchanged: the gateway refuses a bad type
 * before it costs a network hop, and storage-service holds regardless of which
 * service is asking.
 */
export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  // **No `application/msword`, and it is not an omission.** Legacy `.doc` is an
  // OLE2 compound binary; mammoth reads OOXML and throws `Can't find end of
  // central directory : is this a zip file ?` on a genuine Word 97-2003 file.
  // That is a bare `Error`, so it misses the deterministic-refusal arm and
  // costs `attempts: 3` — three download-and-parse cycles to reach a message
  // about zip files in a tenant's `error_log`.
  //
  // It stays in `ALLOWED_ATTACHMENT_MIME_TYPES`: storable, downloadable, never
  // parsed. Refusing at presign is the honest answer, and it is the one place
  // the refusal can carry a message a person can act on.
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
] as const satisfies readonly MimeType[];
export type AllowedDocumentMimeType =
  (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number];

/**
 * The languages OCR can be asked for.
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
 * **ISO 639-1, because the API speaks ISO 639-1**. Tesseract's own
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
 * Narrows stored / on-the-wire language codes to {@link OcrLanguage}.
 *
 * @param codes ISO 639-1 codes as they arrive from a `String[]` column or a
 *   proto `repeated string`, neither of which can carry a narrower type.
 * @returns the same codes, in the same order, typed.
 * @throws Error naming every unrecognized code.
 *
 * @example
 * parseOcrLanguages(['vi', 'en']); // ['vi', 'en'], typed
 * parseOcrLanguages(['VI']);       // throws: 'VI'
 */
export function parseOcrLanguages(codes: string[]): OcrLanguage[] {
  // REFUSES rather than filters, and that is the whole point of the function.
  // Dropping an unrecognized code is silent: `-l` ends up empty, tesseract
  // falls back to English, and a Vietnamese scan comes back as noise with
  // nothing anywhere reporting why.
  const unknown = codes.filter(
    (code) => !OCR_LANGUAGES.includes(code as OcrLanguage),
  );

  if (unknown.length > 0) {
    throw new Error(`Unsupported OCR language(s): ${unknown.join(', ')}`);
  }

  return codes as OcrLanguage[];
}

/**
 * ISO 639-1 -> tesseract's `-l` code.
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
 * How many OCR languages one document may declare.
 *
 * Four. The cap is a CPU bound, not an accuracy one — extra languages cost time
 * but no accuracy, while **order** costs accuracy, which is why the list is
 * stored and passed in the order given and **never sorted**.
 *
 * Measurements behind the number:
 * `docs/decisions/0035-ocr-language-cap-is-a-cpu-bound.md`.
 */
export const MAX_OCR_LANGUAGES = 4;

/**
 * At most one of these may be named.
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

/**
 * The largest a document may be, in bytes — 100 MB.
 *
 * **The whole FILE at presign, and nothing else.** Three layers read this ONE
 * constant: the gateway's `@Max` before a network hop, ingestion-service when it
 * issues the upload, and `PURPOSE_POLICY[DOCUMENT].maxSizeBytes`, which bounds
 * the object itself. Change it here and all three move.
 *
 * It is NOT a page cap and NOT a timeout. Those are separate bounds with their
 * own reasons: {@link MAX_OCR_PAGES_PER_DOCUMENT} caps how many image pages one
 * document may be OCR'd for (a CPU bound), and the parser's own limits govern
 * how long a parse may run. A 25 MB PDF of text and a 25 MB PDF of scans are
 * the same size and cost very different amounts to ingest, which is exactly why
 * one number cannot express both.
 *
 * **Raised 25 MB → 100 MB, and the size was never what protected the system.**
 * Two bounds do the real work and neither is this one:
 *
 * - {@link MAX_CHUNKS_PER_DOCUMENT} bounds the embedding spend a single
 *   document can cause. Before it existed nothing did — the OCR page cap bounds
 *   the expensive-LOOKING path while a text-dense PDF, which is the one that
 *   actually generates embedding calls, had no ceiling at any size.
 * - The ingestion container's `mem_limit`, because the parser holds the whole
 *   file as a `Buffer` at `concurrency: 2`. Without a limit "does a 100 MB
 *   document OOM the worker" has no answer that does not start with "depends
 *   which host it lands on".
 *
 * Raising this without both is what makes an unbounded cost visible rather than
 * creating one — the gap was there at 25 MB too.
 */
export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;

/**
 * Every value `documents.file_type` can hold.
 *
 * An EXTENSION (`pdf`), not a MIME type — a filter built from
 * `AllowedDocumentMimeType` would ask for `application/pdf` and match no row.
 *
 * Derived from {@link EXTENSION_BY_MIME} and
 * {@link ALLOWED_DOCUMENT_MIME_TYPES}, so widening the allowlist widens this.
 * Includes {@link UNKNOWN_EXTENSION}, which confirm writes for an accepted type
 * with no extension mapping.
 */
export type DocumentFileType =
  | (typeof EXTENSION_BY_MIME)[AllowedDocumentMimeType &
      keyof typeof EXTENSION_BY_MIME]
  | typeof UNKNOWN_EXTENSION;

/**
 * {@link DocumentFileType}'s members as an array, for `@IsIn` and enum mapping.
 *
 * De-duplicated: two accepted MIME types can share one extension.
 */
export const DOCUMENT_FILE_TYPES: readonly DocumentFileType[] = [
  ...new Set(
    ALLOWED_DOCUMENT_MIME_TYPES.map((mime) => EXTENSION_BY_MIME[mime]),
  ),
  UNKNOWN_EXTENSION,
];

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
 * The scope fan-out's queue.
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
