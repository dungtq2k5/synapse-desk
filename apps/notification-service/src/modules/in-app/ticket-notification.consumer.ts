import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  CreateInAppNotificationCommand,
  formatErrorMsg,
  NOTIFICATION_TYPES,
  NotificationAudience,
  NotificationPriority,
  NotificationResourceType,
  TICKET_PATTERNS,
  TicketEventOf,
  TicketStatus,
} from '@synapsedesk/common';
import { InAppNotificationService } from './in-app-notification.service';

/**
 * `ticket.*` → notifications, the largest piece of Domain E.
 *
 * **Three rules decide who gets notified, and every handler applies all
 * three.** Each has a failure mode worse than a missing notification:
 *
 *   1. **Never notify the actor.** An agent who assigns a ticket to themselves,
 *      or replies to their own thread, must not be told about it. Getting this
 *      wrong makes the feature feel broken on first use — and it is the first
 *      thing anyone tests by hand. Enforced centrally in
 *      `InAppNotificationService.deliver()` via `actorId`, so a new producer
 *      gets it for free rather than having to remember.
 *
 *   2. **`isInternalNote` never reaches the requester.** Not a UX preference —
 *      a DISCLOSURE. The event carries the flag precisely so this consumer can
 *      check it, and the check is here rather than in the audience because a
 *      note still notifies the agent side normally.
 *
 *   3. **Notify a person, not a queue — with one exception.** `ticket.assigned`
 *      notifies the assignee; `ticket.unassigned` notifies nobody, because a
 *      ticket returning to a queue is a dashboard fact and telling a whole
 *      department produces the noise that trains people to ignore the badge.
 *      `ticket.escalated` is the exception: the point there IS that a human
 *      queue must react.
 *
 * **`ticket.created` produces no notification at all** — the highest-volume
 * event with the lowest information. Whoever created it knows, and nobody is
 * assigned yet.
 *
 * No handler makes a gRPC call back to ticket-service. The event union carries
 * every party it needs, which is what keeps this fan-out cheap: an RPC per
 * notification on the highest-volume event in the system is the thing that
 * makes people turn notifications off.
 */
@Controller()
export class TicketNotificationConsumer {
  private readonly logger = new Logger(TicketNotificationConsumer.name);

  constructor(private readonly inApp: InAppNotificationService) {}

  @EventPattern(TICKET_PATTERNS.assigned)
  async ticketAssigned(
    @Payload() event: TicketEventOf<typeof TICKET_PATTERNS.assigned>,
  ): Promise<void> {
    await this.deliver(event.pattern, {
      organizationId: event.organizationId,
      type: NOTIFICATION_TYPES.ticketAssigned,
      audience: users(event.assignedToId),
      // The ticket, the assignee and the event — enough to make a redelivery a
      // duplicate and a genuine re-assignment a new notification.
      eventId: `ticket.assigned:${event.ticketId}:${event.assignedToId}`,
      title: `Ticket #${event.ticketNumber} assigned to you`,
      body: 'You are now the assignee.',
      priority: NotificationPriority.NORMAL,
      occurredAt: event.occurredAt,
      // Rule 1: `assignedById` is null when the system assigned it, and then
      // there is no actor to suppress.
      actorId: event.assignedById ?? undefined,
      ...ticketTarget(event.ticketId, event.ticketNumber),
    });
  }

  @EventPattern(TICKET_PATTERNS.reassigned)
  async ticketReassigned(
    @Payload() event: TicketEventOf<typeof TICKET_PATTERNS.reassigned>,
  ): Promise<void> {
    // BOTH parties, and the losing one is the half that gets forgotten:
    // **losing a ticket you were working on is information**, and an agent who
    // finds out by refreshing a queue has already spent time on it.
    const recipients = [event.toAssigneeId, event.fromAssigneeId].filter(
      (id): id is string => Boolean(id),
    );

    await this.deliver(event.pattern, {
      organizationId: event.organizationId,
      type: NOTIFICATION_TYPES.ticketReassigned,
      audience: users(...recipients),
      eventId: `ticket.reassigned:${event.ticketId}:${event.toAssigneeId}`,
      title: `Ticket #${event.ticketNumber} was reassigned`,
      body: 'The assignee for this ticket has changed.',
      priority: NotificationPriority.NORMAL,
      occurredAt: event.occurredAt,
      actorId: event.assignedById ?? undefined,
      ...ticketTarget(event.ticketId, event.ticketNumber),
    });
  }

