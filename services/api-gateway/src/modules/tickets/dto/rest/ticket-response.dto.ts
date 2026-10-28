import { AttachmentResponseDto } from './message-response.dto';
import {
  TicketPriority,
  TicketSource,
  TicketStatus,
} from '@synapsedesk/contracts';

/**
 * A ticket as the REST API returns it.
 *
 * Every optional field is `| null`, never absent, so the key set is the same on
 * every row. The GraphQL `type Ticket` is the independent
 * `TicketResponseGqlDto`.
 */
export class TicketResponseDto {
  id!: string;
  /** A number, not a string: `longs: Number` keeps int64 exact to 2^53. */
  ticketNumber!: number;
  organizationId!: string;
  authorId!: string;
  source!: TicketSource | null;
  status!: TicketStatus | null;
  priority!: TicketPriority | null;
  title!: string;
  description!: string;
  currentAssigneeId!: string | null;
  currentDepartmentId!: string | null;
  escalatedAt!: Date | null;
  resolvedAt!: Date | null;
  /**
   * Messages the caller has not read on this ticket.
   *
   * Excludes their own and any internal note they cannot see. A ticket never
   * opened counts as ALL unread, not zero. Always `0` on a single-ticket read —
   * a badge is a list affordance, and a caller looking at one ticket is reading
   * it.
   */
  unreadCount!: number;
  createdAt!: Date;
  updatedAt!: Date;
  deletedAt!: Date | null;
  deletedById!: string | null;
  /**
   * The files uploaded with the ticket's opening (the description); empty
   * when none. A message's files are on the message.
   */
  attachments!: AttachmentResponseDto[];
  /**
   * Until when YOU may delete the opening's files: the ticket's author, when
   * they raised it themselves, inside the edit window from its creation. Null
   * for anyone else, a moderator included (who may always).
   */
  openingFilesDeletableUntil!: Date | null;
}

/**
 * What `POST /tickets` and `POST /chat/conversations` answer: the ticket, and
 * the opening's files that couldn't be attached.
 *
 * The ticket's own fields stay at the top level, so a client reading the
 * created ticket reads it as before.
 */
export class CreateTicketResponseDto extends TicketResponseDto {
  /**
   * File NAMES, never object paths: a path that failed its confirm (expired,
   * not the caller's, not an attachment). The ticket is created regardless.
   */
  skippedAttachments!: string[];
}

/**
 * One transition in a ticket's status history.
 *
 * Status only. Reassignments are `AssignmentResponseDto` at
 * `GET /tickets/:id/assignments`, which carries the department and a
 * `ReassignmentReason` this shape has no room for.
 */
export class TicketStatusChangeResponseDto {
  id!: string;
  ticketId!: string;
  /** Null on a row with no prior status. */
  fromStatus!: TicketStatus | null;
  toStatus!: TicketStatus;
  changedById!: string;
  /** Null when the caller may not read it — see the route's docblock. */
  reason!: string | null;
  changedAt!: Date;
}

/** The partial-success shape a bulk operation returns. */
export class BulkTicketFailureResponseDto {
  id!: string;
  reason!: string;
}

export class BulkTicketStatusResponseDto {
  updated!: string[];
  failed!: BulkTicketFailureResponseDto[];
}

/**
 * The same two fields as {@link BulkTicketStatusResponseDto}, declared
 * separately so the two routes' contracts can diverge without one silently
 * changing the other.
 */
export class BulkTicketPriorityResponseDto {
  updated!: string[];
  failed!: BulkTicketFailureResponseDto[];
}

/** What `POST /tickets/:ticketId/read` stored. */
export class MarkTicketReadResponseDto {
  lastReadAt!: Date;
}
