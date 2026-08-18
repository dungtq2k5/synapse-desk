import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  TICKET_PATTERNS,
  TicketEventOf,
  formatErrorMsg,
} from '@synapsedesk/common';
import { RealtimeGateway } from './realtime.gateway';
import {
  orgRoom,
  REALTIME_EVENTS,
  ticketInternalRoom,
  ticketRoom,
  userRoom,
} from './realtime.config';

/**
 * The translation layer: NATS in, WebSocket out.
 *
 * Thin on purpose. It holds no state, makes no decisions and calls no service —
 * every handler is "this event went to these rooms". That is what keeps
 * ticket-service ignorant of WebSockets and the gateway ignorant of ticket
 * business rules: the contract between them is `TicketDomainEvent`, and neither
 * side imports the other.
 *
 * **Room choice is the only judgement here, and it is a privacy decision.**
 * `ticket:{id}` membership is authorized (see `TicketAccessService`), so
 * anything sent there is safe. `org:{id}` is joined by every member of a tenant
 * with no further check, so only facts a whole tenant may see go there — which
 * is why `ticket:created` carries the event and not the ticket body, and why
 * `message:new` never goes to the org room.
 */
@Controller()
export class TicketEventsConsumer {
  private readonly logger = new Logger(TicketEventsConsumer.name);

  constructor(private readonly gateway: RealtimeGateway) {}

  @EventPattern(TICKET_PATTERNS.created)
  ticketCreated(
    @Payload() event: TicketEventOf<typeof TICKET_PATTERNS.created>,
  ): void {
    this.relay(event.pattern, () => {
      // Tenant-wide: a new ticket appearing in the queue is what an agent's
      // dashboard is watching for, and nobody has joined its ticket room yet.
      this.gateway
        .toRoom(orgRoom(event.organizationId))
        .emit(REALTIME_EVENTS.ticketCreated, event);
    });
  }

  @EventPattern(TICKET_PATTERNS.assigned)
  ticketAssigned(
    @Payload() event: TicketEventOf<typeof TICKET_PATTERNS.assigned>,
  ): void {
    this.relay(event.pattern, () => {
      this.gateway
        .toRoom(ticketRoom(event.ticketId))
        .emit(REALTIME_EVENTS.ticketUpdated, event);

      // Personal, and separate from the ticket room: the new assignee has
      // almost certainly NOT joined `ticket:{id}` — being assigned is how they
      // find out it exists — so the ticket room alone would reach everyone
      // except the one person who needs to act.
      this.gateway
        .toRoom(userRoom(event.assignedToId))
        .emit(REALTIME_EVENTS.ticketAssigned, event);
    });
  }

  @EventPattern(TICKET_PATTERNS.reassigned)
  ticketReassigned(
    @Payload() event: TicketEventOf<typeof TICKET_PATTERNS.reassigned>,
  ): void {
    this.relay(event.pattern, () => {
      this.gateway
        .toRoom(ticketRoom(event.ticketId))
        .emit(REALTIME_EVENTS.ticketUpdated, event);
      this.gateway
        .toRoom(userRoom(event.toAssigneeId))
        .emit(REALTIME_EVENTS.ticketAssigned, event);

      // The PREVIOUS assignee is told too, and told through `ticket:updated`
      // rather than `ticket:assigned` — "this left your queue" is a state
      // change, not a call to action, and firing the assignment event at them
      // would put it back on their list.
      if (event.fromAssigneeId) {
        this.gateway
          .toRoom(userRoom(event.fromAssigneeId))
          .emit(REALTIME_EVENTS.ticketUpdated, event);
      }
    });
  }

  @EventPattern(TICKET_PATTERNS.unassigned)
  ticketUnassigned(
    @Payload() event: TicketEventOf<typeof TICKET_PATTERNS.unassigned>,
  ): void {
    this.relay(event.pattern, () => {
      this.gateway
        .toRoom(ticketRoom(event.ticketId))
        .emit(REALTIME_EVENTS.ticketUpdated, event);
      this.gateway
        .toRoom(userRoom(event.previousAssigneeId))
        .emit(REALTIME_EVENTS.ticketUpdated, event);
    });
  }

  @EventPattern(TICKET_PATTERNS.statusChanged)
  ticketStatusChanged(
    @Payload() event: TicketEventOf<typeof TICKET_PATTERNS.statusChanged>,
  ): void {
    this.relay(event.pattern, () => {
      this.gateway
        .toRoom(ticketRoom(event.ticketId))
        .emit(REALTIME_EVENTS.ticketUpdated, event);
    });
  }