  /**
   * **Deliberately silent** — rule 3, and this handler exists to say so.
   *
   * A ticket returning to a queue is a dashboard fact. Notifying the whole
   * department produces exactly the noise that trains people to ignore the
   * badge, and the previous assignee already knows: they are usually the one
   * who unassigned it.
   *
   * Declared rather than omitted so nobody "fixes" the gap later by adding a
   * handler that looked missing.
   */
  @EventPattern(TICKET_PATTERNS.unassigned)
  ticketUnassigned(
    @Payload() event: TicketEventOf<typeof TICKET_PATTERNS.unassigned>,
  ): void {
    this.logger.debug(
      `No notification for ${event.pattern} on ${event.ticketId} — by design`,
    );
  }

  /**
   * The ONE ticket event addressed by PERMISSION rather than to a person.
   *
   * An escalation is the case where a queue genuinely must react, so it goes to
   * everyone holding `ticket.assign` — scoped to the target department, which
   * is the part to get wrong: tenant-wide would page every agent in the company
   * for one department's escalation.
   */
  @EventPattern(TICKET_PATTERNS.escalated)
  async ticketEscalated(
    @Payload() event: TicketEventOf<typeof TICKET_PATTERNS.escalated>,
  ): Promise<void> {
    if (!event.departmentId) {
      // No department means no queue to address. Logged rather than broadcast
      // tenant-wide — an escalation nobody owns is a routing problem, and
      // paging everyone is not a fix for it.
      this.logger.warn(
        `Ticket ${event.ticketId} escalated with no department; nobody to notify`,
      );
      return;
    }

    await this.deliver(event.pattern, {
      organizationId: event.organizationId,
      type: NOTIFICATION_TYPES.ticketEscalated,
      audience: {
        kind: 'permission',
        permission: 'ticket.assign',
        departmentId: event.departmentId,
      },
      eventId: `ticket.escalated:${event.ticketId}:${event.escalatedAt}`,
      title: `Ticket #${event.ticketNumber} was escalated`,
      body: 'This ticket needs an owner.',
      // HIGH rather than NORMAL: an escalation that waits in a feed behind
      // twelve message notifications is an escalation that did not work.
      priority: NotificationPriority.HIGH,
      occurredAt: event.occurredAt,
      ...ticketTarget(event.ticketId, event.ticketNumber),
    });
  }

  /**
   * The highest-volume event, and the one that decides whether this feature is
   * usable
   *
   * Two things happen here that happen nowhere else:
   *
   *   - **Rule 2, the disclosure rule.** An internal note notifies the AGENT
   *     side only. The requester must never learn that a note exists, let alone
   *     read its title in a toast.
   *   - **Grouping.** `groupKey` collapses a burst onto one unread row.
   *     Shipped without it, a busy ticket produces a notification per reply and
   *     the user turns notifications off in week one and never turns them back
   *     on.
   */
  @EventPattern(TICKET_PATTERNS.messageCreated)
  async messageCreated(
    @Payload() event: TicketEventOf<typeof TICKET_PATTERNS.messageCreated>,
  ): Promise<void> {
    const recipients = this.messageRecipients(event);
    if (recipients.length === 0) return;

    await this.deliver(event.pattern, {
      organizationId: event.organizationId,
      type: NOTIFICATION_TYPES.ticketMessageCreated,
      audience: users(...recipients),
      // The MESSAGE id, so each message is its own event — the group counter
      // is what collapses them, and an event id shared across messages would
      // make the second one a duplicate that never increments.
      eventId: `ticket.message_created:${event.messageId}`,
      title: `New reply on ticket #${event.ticketNumber}`,
      body: event.isInternalNote
        ? 'An internal note was added.'
        : 'There is a new message on this ticket.',
      priority: NotificationPriority.NORMAL,
      occurredAt: event.occurredAt,
      // null for an AI-generated message, and then there is no actor to
      // suppress — which is right: the AI is not a recipient either.
      actorId: event.senderId ?? undefined,
      // Domain B computes this (`ticket:{id}:message`) precisely so Domain E
      // does not have to invent it. Both sides must write the identical string
      // or the collapse silently stops working.
      groupKey: event.groupKey,
      ...ticketTarget(event.ticketId, event.ticketNumber),
    });
  }

