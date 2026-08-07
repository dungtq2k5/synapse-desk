import {
  ReassignmentReason,
  TICKET_PATTERNS,
  TicketDomainEvent,
  TicketStatus,
  ticketMessageGroupKey,
} from '@synapsedesk/common';
import { bootstrapE2eTest, E2eFixture } from '../utils/bootstrap';
import { TicketNotificationConsumer } from '../../src/modules/in-app/ticket-notification.consumer';
import { AuthReferenceService } from '../../src/modules/auth-client/auth-reference.service';
import { EmailService } from '../../src/modules/email/email.service';

const ORG = '11111111-1111-4111-8111-111111111111';
const TICKET_ID = '55555555-5555-4555-8555-555555555555';
const TICKET_NUMBER = 1042;
const DEPARTMENT = '66666666-6666-4666-8666-666666666666';

const REQUESTER = '22222222-2222-4222-8222-222222222222';
const AGENT = '33333333-3333-4333-8333-333333333333';
const OTHER_AGENT = '44444444-4444-4444-8444-444444444444';

function recipient(userId: string, name: string) {
  return {
    userId,
    email: `${name}@tenant.test`,
    fullName: name,
    quietHoursStart: null,
    quietHoursEnd: null,
    timezone: null,
  };
}

/**
 * 18-doc §3 — the `ticket.*` producers.
 *
 * **Three rules decide who gets notified, and each has a failure mode worse
 * than a missing notification**: a self-notification makes the feature feel
 * broken on first use, an internal note reaching the requester is a
 * disclosure, and notifying a queue is what trains people to ignore the badge.
 * Grouping is the fourth thing, and without it this is a spam machine.
 */
