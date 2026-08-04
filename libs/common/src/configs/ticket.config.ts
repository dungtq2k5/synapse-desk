/**
 * Domain B's shared vocabulary — the enums, the state machine and the sortable
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
 * **This table is the single encoding of the transition rules**, and that is the
 * point rather than a stylistic preference. `escalate`, `resolve`, `reopen` and
 * `close` are convenience RPCs over the same generic status change — if each
 * carried its own idea of what it may transition from, `POST /tickets/:id/resolve`
 * and `POST /tickets/:id/status {status: RESOLVED}` would diverge the first time
 * one was updated and the other was not. They call one validator, which reads
 * this.
 *
 * The shape mirrors `ORG_STATUS_TRANSITIONS` deliberately: same idea, same
 * lookup, so a reader who has met one already knows how to read the other.
 *
 * Notes on the edges that are absent on purpose:
 *   - Nothing returns to NEW. It means "nobody has looked at this yet", which
 *     stops being true permanently.
 *   - RESOLVED and CLOSED both reopen to OPEN, never to NEW or PENDING_AGENT —
 *     a reopened ticket is work in progress, and routing it back through triage
 *     would lose its history of having been handled.
 *   - ESCALATED cannot fall back to OPEN. De-escalation is a real workflow, but
 *     it is a reassignment decision rather than a status one, and conflating
 *     them would let a status change silently move a ticket off a tier-2 queue.
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

// ---------------------------------------------------------------------------
// Sortable columns — same four-way contract as Domain A's, see app.config.ts
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
// Attachments — validated now, stored when object storage exists (§1.8)
// ---------------------------------------------------------------------------

/**
 * An allowlist, never a denylist.
 *
 * A denylist is a promise to have thought of every dangerous type, which is not
 * a promise anyone can keep. Anything not named here is refused.
 */
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;
export type AllowedAttachmentMimeType =
  (typeof ALLOWED_ATTACHMENT_MIME_TYPES)[number];

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

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
