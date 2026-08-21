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
 * **Narrowed from twelve to five, and the twelve were never real.** This list
 * had drifted from `PURPOSE_POLICY[TICKET_ATTACHMENT]` in storage-service,
 * which accepts exactly these five and throws `INVALID_ARGUMENT` for anything
 * else. So `.docx`, `.xlsx`, `.zip`, `gif` and `csv` passed the gateway's
 * validation and were then refused at presign — a 400 from the second hop for a
 * type the API contract had just accepted. Narrowing does not remove a
 * capability; it moves an existing refusal to where the caller can understand
 * it.
 *
 * **Widen BOTH together**, or the drift returns. `mime.spec.ts` fails when they
 * disagree, which is the half that makes "both" enforceable.
 */
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'text/plain',
] as const satisfies readonly MimeType[];
export type AllowedAttachmentMimeType =
  (typeof ALLOWED_ATTACHMENT_MIME_TYPES)[number];

/**
 * Which attachments may reach the MODEL.
 *
 * **A different question from `ALLOWED_ATTACHMENT_MIME_TYPES`, and the two must
 * not be merged.** That list is a security allowlist — "may a user store this?"
 * — while this is a capability allowlist — "may this reach the model?". Tying
 * what a customer may send to what one vendor's model can read would make a
 * model-capability change into a storage-policy change.
 *
 * **The invariant is one-directional: every STORABLE type must be AI-eligible.**
 * Not the reverse. This list may be wider — `image/gif` and `text/csv` are here
 * and storable nowhere — but never NARROWER, which is the state that produces a
 * file the user uploaded and the model silently ignores. `mime.spec.ts` pins it.
 *
 * Everything absent stays storable, downloadable and human-readable; it simply
 * never becomes a prompt part, and the user is told through
 * `skippedAttachments`.
 */
export const AI_ELIGIBLE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
] as const satisfies readonly MimeType[];
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

/** `ai_response_feedbacks.rating` is a thumb, not a scale. */
export const FEEDBACK_RATINGS = [1, -1] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];