  @EventPattern(TICKET_PATTERNS.escalated)
  ticketEscalated(
    @Payload() event: TicketEventOf<typeof TICKET_PATTERNS.escalated>,
  ): void {
    this.relay(event.pattern, () => {
      this.gateway
        .toRoom(ticketRoom(event.ticketId))
        .emit(REALTIME_EVENTS.ticketUpdated, event);
      // Also tenant-wide: an escalation is a queue event that a tier-2 agent
      // watching the dashboard must see without having opened the ticket.
      this.gateway
        .toRoom(orgRoom(event.organizationId))
        .emit(REALTIME_EVENTS.ticketUpdated, event);
    });
  }

  @EventPattern(TICKET_PATTERNS.messageCreated)
  messageCreated(
    @Payload() event: TicketEventOf<typeof TICKET_PATTERNS.messageCreated>,
  ): void {
    this.relay(event.pattern, () => {
      // **Two rooms, chosen by `isInternalNote`**.
      //
      // The previous version sent every message to `ticket:{id}` alone, with
      // the reasoning that membership there is authorized and the org room is
      // not. That reasoning was right and stopped one room short:
      // `TicketAccessService.canRead` admits the ticket's AUTHOR, so the
      // requester was in `ticket:{id}` and received every internal note live.
      //
      // The REST read strips internal notes in its `WHERE` clause, so
      // `GET /tickets/:id/messages` was safe while the push was not — a
      // customer with the page open saw the agent-only note appear, and the
      // same customer after a refresh did not.
      this.gateway
        .toRoom(this.messageRoom(event.ticketId, event.isInternalNote))
        .emit(REALTIME_EVENTS.messageNew, event);
    });
  }

  /**
   * An edit.
   *
   * The same room split, by construction: it calls the same helper, so the
   * disclosure the internal-note fix closed cannot reopen here. The new content rides on the frame,
   * which is safe precisely because of that split — it never reaches a socket
   * that could not already read the message.
   */
  @EventPattern(TICKET_PATTERNS.messageUpdated)
  messageUpdated(
    @Payload() event: TicketEventOf<typeof TICKET_PATTERNS.messageUpdated>,
  ): void {
    this.relay(event.pattern, () => {
      this.gateway
        .toRoom(this.messageRoom(event.ticketId, event.isInternalNote))
        .emit(REALTIME_EVENTS.messageUpdated, event);
    });
  }

  /**
   * A REDACTION.
   *
   * **The event carries no content and neither does this frame.** The whole
   * payload is forwarded rather than rebuilt precisely so that stays true: the
   * contract has no content field, so there is nothing here to accidentally
   * include, and adding one would be a visible change to the contract rather
   * than a quiet change to a mapper.
   */
  @EventPattern(TICKET_PATTERNS.messageRedacted)
  messageRedacted(
    @Payload() event: TicketEventOf<typeof TICKET_PATTERNS.messageRedacted>,
  ): void {
    this.relay(event.pattern, () => {
      this.gateway
        .toRoom(this.messageRoom(event.ticketId, event.isInternalNote))
        .emit(REALTIME_EVENTS.messageDeleted, event);
    });
  }

  /**
   * Which room a message-shaped event belongs in
   *
   * Shared by `message:new`, `message:updated` and `message:deleted` so the
   * three cannot drift: the disclosure was fixed once, and the two later events
   * inherit the fix rather than the bug.
   */
  private messageRoom(ticketId: string, isInternalNote: boolean) {
    return isInternalNote ? ticketInternalRoom(ticketId) : ticketRoom(ticketId); // NOSONAR
  }

  /**
   * Every handler's error boundary.
   *
   * A relay that throws does not "fail safely": with a durable subscription it
   * would redeliver the same event forever and bury every good one behind it,
   * and even without one, an unhandled rejection in a NATS handler takes the
   * process down. A dropped frame costs a client one stale view until its next
   * fetch; a dead gateway costs everyone everything.
   */
  private relay(pattern: string, emit: () => void): void {
    try {
      emit();
      // Counted here rather than at each call site: every relayed event passes
      // through this boundary, so a handler added later is measured without
      // anyone remembering to measure it.
      this.gateway.countEvent(pattern);
    } catch (error) {
      this.logger.error(`Failed to relay ${pattern}: ${formatErrorMsg(error)}`);
    }
  }
}
