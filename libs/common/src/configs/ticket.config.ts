/**
 * @file Domain B's shared vocabulary — the enums, the state machine and the sortable
 * columns that `ticket-service` and `api-gateway` must agree on exactly.
 *
 * Separate file from `app.config.ts` because that one is already Domain A's
 * whole surface; a second domain appended to it would make the single most
 * imported module in the repo grow without bound. `main.ts` re-exports both, so
 * every import site still says `@synapsedesk/common`.
 *
 * Every enumerated column is a `String` in `schema.prisma` (conventions §7.3),
 * so these TS enums are the ONLY definition of the legal values — there is no
 * Postgres enum to disagree with, and none to migrate when a member is added.
 */

import type { MimeType } from './mime.config';

/** `tickets.status`. */
export enum TicketStatus {
  NEW = 'NEW',
  OPEN = 'OPEN',
  PENDING_AGENT = 'PENDING_AGENT',
  ESCALATED = 'ESCALATED',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

/** `tickets.priority`. */
export enum TicketPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

/** {@link TicketPriority}'s members as an array, for `@IsIn` and membership tests. */
export const TICKET_PRIORITIES = Object.values(TicketPriority);

/** `tickets.source` — how the ticket entered the system. */
export enum TicketSource {
  WEB = 'WEB',
  CHAT = 'CHAT',
  EMAIL = 'EMAIL',
  API = 'API',
}

/** `ticket_assignments.reason` — why this assignment happened. */
export enum ReassignmentReason {
  /** The first assignment a ticket receives. */
  INITIAL = 'INITIAL',
  /** Moved to a different department. */
  DEPARTMENT_CHANGE = 'DEPARTMENT_CHANGE',
  /** Raised to a higher tier. */
  ESCALATION = 'ESCALATION',
  /** The previous assignee is unavailable. */
  UNAVAILABLE = 'UNAVAILABLE',
  /** Spread across the team. */
  LOAD_BALANCING = 'LOAD_BALANCING',
  /** An agent picked it up themselves. */
  SELF_ASSIGNED = 'SELF_ASSIGNED',
  /** No reason given. */
  MANUAL = 'MANUAL',
}

/**
 * THE state machine. Every legal `(from, to)` edge, and nothing else.
 *
 * **The single encoding of the transition rules.** `escalate`, `resolve`,
 * `reopen` and `close` are convenience RPCs over the same generic status
 * change; if each carried its own idea of what it may transition from,
 * `POST /tickets/:id/resolve` and `POST /tickets/:id/status` would diverge the
 * first time one was updated. They call one validator, which reads this.
 *
 * Mirrors `ORG_STATUS_TRANSITIONS` so a reader who has met one can read either.
 *
 * Edges absent on purpose:
 *   - Nothing returns to NEW. It means "nobody has looked at this yet", which
 *     stops being true permanently.
 *   - RESOLVED and CLOSED reopen to OPEN, never to NEW or PENDING_AGENT — a
 *     reopened ticket is work in progress, and routing it back through triage
 *     would lose its history of having been handled.
 *   - ESCALATED cannot fall back to OPEN. De-escalation is a reassignment
 *     decision rather than a status one, and conflating them would let a status
 *     change silently move a ticket off a tier-2 queue.
 */
export const TICKET_STATUS_TRANSITIONS: Record<
  TicketStatus,
  readonly TicketStatus[]
> = {
  [TicketStatus.NEW]: [TicketStatus.OPEN, TicketStatus.ESCALATED],
  [TicketStatus.OPEN]: [
    TicketStatus.PENDING_AGENT,
    TicketStatus.ESCALATED,
    TicketStatus.RESOLVED,
    TicketStatus.CLOSED,
  ],
  [TicketStatus.PENDING_AGENT]: [
    TicketStatus.ESCALATED,
    TicketStatus.RESOLVED,
    TicketStatus.CLOSED,
  ],
  [TicketStatus.ESCALATED]: [TicketStatus.RESOLVED, TicketStatus.CLOSED],
  [TicketStatus.RESOLVED]: [TicketStatus.CLOSED, TicketStatus.OPEN],
  [TicketStatus.CLOSED]: [TicketStatus.OPEN],
};

/** Is this edge legal? The one question the whole table exists to answer. */
export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TICKET_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Statuses that mean "this ticket is finished".
 *
 * Named rather than inlined as `status === RESOLVED || status === CLOSED`,
 * because that comparison appears in list filters, metrics and the reopen path,
 * and a third member would otherwise have to be found in all three.
 */
export const TERMINAL_TICKET_STATUSES: readonly TicketStatus[] = [
  TicketStatus.RESOLVED,
  TicketStatus.CLOSED,
];

/**
 * `ticket_messages.answer_status` — what an AI reply concluded.
 *
 * Mirrors `synapsedesk.rag.AnswerStatus`; `enum-bridges.spec.ts` asserts the two
 * stay aligned.
 */
export enum AnswerStatus {
  /** Answered from the corpus, with citations. */
  DOC_ANSWER = 'DOC_ANSWER',
  /** Nothing retrieved above threshold — escalate rather than improvise. */
  DOC_MISSING = 'DOC_MISSING',
  /** Answered from the canned table. No LLM call, no ledger row. */
  GREETING = 'GREETING',
  /** The tenant is at the AI cap. The caller escalates rather than erroring. */
  AT_CAP = 'AT_CAP',
  /**
   * Refused by prompt-injection detection.
   *
   * **Not GREETING**, which is what reusing that short-circuit reported: a
   * refusal filed as a greeting is wrong in the thread, in the WebSocket frame
   * and in anything reading the trail afterwards.
   */
  REFUSED = 'REFUSED',
}

export const ANSWER_STATUSES = Object.values(AnswerStatus);

/**
 * How a retrieval-backed answer was cheapened when AI spend was unavailable.
 *
 * Mirrors `synapsedesk.rag.SearchDegradation` and
 * `synapsedesk.ticket.SuggestionsDegradation`; `enum-bridges.spec.ts` asserts
 * both bridges round-trip. `null` on a response means no degradation.
 */
export enum RetrievalDegradation {
  /**
   * The embedding was skipped and only keyword search ran, because the budget
   * could not confirm room for a paid call — the tenant is at the cap, or the
   * quota counter was unreadable.
   */
  LEXICAL_ONLY = 'LEXICAL_ONLY',
}

// ---------------------------------------------------------------------------
// Sortable columns — same four-way contract as Domain A's, see app.config.ts
//
// The arrays live HERE and the rule lives in `pagination.config.ts`, which is
// the split that keeps working: sortable columns are a fact about tickets, and
// all four things each array drives are in this domain's own module.
// ---------------------------------------------------------------------------

export const TICKET_SORTABLE_FIELDS = [
  'createdAt',
  'updatedAt',
  'ticketNumber',
  'priority',
  'status',
  'resolvedAt',
] as const;
export type TicketSortableField = (typeof TICKET_SORTABLE_FIELDS)[number];

/** Messages are a timeline: ordering by anything but time is a client bug. */
export const TICKET_MESSAGE_SORTABLE_FIELDS = ['createdAt'] as const;
export type TicketMessageSortableField =
  (typeof TICKET_MESSAGE_SORTABLE_FIELDS)[number];

export const TICKET_ASSIGNMENT_SORTABLE_FIELDS = [
  'createdAt',
  'assignedAt',
  'unassignedAt',
] as const;
export type TicketAssignmentSortableField =
  (typeof TICKET_ASSIGNMENT_SORTABLE_FIELDS)[number];

export const AUDIT_LOG_SORTABLE_FIELDS = ['createdAt', 'action'] as const;
export type AuditLogSortableField = (typeof AUDIT_LOG_SORTABLE_FIELDS)[number];

export const FEEDBACK_SORTABLE_FIELDS = ['createdAt', 'rating'] as const;
export type FeedbackSortableField = (typeof FEEDBACK_SORTABLE_FIELDS)[number];

// ---------------------------------------------------------------------------
// Attachments — validated now, stored when object storage exists
// ---------------------------------------------------------------------------

/**
 * What may be STORED as a ticket attachment — a security allowlist.
 *
 * An allowlist, never a denylist: a denylist is a promise to have thought of
 * every dangerous type, which is not a promise anyone can keep.
 *
 * **Deliberately WIDER than {@link AI_ELIGIBLE_MIME_TYPES}.** What a customer
 * may send an agent is a different question from what a model can read, and this
 * one answers the first. Office formats are here and absent there; a `.docx`
 * arrives, is stored, is downloadable, and is reported to the sender through
 * `skippedAttachments` rather than becoming a prompt part.
 *
 * **What is excluded is anything a BROWSER EXECUTES** — no `html`, no `svg`, no
 * `zip`. That bound is load-bearing rather than cautious: read URLs are signed
 * with no `responseDisposition` (`storage.service.ts`), so an object comes back
 * with the `Content-Type` pinned at upload and renders INLINE in the agent's
 * browser. An `svg` here would run the uploader's script in the reader's
 * session. Adding any such type means adding
 * `responseDisposition: 'attachment; filename="…"'` first, and this list is not
 * the place that decision gets made quietly.
 *
 * **This list is the one storage-service enforces**, not a copy of it —
 * `PURPOSE_POLICY[TICKET_ATTACHMENT]` imports it, so the two cannot drift. It is
 * also what the inbound-email webhook validates against
 * (`inbound-attachment.dto.ts`), so widening here widens a path reachable by
 * anyone who can email the tenant's address.
 */
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  // The iPhone camera default. Without these a customer photographing a broken
  // device is refused, which is the single most likely attachment in a helpdesk.
  'image/heic',
  'image/heif',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  // Agent-only: stored and downloadable, never sent to the model. See
  // `AI_ELIGIBLE_MIME_TYPES` for why that is a decision about this system rather
  // than about the model.
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const satisfies readonly MimeType[];
export type AllowedAttachmentMimeType =
  (typeof ALLOWED_ATTACHMENT_MIME_TYPES)[number];

/**
 * Which attachments may reach the MODEL.
 *
 * **A different question from {@link ALLOWED_ATTACHMENT_MIME_TYPES}, and the two
 * must not be merged.** That list is a security allowlist — "may a user store
 * this?" — while this is a capability allowlist — "may this reach the model?".
 * Tying what a customer may send to what one vendor's model reads would make a
 * model-capability change into a storage-policy change.
 *
 * **The invariant runs one way: this is a SUBSET of what is storable.** Enforced
 * by the `satisfies` below rather than by a test, so it fails at the keystroke
 * and cannot be forgotten. The direction used to be the reverse, which made
 * office formats unreachable by construction — a type that is AI-eligible and
 * not storable can never arrive, because reaching the model requires being
 * stored first.
 *
 * Everything absent stays storable, downloadable and human-readable; it simply
 * never becomes a prompt part, and the sender is told through
 * `skippedAttachments`.
 *
 * **Why the office formats are absent, precisely: this system does not extract
 * their text before sending them.** Not "the model refuses them" — that was the
 * first explanation and it is false. Probed live, the three do not even behave
 * alike: `.docx` is rejected, `.xlsx` errors, and `application/msword` is
 * accepted outright. Nothing validates the string on either side of the hop, so
 * what reaches the API is whatever this list allows.
 *
 * The reason that survives a model upgrade is the one about this system:
 * `document-parser.service.ts` already reads `.docx` via mammoth for the
 * ingestion pipeline, and promoting it here means calling that at send time.
 * Until then a `.docx` part would be bytes the model receives and cannot parse.
 *
 * **`.doc` is not in that sentence, and never should have been.** Mammoth reads
 * OOXML, so a Word 97-2003 file — an OLE2 compound binary — throws in the
 * parser rather than converting. It is storable and downloadable and there is
 * no parser to promote it with; see `MIME_TYPES` for the measured error.
 */
export const AI_ELIGIBLE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  // `satisfies readonly AllowedAttachmentMimeType[]`, not `MimeType[]`: this is
  // where the subset rule lives now. The constraint is transitive — the storable
  // list already satisfies `MimeType[]` — so nothing is lost by narrowing it.
] as const satisfies readonly AllowedAttachmentMimeType[];
export type AiEligibleMimeType = (typeof AI_ELIGIBLE_MIME_TYPES)[number];