describe('§3 Ticket notifications (e2e)', () => {
  let fx: E2eFixture;
  let consumer: TicketNotificationConsumer;

  let listUsersByIds: jest.SpyInstance;
  let listPermissionHolders: jest.SpyInstance;
  let sendEmail: jest.SpyInstance;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    consumer = fx.moduleRef.get(TicketNotificationConsumer);

    const authReference = fx.moduleRef.get(AuthReferenceService);
    listUsersByIds = jest.spyOn(authReference, 'listUsersByIds');
    listPermissionHolders = jest.spyOn(authReference, 'listPermissionHolders');
    sendEmail = jest.spyOn(fx.moduleRef.get(EmailService), 'send');
  });

  beforeEach(async () => {
    await fx.reset();
    jest.clearAllMocks();

    // Resolves whatever ids it was ASKED for, so a test asserting who was
    // notified is asserting the consumer's decision rather than the stub's.
    listUsersByIds.mockImplementation(
      (_organizationId: string, userIds: string[]) =>
        Promise.resolve(userIds.map((id) => recipient(id, `user-${id[0]}`))),
    );
    listPermissionHolders.mockResolvedValue([
      recipient(AGENT, 'agent'),
      recipient(OTHER_AGENT, 'other'),
    ]);
    sendEmail.mockResolvedValue({ messageId: '<smtp@synapsedesk>' });
  });

  afterAll(async () => {
    await fx.close();
  });

  const base = {
    organizationId: ORG,
    ticketId: TICKET_ID,
    ticketNumber: TICKET_NUMBER,
    occurredAt: new Date().toISOString(),
  };

  const messageEvent = (
    overrides: Partial<Extract<TicketDomainEvent, { messageId: string }>> = {},
  ) =>
    ({
      ...base,
      pattern: TICKET_PATTERNS.messageCreated,
      messageId: `msg-${Math.random().toString(36).slice(2)}`,
      senderId: AGENT,
      requesterId: REQUESTER,
      assigneeId: AGENT,
      isAiGenerated: false,
      isInternalNote: false,
      groupKey: ticketMessageGroupKey(TICKET_ID),
      ...overrides,
    }) as Extract<TicketDomainEvent, { messageId: string }>;

  const recipientsOf = async (): Promise<string[]> => {
    const rows = await fx.prisma.notification.findMany({
      orderBy: { recipientId: 'asc' },
    });

    return rows.map((row) => row.recipientId);
  };

  describe('rule 1 — never notify the actor', () => {
    it('1. Assigning a ticket to YOURSELF notifies nobody', async () => {
      // The first thing anyone tests by hand, and getting it wrong makes the
      // whole feature feel broken on first use.
      await consumer.ticketAssigned({
        ...base,
        pattern: TICKET_PATTERNS.assigned,
        assignedToId: AGENT,
        departmentId: DEPARTMENT,
        assignedById: AGENT,
      });

      await expect(recipientsOf()).resolves.toEqual([]);
    });

    it('2. Assigning to SOMEONE ELSE notifies them', async () => {
      await consumer.ticketAssigned({
        ...base,
        pattern: TICKET_PATTERNS.assigned,
        assignedToId: AGENT,
        departmentId: DEPARTMENT,
        assignedById: OTHER_AGENT,
      });

      await expect(recipientsOf()).resolves.toEqual([AGENT]);
    });

    it('3. A SYSTEM assignment still notifies — there is no actor to suppress', async () => {
      // `assignedById` is null for auto-routing and escalation rules. Treating
      // null as "the actor" would silence every automatic assignment, which is
      // most of them.
      await consumer.ticketAssigned({
        ...base,
        pattern: TICKET_PATTERNS.assigned,
        assignedToId: AGENT,
        departmentId: DEPARTMENT,
        assignedById: null,
      });

      await expect(recipientsOf()).resolves.toEqual([AGENT]);
    });

    it('4. Replying to your OWN ticket notifies nobody', async () => {
      await consumer.messageCreated(
        messageEvent({ senderId: REQUESTER, assigneeId: null }),
      );

      await expect(recipientsOf()).resolves.toEqual([]);
    });
  });

  describe('rule 2 — an internal note never reaches the requester', () => {
    it('5. Notifies the AGENT and not the requester', async () => {
      // Not a UX preference — a DISCLOSURE. A note is written on the
      // understanding that the customer cannot see it, and a notification
      // carrying its existence breaks that as thoroughly as showing the text.
      await consumer.messageCreated(
        messageEvent({
          senderId: OTHER_AGENT,
          isInternalNote: true,
          assigneeId: AGENT,
        }),
      );

      const recipients = await recipientsOf();

      expect(recipients).toEqual([AGENT]);
      expect(recipients).not.toContain(REQUESTER);
    });

    it('6. Notifies NOBODY when an internal note has no assignee', async () => {
      // The requester is never the fallback. An unassigned ticket's note
      // reaching the customer because there was nobody else is the same
      // disclosure by a different route.
      await consumer.messageCreated(
        messageEvent({
          senderId: OTHER_AGENT,
          isInternalNote: true,
          assigneeId: null,
        }),
      );

      await expect(recipientsOf()).resolves.toEqual([]);
    });

    it('7. A PUBLIC message from an agent does reach the requester', async () => {
      // The control: rule 2 must narrow internal notes specifically, not
      // silence the requester generally.
      await consumer.messageCreated(
        messageEvent({ senderId: AGENT, isInternalNote: false }),
      );

      await expect(recipientsOf()).resolves.toEqual([REQUESTER]);
    });

    it('8. A message from the REQUESTER reaches the assignee', async () => {
      await consumer.messageCreated(
        messageEvent({ senderId: REQUESTER, assigneeId: AGENT }),
      );

      await expect(recipientsOf()).resolves.toEqual([AGENT]);
    });
  });

  describe('rule 3 — a person, not a queue', () => {
    it('9. `ticket.unassigned` produces NOTHING', async () => {
      // Documents a deliberate silence, so nobody "fixes" it later by adding a
      // handler that looked missing. A ticket returning to a queue is a
      // dashboard fact; notifying the department is the noise that trains
      // people to ignore the badge.
      consumer.ticketUnassigned({
        ...base,
        pattern: TICKET_PATTERNS.unassigned,
        previousAssigneeId: AGENT,
      });

      await expect(recipientsOf()).resolves.toEqual([]);
    });

    it('10. `ticket.escalated` reaches every `ticket.assign` holder in the DEPARTMENT', async () => {
      // The one permission-addressed ticket event, and department scope is the
      // part to get wrong: tenant-wide would page every agent in the company
      // for one department's queue.
      await consumer.ticketEscalated({
        ...base,
        pattern: TICKET_PATTERNS.escalated,
        escalatedAt: base.occurredAt,
        departmentId: DEPARTMENT,
      });

      expect(listPermissionHolders).toHaveBeenCalledWith(
        ORG,
        'ticket.assign',
        DEPARTMENT,
      );
      await expect(recipientsOf()).resolves.toEqual(
        [AGENT, OTHER_AGENT].sort(),
      );
    });

    it('11. An escalation with NO department notifies nobody', async () => {
      // A routing problem, and paging everyone is not a fix for it.
      await consumer.ticketEscalated({
        ...base,
        pattern: TICKET_PATTERNS.escalated,
        escalatedAt: base.occurredAt,
        departmentId: null,
      });

      expect(listPermissionHolders).not.toHaveBeenCalled();
      await expect(recipientsOf()).resolves.toEqual([]);
    });

    it('12. A reassignment notifies BOTH parties', async () => {
      // The losing side is the half that gets forgotten: losing a ticket you
      // were working on is information, and finding out by refreshing a queue
      // means the time is already spent.
      await consumer.ticketReassigned({
        ...base,
        pattern: TICKET_PATTERNS.reassigned,
        fromAssigneeId: AGENT,
        toAssigneeId: OTHER_AGENT,
        departmentId: DEPARTMENT,
        assignedById: REQUESTER,
        reason: ReassignmentReason.MANUAL,
      });

      await expect(recipientsOf()).resolves.toEqual(
        [AGENT, OTHER_AGENT].sort(),
      );
    });
  });

  describe('status changes', () => {
    it('13. Notifies the requester on a TERMINAL transition', async () => {
      await consumer.statusChanged({
        ...base,
        pattern: TICKET_PATTERNS.statusChanged,
        fromStatus: TicketStatus.OPEN,
        toStatus: TicketStatus.RESOLVED,
        changedById: AGENT,
        requesterId: REQUESTER,
      });

      await expect(recipientsOf()).resolves.toEqual([REQUESTER]);
    });

    it('14. Says NOTHING on an intermediate transition', async () => {
      // Every other status change is visible on the ticket itself, and
      // notifying on each would produce a notification per click of an agent's
      // workflow.
      await consumer.statusChanged({
        ...base,
        pattern: TICKET_PATTERNS.statusChanged,
        fromStatus: TicketStatus.OPEN,
        toStatus: TicketStatus.PENDING_AGENT,
        changedById: AGENT,
        requesterId: REQUESTER,
      });

      await expect(recipientsOf()).resolves.toEqual([]);
    });
  });

  describe('grouping — §3.2, the anti-spam rule', () => {
    it('15. **12 messages on one ticket → ONE row with group_count 12**', async () => {
      // Shipped ungrouped, a busy ticket produces a notification per reply and
      // the user turns notifications off in week one and never turns them back
      // on. This is the test that says otherwise.
      for (let index = 0; index < 12; index += 1) {
        await consumer.messageCreated(
          messageEvent({ messageId: `msg-${index}`, senderId: AGENT }),
        );
      }

      const rows = await fx.prisma.notification.findMany();

      expect(rows).toHaveLength(1);
      expect(rows[0].groupCount).toBe(12);
      expect(rows[0].recipientId).toBe(REQUESTER);
    });

    it('16. Reading the group, then a 13th message → a NEW row', async () => {
      // Unread-scoping. Without it, a long thread produces one notification the
      // user read on day one and never sees again — so they never learn of the
      // thirteenth.
      await consumer.messageCreated(messageEvent({ messageId: 'msg-1' }));
      await fx.prisma.notification.updateMany({ data: { readAt: new Date() } });

      await consumer.messageCreated(messageEvent({ messageId: 'msg-2' }));

      const rows = await fx.prisma.notification.findMany({
        orderBy: { createdAt: 'asc' },
      });

      expect(rows).toHaveLength(2);
      expect(rows[1].groupCount).toBe(1);
    });

    it('17. Redelivering the SAME message does not increment twice', async () => {
      // The §3.2 guard, at exactly the limit of what it claims: the insert is
      // deduped by the unique index, an INCREMENT is not, and comparing the
      // last triggering event id covers CONSECUTIVE redelivery — which is the
      // case NATS actually produces.
      const event = messageEvent({ messageId: 'msg-1' });
      const second = messageEvent({ messageId: 'msg-2' });

      await consumer.messageCreated(event);
      await consumer.messageCreated(second);
      await consumer.messageCreated(second);

      const [row] = await fx.prisma.notification.findMany();
      expect(row.groupCount).toBe(2);
    });

    it('18. Refreshes `created_at`, so the group returns to the TOP of the feed', async () => {
      // A collapsed notification that stayed where it was would be
      // indistinguishable from one nothing had happened to.
      await consumer.messageCreated(messageEvent({ messageId: 'msg-1' }));
      const [before] = await fx.prisma.notification.findMany();

      await new Promise((resolve) => setTimeout(resolve, 10));
      await consumer.messageCreated(messageEvent({ messageId: 'msg-2' }));

      const [after] = await fx.prisma.notification.findMany();
      expect(after.createdAt.getTime()).toBeGreaterThan(
        before.createdAt.getTime(),
      );
    });

    it('19. Publishes `notification.updated` for a collapse, not `created`', async () => {
      // A DIFFERENT client event, so the UI edits the toast it already shows
      // rather than stacking a twelfth. Without the distinction, grouping
      // exists in the database and is invisible in the UI.
      await consumer.messageCreated(messageEvent({ messageId: 'msg-1' }));
      fx.emitted.length = 0;

      await consumer.messageCreated(messageEvent({ messageId: 'msg-2' }));

      expect(fx.emitted.map((entry) => entry.pattern)).toEqual([
        'notification.updated',
      ]);
    });

    it('20. Groups PER RECIPIENT, not per ticket', async () => {
      // Two people watching one thread each get their own row: a shared counter
      // would mean one of them reading it hid the thread from the other.
      await consumer.ticketReassigned({
        ...base,
        pattern: TICKET_PATTERNS.reassigned,
        fromAssigneeId: AGENT,
        toAssigneeId: OTHER_AGENT,
        departmentId: DEPARTMENT,
        assignedById: REQUESTER,
        reason: ReassignmentReason.MANUAL,
      });

      const rows = await fx.prisma.notification.findMany();
      expect(rows).toHaveLength(2);
    });
  });

  describe('cost and containment', () => {
    it('21. No handler calls back into ticket-service', () => {
      // 18-doc §3 test 9. The event union carries every party, which is what
      // keeps the fan-out cheap — an RPC per notification on the highest-volume
      // event in the system is what makes people turn notifications off.
      //
      // Asserted structurally: `AuthReferenceService` is the ONLY outbound
      // client this service has, and it talks to auth-service. A ticket client
      // would have to be added to the module for one to exist.
      const consumerSource = TicketNotificationConsumer.toString();

      expect(consumerSource).not.toContain('TicketService');
      expect(consumerSource).not.toContain('grpc');
    });

    it('22. Notifies the remaining recipients when one write fails', async () => {
      const create = jest
        .spyOn(fx.prisma.notification, 'create')
        .mockRejectedValueOnce(new Error('injected failure'));

      try {
        await consumer.ticketReassigned({
          ...base,
          pattern: TICKET_PATTERNS.reassigned,
          fromAssigneeId: AGENT,
          toAssigneeId: OTHER_AGENT,
          departmentId: DEPARTMENT,
          assignedById: REQUESTER,
          reason: ReassignmentReason.MANUAL,
        });

        await expect(fx.prisma.notification.count()).resolves.toBe(1);
      } finally {
        create.mockRestore();
      }
    });

    it('23. Swallows a delivery failure rather than crashing the consumer', async () => {
      // An `@EventPattern` handler that throws gives core NATS nowhere to put
      // the failure — no reply channel, no redelivery — so the rejection
      // surfaces as an unhandled rejection and takes the process down, losing
      // every other queued notification.
      listUsersByIds.mockRejectedValue(new Error('auth-service is down'));

      await expect(
        consumer.messageCreated(messageEvent()),
      ).resolves.toBeUndefined();
    });

    it('24. Sends NO email for a NORMAL ticket notification', async () => {
      // Emailing every reply to every agent is how a channel earns the filter
      // that then hides the one that mattered — and 18-doc §4 is explicit that
      // you get one chance at a user's notification settings.
      await consumer.messageCreated(messageEvent());

      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('25. Deep-links, so the notification is actionable', async () => {
      await consumer.messageCreated(messageEvent());

      const [row] = await fx.prisma.notification.findMany();

      expect(row.actionUrl).toBe(`/tickets/${TICKET_NUMBER}`);
      // The pair that makes bulk-read-by-ticket possible.
      expect(row.resourceType).toBe('ticket');
      expect(row.resourceId).toBe(TICKET_ID);
    });
  });
});
