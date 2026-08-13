/**
 * Domain C's NATS contract — what `ingestion-service` publishes.
 *
 * Same reasoning as `ticket.contract.ts`: NATS is untyped on the wire, so an
 * untyped emit is a silent failure waiting for a consumer that reads
 * `undefined` and logs nothing. One pattern map, one discriminated union, and
 * consumers `switch` on `pattern` rather than on a raw subject string.
 */

export const DOCUMENT_PATTERNS = {
  /** A confirmed upload is ready to be parsed. The worker's trigger. */
  uploaded: 'document.uploaded',
  /** Chunked, embedded and upserted — relayed to the client over WS. */
  indexed: 'document.indexed',
  /** The pipeline gave up. Carries enough to render a message without a fetch. */
  ingestionFailed: 'document.ingestion_failed',
  /**
   * Visibility changed and the retrievable stores need re-writing.
   *
   * The fan-out job's trigger (11-doc §1.4b). A separate event from `uploaded`
   * because it is a re-write of existing points rather than a first index, and
   * conflating them would make a re-scope re-embed the whole document.
   */
  scopeChanged: 'document.scope_changed',
} as const;

export type DocumentPattern =
  (typeof DOCUMENT_PATTERNS)[keyof typeof DOCUMENT_PATTERNS];

type DocumentEventBase = {
  organizationId: string;
  documentId: string;
  /** ISO 8601, from the PUBLISHER's clock — same rule as every other contract. */
  occurredAt: string;
};

export type DocumentUploadedEvent = DocumentEventBase & {
  pattern: typeof DOCUMENT_PATTERNS.uploaded;
  ingestionJobId: string;
  /** The storage object path, so the worker needs no lookup to start. */
  objectPath: string;
  fileType: string;
  /**
   * ISO 639-1 codes for OCR, empty when unspecified — 34-doc §4.1.
   *
   * **Here for the same reason `fileType` is**: it is document configuration
   * the PARSE needs, and the alternative is a database read before parsing —
   * which is precisely the lookup the line above exists to avoid. The
   * processor's only `findUniqueOrThrow` happens after the parse, inside
   * `writeChunkRows`, so hoisting it would move a query to the front of the
   * hottest path in this service to serve a minority of documents.
   *
   * **The cost is acknowledged rather than hidden:** this is a field on a
   * broadcast contract that one consumer reads, for a case most documents
   * never hit. `fileType` already paid that price once, and the no-lookup rule
   * is what both are buying.
   */
  ocrLanguages: string[];
};

export type DocumentIndexedEvent = DocumentEventBase & {
  pattern: typeof DOCUMENT_PATTERNS.indexed;
  chunkCount: number;
  /**
   * Who uploaded it. The one person who is always told, whatever its scope.
   */
  uploaderId: string;
  /** Rendered by the client without a follow-up fetch. */
  title: string;
  /**
   * The visibility, CARRIED rather than re-read — 22-doc §6.2.
   *
   * The relay decides which rooms this reaches, and a department-scoped
   * document announced tenant-wide would disclose its existence and title to
   * exactly the people the department boundary excludes. Putting the scope on
   * the event means the consumer never has to fetch it, and — more importantly
   * — never has a code path where the fetch failed and it fanned out anyway.
   * Same reasoning as `ticket.message_created` carrying its ticket.
   */
  isOrganizationWide: boolean;
  departmentIds: string[];
};

export type DocumentIngestionFailedEvent = DocumentEventBase & {
  pattern: typeof DOCUMENT_PATTERNS.ingestionFailed;
  /** Already redacted for display — never a raw stack trace. */
  reason: string;
  /**
   * The uploader, and the ONLY recipient — 22-doc §6.2.
   *
   * A failure is not department news: it is one person's document not working.
   * Carried for the same reason as above, and with a sharper edge — the
   * fallback for a missing uploader must be "tell nobody", not "tell the
   * tenant".
   */
  uploaderId: string;
  title: string;
};

/**
 * `restricting` decides the fan-out ORDER, and it is the whole reason this
 * field exists on the event rather than being re-derived by the worker.
 *
 * A restriction (departments removed, org-wide turned off, a delete) must reach
 * the retrievable stores FIRST; a grant must reach `documents` first. Failing
 * halfway then over-restricts rather than over-exposes — see 11-doc §1.4b. A
 * consumer that had to work out which kind of change this was would be
 * re-deriving a security property from a diff.
 */
export type DocumentScopeChangedEvent = DocumentEventBase & {
  pattern: typeof DOCUMENT_PATTERNS.scopeChanged;
  isOrganizationWide: boolean;
  departmentIds: string[];
  isDeleted: boolean;
  restricting: boolean;
};

export type DocumentDomainEvent =
  | DocumentUploadedEvent
  | DocumentIndexedEvent
  | DocumentIngestionFailedEvent
  | DocumentScopeChangedEvent;

export type DocumentEventOf<P extends DocumentPattern> = Extract<
  DocumentDomainEvent,
  { pattern: P }
>;

/**
 * Does this visibility change REMOVE access from anyone?
 *
 * One function, because the ordering rule keys off the answer and two call
 * sites computing it independently is exactly how a restriction gets written in
 * grant order. Deliberately conservative: anything ambiguous counts as a
 * restriction, since over-restricting is the safe failure.
 */
export function isRestrictingChange(
  before: {
    isOrganizationWide: boolean;
    departmentIds: string[];
    isDeleted: boolean;
  },
  after: {
    isOrganizationWide: boolean;
    departmentIds: string[];
    isDeleted: boolean;
  },
): boolean {
  // Newly deleted — the strongest restriction there is.
  if (after.isDeleted && !before.isDeleted) return true;

  // Org-wide switched off: everyone outside the named departments just lost it.
  if (before.isOrganizationWide && !after.isOrganizationWide) return true;

  // Any department dropped, even if others were added in the same call. A
  // change that both grants and restricts is a restriction, because the half
  // that matters for safety is the half that takes access away.
  const remaining = new Set(after.departmentIds);
  return before.departmentIds.some((id) => !remaining.has(id));
}