/**
 * How many attachment bytes one message may send to the model.
 *
 * **The TOTAL across a message, not per file.** Five 3 MB screenshots are one
 * request, and a per-file cap would let them through together.
 *
 * **Derived from two ceilings, and the lower one wins:**
 *
 * | Ceiling | Value |
 * | :------ | :---- |
 * | Gemini's inline-data limit — text, instructions and bytes together | 20 MB |
 * | **gRPC message limit on `ChatRequest`/`DraftRequest`** | **10 MB** |
 *
 * The transport binds, at `GRPC_CHANNEL_OPTIONS` — and on both ends only
 * because rag-service's Python server sets matching options.
 *
 * The request carries more than the files: worst case is 40 transcript turns at
 * `MAX_MESSAGE_CONTENT_LENGTH` plus framing. **8 MB leaves roughly 2 MB of
 * headroom**, deliberately over-provisioned — skipping one attachment is a
 * message the user can act on, while exceeding the transport limit is a
 * `RESOURCE_EXHAUSTED` that fails the whole question.
 *
 * See `docs/decisions/0017-attachments-reach-retrieval.md`.
 */
export const MAX_AI_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/**
 * The largest one attachment may be.
 *
 * Read by the gateway's presign DTO and by
 * `PURPOSE_POLICY[TICKET_ATTACHMENT].maxSizeBytes` — two layers, one number.
 *
 * Distinct from {@link MAX_AI_ATTACHMENT_BYTES}, which is a TRANSPORT bound on
 * everything one message sends to the model at once.
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

/**
 * The longest attachment file name a DTO accepts.
 *
 * **A contract, not a sanity bound**, and that is why it is a constant.
 * `message_attachments.file_name` is `@db.VarChar(255)`; two places have to
 * agree, and if they drift the DTO accepts what the database rejects — a 500
 * where a 400 belongs, on a request the caller could have fixed.
 *
 * Three DTOs carry it (`NewAttachmentDto`, `ConfirmAttachmentDto`,
 * `UploadAttachmentDto`), which was three chances for one of them to be edited
 * alone.
 */
