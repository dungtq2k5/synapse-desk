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
};

export type TicketAssignedEvent = TicketEventBase & {
  pattern: typeof TICKET_PATTERNS.assigned;
  assignedToId: string;
  departmentId: string;
  /** null when the system assigned it — auto-routing or an escalation rule —
   * rather than a person. */
  assignedById: string | null;
};

export type TicketReassignedEvent = TicketEventBase & {
  pattern: typeof TICKET_PATTERNS.reassigned;
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
  fromStatus: TicketStatus;
  toStatus: TicketStatus;
  changedById: string | null;
};

export type TicketMessageCreatedEvent = TicketEventBase & {
  pattern: typeof TICKET_PATTERNS.messageCreated;
  messageId: string;
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

export type TicketDomainEvent =
  | TicketCreatedEvent
  | TicketEscalatedEvent
  | TicketAssignedEvent
  | TicketReassignedEvent
  | TicketUnassignedEvent
  | TicketStatusChangedEvent
  | TicketMessageCreatedEvent;

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
