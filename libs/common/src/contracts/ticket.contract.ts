import {
  ReassignmentReason,
  TicketSource,
  TicketStatus,
} from '../configs/ticket.config';

/**
 * Domain B's NATS contract — the events `ticket-service` publishes and every
 * consumer reads.
 *
 * Same reasoning as `audit.contract.ts` and `notification.contract.ts`: NATS is
 * untyped on the wire, so an untyped emit is a silent failure waiting for a
 * consumer that reads `undefined` and logs nothing. One pattern map, one
 * discriminated union, and consumers `switch` on `pattern` — never on the raw
 * subject string, which no compiler checks.
 *
 * **This file is written FOR consumers that do not exist yet.** The gateway's
 * real-time relay is the only one today; `notification-service` and analytics
 * will be next. That is why the payloads carry more than the relay needs —
 * `ticketNumber` on `created`, `fromStatus` on `statusChanged`, the reason on
 * `reassigned`. A consumer that has to call back into ticket-service to find
 * out what happened turns one event into an event plus an RPC, and Domain E in
 * particular cannot do that cheaply for every notification it fans out.
 */
export const TICKET_PATTERNS = {
  created: 'ticket.created',
  escalated: 'ticket.escalated',
  assigned: 'ticket.assigned',
  reassigned: 'ticket.reassigned',
  unassigned: 'ticket.unassigned',
  statusChanged: 'ticket.status_changed',
  messageCreated: 'ticket.message_created',
  /** An edit — 22-doc §6.1. Same room split as the message itself. */
  messageUpdated: 'ticket.message_updated',
  /**
   * A REDACTION — 22-doc §6.1.
   *
   * Named for what happened rather than for the frame it produces: the row
   * survives with its content replaced, and calling the event `deleted` would
   * invite a consumer to remove it from a timeline whose gaps are the point.
   */
  messageRedacted: 'ticket.message_redacted',
} as const;

export type TicketPattern =
  (typeof TICKET_PATTERNS)[keyof typeof TICKET_PATTERNS];

/**
 * Fields on every event, so a consumer can route and scope without a switch.
 *
 * `organizationId` in particular: a consumer fanning out notifications needs
 * the tenant before it can decide anything, and reading it from a
 * variant-specific field would mean seven places to get it from.
 */
type TicketEventBase = {
  organizationId: string;
  ticketId: string;
  /** ISO 8601, from the PUBLISHER's clock — a consumer restart must not
   * backdate a backlog to the moment it caught up. Same rule as
   * `RecordAuditCommand.occurredAt`. */
  occurredAt: string;
};

export type TicketCreatedEvent = TicketEventBase & {
  pattern: typeof TICKET_PATTERNS.created;
  ticketNumber: number;
  authorId: string;
  source: TicketSource;
  title: string;
};

export type TicketEscalatedEvent = TicketEventBase & {
  pattern: typeof TICKET_PATTERNS.escalated;
  escalatedAt: string;
  /**
   * The queue that must react — 18-doc §3.1, and the ONE ticket event addressed
   * by permission rather than to a person.
   *
   * Everywhere else, notifying a queue produces the noise that trains people to
   * ignore the badge. An escalation is the exception because the whole point is
   * that somebody in that department picks it up. null when the ticket has no
   * department, in which case there is nobody to address.
   */
  departmentId: string | null;
  /** For the notification title. A uuid tells a reader nothing. */
  ticketNumber: number;
};

export type TicketAssignedEvent = TicketEventBase & {
  pattern: typeof TICKET_PATTERNS.assigned;
  ticketNumber: number;
  assignedToId: string;
  departmentId: string;
  /** null when the system assigned it — auto-routing or an escalation rule —
   * rather than a person. */
  assignedById: string | null;
};

export type TicketReassignedEvent = TicketEventBase & {
  pattern: typeof TICKET_PATTERNS.reassigned;
  ticketNumber: number;
  /** null when the ticket was previously unassigned. */
  fromAssigneeId: string | null;
  toAssigneeId: string;
  departmentId: string;
  assignedById: string | null;
  reason: ReassignmentReason;
};

export type TicketUnassignedEvent = TicketEventBase & {
  pattern: typeof TICKET_PATTERNS.unassigned;
  previousAssigneeId: string;
};