export const MAX_ATTACHMENT_FILE_NAME_LENGTH = 255;

/**
 * The longest object path a DTO accepts.
 *
 * **A bound, not a contract** — `message_attachments.file_url` is `@db.Text`,
 * so nothing downstream holds this number and no column can disagree with it.
 * A real path is around 190 characters (`organizations/{uuid}/tickets/{uuid}/
 * attachments/pending/{uuid}/{uuid}.ext`), and the server generates every one
 * of them; this exists so an absurd string is refused at the edge rather than
 * carried into a storage call.
 *
 * **It is a constant anyway, because the two DTOs that bound it had disagreed**
 * — 500 in one and 1024 in the other, for the same string. Nothing was broken
 * by that, which is precisely why it would have stayed.
 */
export const MAX_OBJECT_PATH_LENGTH = 1024;

// ---------------------------------------------------------------------------
// Misc bounds
// ---------------------------------------------------------------------------

export const MIN_TICKET_TITLE_LENGTH = 3;
export const MAX_TICKET_TITLE_LENGTH = 255;
export const MAX_TICKET_DESCRIPTION_LENGTH = 20_000;
export const MAX_MESSAGE_CONTENT_LENGTH = 20_000;

/** What `DELETE /tickets/:id/messages/:id` leaves in place of the content. */
export const REDACTED_MESSAGE_PLACEHOLDER = '[message removed]';