  /**
   * Terminal transitions only — `RESOLVED` and `CLOSED`.
   *
   * Every intermediate status change is visible on the ticket itself, and
   * notifying on each one would produce a notification per click of an agent's
   * workflow. What the requester actually wants to know is that it is done.
   */
  @EventPattern(TICKET_PATTERNS.statusChanged)
  async statusChanged(
    @Payload() event: TicketEventOf<typeof TICKET_PATTERNS.statusChanged>,
  ): Promise<void> {
    if (!TERMINAL_STATUSES.has(event.toStatus)) return;

    await this.deliver(event.pattern, {
      organizationId: event.organizationId,
      type: NOTIFICATION_TYPES.ticketStatusChanged,
      audience: users(event.requesterId),
      eventId: `ticket.status_changed:${event.ticketId}:${event.toStatus}`,
      title: `Ticket #${event.ticketNumber} is ${event.toStatus.toLowerCase()}`,
      body: 'Your ticket has been closed out.',
      priority: NotificationPriority.NORMAL,
      occurredAt: event.occurredAt,
      actorId: event.changedById ?? undefined,
      ...ticketTarget(event.ticketId, event.ticketNumber),
    });
  }

  /**
   * Who hears about a message — rules 2 and 3 together.
   *
   * **The other party**: the requester when an agent wrote it, the assignee
   * when the requester did. Both ids are on the event, so this is a decision
   * rather than a lookup.
   */
  private messageRecipients(
    event: TicketEventOf<typeof TICKET_PATTERNS.messageCreated>,
  ): string[] {
    const fromRequester = event.senderId === event.requesterId;

    if (event.isInternalNote) {
      // **Rule 2 — the disclosure rule.** Agents only, and never the requester,
      // even when the assignee happens to be absent. A note is written on the
      // understanding that the customer cannot see it, and a notification
      // carrying its existence breaks that as thoroughly as showing the text.
      return event.assigneeId ? [event.assigneeId] : [];
    }

    if (fromRequester) {
      // Nobody is working it yet. The ticket sits in a queue that agents watch;
      // notifying the whole department for every customer reply is rule 3's
      // failure mode.
      return event.assigneeId ? [event.assigneeId] : [];
    }

    return [event.requesterId];
  }

  /**
   * One place where a handler failure is contained.
   *
   * An `@EventPattern` handler that throws gives core NATS nowhere to put the
   * failure — no reply channel, and without JetStream ack semantics, no
   * redelivery — so the rejection surfaces as an unhandled rejection and takes
   * the process down, losing every other queued notification.
   */
  private async deliver(
    pattern: string,
    command: CreateInAppNotificationCommand,
  ): Promise<void> {
    try {
      await this.inApp.deliver(command);
    } catch (error) {
      this.logger.error(
        `Could not notify for ${pattern}: ${formatErrorMsg(error)}`,
      );
    }
  }
}

/**
 * `RESOLVED` and `CLOSED` — the transitions worth telling a requester about.
 *
 * From the shared enum rather than string literals, so a status renamed in
 * Domain B is a compile error here instead of a notification that silently
 * stops firing.
 */
const TERMINAL_STATUSES = new Set<TicketStatus>([
  TicketStatus.RESOLVED,
  TicketStatus.CLOSED,
]);

/** Deduplicated at the edge, so the audience is a set by construction. */
function users(...userIds: string[]): NotificationAudience {
  return { kind: 'users', userIds: [...new Set(userIds.filter(Boolean))] };
}

/**
 * The deep-link and bulk-read fields, together.
 *
 * `resourceType`/`resourceId` are what make *"opening ticket #1042 clears its
 * twelve notifications"* possible, and `actionUrl` is what makes the toast
 * clickable. Set as a pair because a notification with one and not the other is
 * either unclickable or unclearable.
 */
function ticketTarget(ticketId: string, ticketNumber: number) {
  return {
    resourceType: NotificationResourceType.TICKET,
    resourceId: ticketId,
    actionUrl: `/tickets/${ticketNumber}`,
    data: { ticketId, ticketNumber },
  };
}