export type TicketStatusChangedEvent = TicketEventBase & {
  pattern: typeof TICKET_PATTERNS.statusChanged;
  ticketNumber: number;
  fromStatus: TicketStatus;
  toStatus: TicketStatus;
  changedById: string | null;
  /**
   * Who opened the ticket — the person a terminal transition is FOR.
   *
   * Carried on the event rather than fetched by the consumer (18-doc §3 test
   * 9): an RPC back to ticket-service per notification is what makes fan-out
   * expensive, and it would put a synchronous cross-service read on a path that
   * is deliberately fire-and-forget.
   */
  requesterId: string;
};

export type TicketMessageCreatedEvent = TicketEventBase & {
  pattern: typeof TICKET_PATTERNS.messageCreated;
  ticketNumber: number;
  messageId: string;
  /**
   * The two parties, so Domain E can notify *the other one*.
   *
   * `ticket.message_created` notifies the requester when an agent wrote it and
   * the assignee when the requester did — which is undecidable from `senderId`
   * alone. Both ride on the event for the same reason as `requesterId` above:
   * an RPC per message is what makes this fan-out expensive, and messages are
   * the highest-volume event in the system.
   */
  requesterId: string;
  /** null while the ticket sits in a queue with nobody working it. */
  assigneeId: string | null;
  /** null for an AI-generated message. */
  senderId: string | null;
  isAiGenerated: boolean;
  isInternalNote: boolean;
  /**
   * `ticket:{ticketId}:message` — byte-exact.
   *
   * The one field Domain B must get right FOR Domain E. `notifications.group_key`
   * collapses a burst of activity into one notification ("3 new replies"), and
   * the grouping only works if every producer writes the identical string.
   * Domain E cannot invent this later without backfilling every row, so it is
   * computed here by `ticketMessageGroupKey()` rather than assembled by hand at
   * the call site.
   */
  groupKey: string;
};

/**
 * An edit — 22-doc §6.1.
 *
 * Carries `isInternalNote` for the same reason `ticket.message_created` does:
 * the relay routes on it, and a consumer that had to fetch the message to learn
 * whether it was agent-only would be one failed fetch away from broadcasting an
 * internal note's new text to the requester.
 *
 * The new content rides along so a client re-renders without a fetch. That is
 * safe precisely because the room split is honoured — the frame never reaches a
 * socket that could not already read the message.
 */
export type TicketMessageUpdatedEvent = TicketEventBase & {
  pattern: typeof TICKET_PATTERNS.messageUpdated;
  messageId: string;
  content: string;
  isInternalNote: boolean;
  editedAt: string;
};

/**
 * A REDACTION — 22-doc §6.1.
 *
 * **Carries no content, and that is the whole design.** The row survives with
 * its text replaced; this announces *that* it happened plus which message. An
 * event carrying the old content would be the most direct way to defeat the
 * redaction it is reporting — the moderator removed the words, and the removal
 * notice would deliver them to every socket in the room.
 */
export type TicketMessageRedactedEvent = TicketEventBase & {
  pattern: typeof TICKET_PATTERNS.messageRedacted;
  messageId: string;
  isInternalNote: boolean;
  redactedAt: string;
};

export type TicketDomainEvent =
  | TicketCreatedEvent
  | TicketEscalatedEvent
  | TicketAssignedEvent
  | TicketReassignedEvent
  | TicketUnassignedEvent
  | TicketStatusChangedEvent
  | TicketMessageCreatedEvent
  | TicketMessageUpdatedEvent
  | TicketMessageRedactedEvent;

/** Narrows the union by pattern — what every consumer's handler signature wants. */
export type TicketEventOf<P extends TicketPattern> = Extract<
  TicketDomainEvent,
  { pattern: P }
>;

/**
 * THE group key for message activity on a ticket.
 *
 * A function rather than a template literal at each call site, because Domain E
 * groups on exact string equality: `ticket:{id}:messages` (plural) would be a
 * different key, produce a second notification group, and be invisible until a
 * user complained about duplicates. One producer, one definition.
 */
export function ticketMessageGroupKey(ticketId: string): string {
  return `ticket:${ticketId}:message`;
}