/** Bulk operations process each id independently; this caps one request. */
export const MAX_BULK_TICKET_IDS = 50;

/**
 * Longest reason accepted with a status change.
 *
 * In `libs/common` rather than the gateway's `dto.config.ts` because BOTH edges
 * bound it: the DTO so a caller gets a 400 naming the field, and ticket-service
 * because it is reachable over gRPC where no `ValidationPipe` ever ran. Two
 * copies of the number would be two places for it to drift.
 */
export const MAX_STATUS_CHANGE_REASON_LENGTH = 500;

/** `ai_response_feedbacks.rating` is a thumb, not a scale. */
export const FEEDBACK_RATINGS = [1, -1] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];

// ---------------------------------------------------------------------------
// Attachment text extraction
// ---------------------------------------------------------------------------

/**
 * Which stored attachments have their text extracted at confirm.
 *
 * **A third list, and it is neither of the other two.**
 * {@link ALLOWED_ATTACHMENT_MIME_TYPES} answers "may a user store this?" and
 * {@link AI_ELIGIBLE_MIME_TYPES} answers "may these bytes reach the model?".
 * This one answers "does a parser turn this into text?" — and the three
 * genuinely differ: a `.png` is storable and AI-eligible and has no text; a
 * `.doc` is storable and neither of the others, because mammoth cannot read an
 * OLE2 compound binary.
 *
 * **Disjoint from `AI_ELIGIBLE_MIME_TYPES` by construction**, and the feed path
 * depends on it: an attachment is sent as bytes OR as extracted text, never
 * both. A type in both lists would make that an ordering question, which is the
 * kind of ambiguity that gets decided differently in two places.
 */
export const PARSE_ELIGIBLE_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const satisfies readonly AllowedAttachmentMimeType[];
export type ParseEligibleMimeType = (typeof PARSE_ELIGIBLE_MIME_TYPES)[number];

/**
 * Rows kept from ONE sheet of a workbook.
 *
 * **Per sheet, so every sheet is represented.** A character cap alone lets one
 * 50,000-row sheet consume the whole budget and sheets two onward never appear.
 *
 * Applied AFTER the workbook is built, not during — see `parseXlsx`, which is
 * where the reason lives.
 */
export const MAX_SHEET_ROWS = 500;

/**
 * The longest extraction stored for ONE attachment (~25k tokens).
 *
 * **Enforced at EXTRACTION, not at feed.** Storing the whole thing and trimming
 * on the way out leaves a 50 MB workbook as tens of MB of markdown in Postgres
 * forever, for text nothing will ever send.
 */
export const MAX_EXTRACTED_TEXT_CHARS = 100_000;

/**
 * The longest extracted text ONE message may send to the model.
 *
 * **Enforced at FEED, and it cannot be anywhere else.** Extraction sees one
 * attachment at a time — `confirmNewAttachments` loops, but `confirmAttachment`
 * is one call per file — so nothing at confirm knows what an attachment's
 * siblings already spent, and asking would be racy under the concurrent uploads
 * the route is built for.
 *
 * {@link MAX_AI_ATTACHMENT_BYTES} is the precedent for WHERE as much as for
 * what: it is spent down attachment by attachment in `AiAttachmentService`, and
 * this drops into the same loop. Five attachments at
 * {@link MAX_EXTRACTED_TEXT_CHARS} each would otherwise be 500k characters for
 * one helpdesk reply.
 */
export const MAX_EXTRACTED_TEXT_PER_MESSAGE = 200_000;

/**
 * The MIME type an extracted-text part is SENT as.
 *
 * **`text/markdown`, because that is what the extraction is** — mammoth through
 * turndown emits GFM, tables included. Labelling it `text/plain` would be a
 * small lie the model reads: a pipe table announced as plain text is a wall of
 * punctuation rather than a structure.
 *
 * Deliberately NOT the attachment's own MIME type. The part carries the parse
 * result, not the file, and saying `...wordprocessingml.document` over a
 * markdown payload is exactly the mismatch that made office attachments
 * unreadable in the first place.
 */
export const EXTRACTED_TEXT_MIME_TYPE = 'text/markdown';

/** What a character-capped extraction says about itself. */
export const CHARACTER_TRUNCATION_MARKER =
  '\n\n> [Truncated: this attachment exceeded the extraction size limit]';

/**
 * What a ROW-capped sheet says about itself, inside the markdown.
 *
 * **The model is the reader that needs this**, which is why it rides in as
 * content rather than being reported to the caller. A markdown table that simply
 * stops is indistinguishable from one that ended, and the model will answer
 * confidently from the part it can see.
 *
 * Distinct from {@link CHARACTER_TRUNCATION_MARKER}: that one is appended once,
 * at the very end, and says the whole attachment was too big. This is per-sheet,
 * sits between the rows and whatever follows, and names the numbers.
 *
 * @param shown how many rows survived the cap.
 * @param total how many the sheet actually had.
 * @example
 * rowTruncationMarker(500, 12_431)
 * // '> [Truncated: 500 of 12,431 rows shown]'
 */
export function rowTruncationMarker(shown: number, total: number): string {
  return `> [Truncated: ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} rows shown]`;
}

/**
 * What a PAGE-capped extraction says about itself.
 *
 * **"sections", not "sheets".** The cap is enforced in
 * `AttachmentExtractorService`, which receives `ParsedPage[]` and is deliberately
 * blind to what produced them — a rule phrased on sheets would need
 * `if (mimeType === xlsx)` inside the one service that must not become half a
 * parser. On pages it is correct for `.docx` and every later format for free.
 *
 * @param shown how many pages fitted inside the character budget.
 * @param total how many the document had.
 */
export function sectionTruncationMarker(shown: number, total: number): string {
  return `\n\n> [Truncated: ${shown} of ${total} sections shown — size limit reached]`;
}
