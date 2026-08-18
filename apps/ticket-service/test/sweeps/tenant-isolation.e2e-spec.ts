import { AuditAction, AuditResourceType } from '@synapsedesk/grpc-proto';
import { RpcException } from '@nestjs/microservices';
import { rpcCode } from '@synapsedesk/common/testing/rpc';
import { status } from '@grpc/grpc-js';
import { faker } from '@faker-js/faker';
import { TicketStatus } from '@synapsedesk/common';
import {
  E2eFixture,
  bootstrapE2eTest,
  memberContext,
  pageRequest,
  createTestMessage,
} from '../utils';
import {
  buildTenant,
  createAiMessage,
  createAiSummary,
  createAssignedTicket,
  createAttachment,
  createAuditLog,
  createMessage,
  createTicket,
  TenantFixture,
} from '../factories';
import { TicketsService } from '../../src/modules/tickets/tickets.service';
import { AssignmentsService } from '../../src/modules/assignments/assignments.service';
import { MessagesService } from '../../src/modules/messages/messages.service';
import { AiService } from '../../src/modules/ai/ai.service';
import { FeedbackService } from '../../src/modules/feedback/feedback.service';
import { AuditReadService } from '../../src/modules/audit/audit-read.service';
import { AuthReferenceService } from '../../src/modules/auth-client/auth-reference.service';
import { TicketEventPublisher } from '../../src/modules/events/ticket-event.publisher';

/**
 * The tenant-isolation sweep.
 *
 * One table, every by-id read and write in Domain B. The property is uniform
 * and absolute: a caller in tenant A, holding EVERY permission their tenant can
 * grant, touching a resource that exists in tenant B, gets NOT_FOUND.
 *
 * NOT_FOUND rather than PERMISSION_DENIED throughout, and that is the part
 * worth being deliberate about — "you may not see this" confirms the resource
 * exists, which turns id enumeration into a tenant-membership oracle. A 404 is
 * the same answer a genuinely absent id gets, so an attacker learns nothing
 * from the difference.
 *
 * Written as a table so a new module is one row. A per-module copy of this test
 * is how a module eventually gets added without one.
 */
describe('Tenant isolation sweep (e2e)', () => {
  let fx: E2eFixture;

  let tickets: TicketsService;
  let assignments: AssignmentsService;
  let messages: MessagesService;

  let ai: AiService;
  let feedback: FeedbackService;
  let auditRead: AuditReadService;

  /** The tenant that OWNS everything the probes reach for. */
  let owner: TenantFixture;
  /** The tenant doing the reaching. Fully permissioned, wrong workspace. */
  let stranger: TenantFixture;

  /**
   * EVERY permission the tenant can hold.
   *
   * The point of the sweep: isolation must not depend on the intruder being
   * under-permissioned. A caller who is a full administrator of their OWN
   * workspace still sees nothing of anybody else's.
   */
  const fullyPermissioned = (t: TenantFixture) =>
    memberContext({ id: t.agentId, organizationId: t.organizationId }, [
      'ticket.read.all',
      'ticket.create',
      'ticket.update',
      'ticket.delete',
      'ticket.assign',
      'ticket.assign.self',
      'ticket.reassign',
      'ticket.escalate',
      'ticket.resolve',
      'ticket.ai.use',
      'ticket.message.moderate',
      'analytics.read',
      'audit.read',
    ]);

  type Probe = {
    module: string;
    operation: string;
    /** Seeds the resource in `owner`'s tenant and returns the ids a probe needs. */
    seed: () => Promise<Record<string, string>>;
    /** Runs the operation AS the stranger. */
    run: (ids: Record<string, string>) => Promise<unknown>;
  };

  const PROBES: Probe[] = [
    {
      module: 'tickets',
      operation: 'getTicket',
      seed: async () => ({ id: (await createTicket(fx.prisma, owner)).id }),
      run: (ids) =>
        tickets.getTicket({ id: ids.id }, fullyPermissioned(stranger)),
    },
    {
      module: 'tickets',
      operation: 'getTicketByNumber',
      seed: async () => {
        const ticket = await createTicket(fx.prisma, owner);
        return { number: String(ticket.ticketNumber) };
      },
      run: (ids) =>
        tickets.getTicketByNumber(
          { ticketNumber: Number(ids.number) },
          fullyPermissioned(stranger),
        ),
    },
    {
      module: 'tickets',
      operation: 'updateTicket',
      seed: async () => ({ id: (await createTicket(fx.prisma, owner)).id }),
      run: (ids) =>
        tickets.updateTicket(
          {
            id: ids.id,
            title: 'Hijacked',
            description: undefined,
            priority: 0,
          },
          fullyPermissioned(stranger),
        ),
    },
    {
      module: 'tickets',
      operation: 'changeTicketStatus',
      seed: async () => ({
        id: (
          await createTicket(fx.prisma, owner, { status: TicketStatus.OPEN })
        ).id,
      }),
      run: (ids) =>
        tickets.closeTicket({ id: ids.id }, fullyPermissioned(stranger)),
    },
    {
      module: 'tickets',
      operation: 'deleteTicket',
      seed: async () => ({ id: (await createTicket(fx.prisma, owner)).id }),
      run: (ids) =>
        tickets.deleteTicket({ id: ids.id }, fullyPermissioned(stranger)),
    },
    {
      module: 'tickets',
      operation: 'restoreTicket',
      seed: async () => ({
        id: (
          await createTicket(fx.prisma, owner, {
            deletedAt: new Date(),
            deletedById: owner.agentId,
          })
        ).id,
      }),
      run: (ids) =>
        tickets.restoreTicket({ id: ids.id }, fullyPermissioned(stranger)),
    },
    {
      module: 'assignments',
      operation: 'assignTicket',
      seed: async () => ({ id: (await createTicket(fx.prisma, owner)).id }),
      run: (ids) =>
        assignments.assignTicket(
          {
            ticketId: ids.id,
            assigneeId: stranger.agentId,
            departmentId: stranger.departmentId,
            reason: 0,
          },
          fullyPermissioned(stranger),
        ),
    },
    {
      module: 'assignments',
      operation: 'unassignTicket',
      seed: async () => {
        const { ticket } = await createAssignedTicket(fx.prisma, owner);
        return { id: ticket.id };
      },
      run: (ids) =>
        assignments.unassignTicket(
          { ticketId: ids.id },
          fullyPermissioned(stranger),
        ),
    },
    {
      module: 'assignments',
      operation: 'listAssignments',
      seed: async () => {
        const { ticket } = await createAssignedTicket(fx.prisma, owner);
        return { id: ticket.id };
      },
      run: (ids) =>
        assignments.listAssignments(
          { ticketId: ids.id },
          fullyPermissioned(stranger),
        ),
    },
    {
      module: 'messages',
      operation: 'listMessages',
      seed: async () => {
        const ticket = await createTicket(fx.prisma, owner);
        await createMessage(fx.prisma, ticket.id);
        return { id: ticket.id };
      },
      run: (ids) =>
        messages.listMessages(
          { ticketId: ids.id, page: pageRequest() },
          fullyPermissioned(stranger),
        ),
    },
    {
      module: 'messages',
      operation: 'createMessage',
      seed: async () => ({ id: (await createTicket(fx.prisma, owner)).id }),
      run: (ids) =>
        createTestMessage(
          messages,
          {
            ticketId: ids.id,
            content: 'Injected',
            isInternalNote: false,
            invokeAi: false,
          },
          fullyPermissioned(stranger),
        ),
    },
    {
      module: 'messages',
      operation: 'updateMessage',
      seed: async () => {
        const ticket = await createTicket(fx.prisma, owner);
        const message = await createMessage(fx.prisma, ticket.id);
        return { ticketId: ticket.id, messageId: message.id };
      },
      run: (ids) =>
        messages.updateMessage(
          {
            ticketId: ids.ticketId,
            messageId: ids.messageId,
            content: 'Rewritten',
          },
          fullyPermissioned(stranger),
        ),
    },
    {
      module: 'messages',
      operation: 'redactMessage',
      seed: async () => {
        const ticket = await createTicket(fx.prisma, owner);
        const message = await createMessage(fx.prisma, ticket.id);
        return { ticketId: ticket.id, messageId: message.id };
      },
      run: (ids) =>
        messages.redactMessage(
          { ticketId: ids.ticketId, messageId: ids.messageId },
          fullyPermissioned(stranger),
        ),
    },
    {
      module: 'attachments',
      operation: 'downloadAttachment',
      seed: async () => {
        const ticket = await createTicket(fx.prisma, owner);
        const message = await createMessage(fx.prisma, ticket.id);
        const attachment = await createAttachment(fx.prisma, message.id);
        return { id: attachment.id };
      },
      run: (ids) =>
        messages.downloadAttachment(
          { attachmentId: ids.id },
          fullyPermissioned(stranger),
        ),
    },
    {
      module: 'ai',
      operation: 'getSummary',
      seed: async () => {
        const ticket = await createTicket(fx.prisma, owner);
        await createAiSummary(fx.prisma, ticket.id);
        return { id: ticket.id };
      },
      run: (ids) =>
        ai.getSummary({ ticketId: ids.id }, fullyPermissioned(stranger)),
    },
    {
      module: 'ai',
      operation: 'generateSummary',
      seed: async () => ({ id: (await createTicket(fx.prisma, owner)).id }),
      run: (ids) =>
        ai.generateSummary({ ticketId: ids.id }, fullyPermissioned(stranger)),
    },
    {
      module: 'feedback',
      operation: 'submitFeedback',
      seed: async () => {
        const ticket = await createTicket(fx.prisma, owner);
        const reply = await createAiMessage(fx.prisma, ticket.id);
        return { id: reply.id };
      },
      run: (ids) =>
        feedback.submitFeedback(
          {
            ticketMessageId: ids.id,
            rating: 1,
            feedbackText: undefined,
            citationAccurate: undefined,
          },
          fullyPermissioned(stranger),
        ),
    },
    {
      module: 'feedback',
      operation: 'withdrawFeedback',
      seed: async () => {
        const ticket = await createTicket(fx.prisma, owner);
        const reply = await createAiMessage(fx.prisma, ticket.id);
        await fx.prisma.aiResponseFeedback.create({
          data: {
            ticketMessageId: reply.id,
            // The SAME user id as the stranger's, in the owner's tenant. This
            // is the sharpest version of the test: only the tenant differs.
            userId: stranger.agentId,
            organizationId: owner.organizationId,
            rating: 1,
          },
        });
        return { id: reply.id };
      },
      run: (ids) =>
        feedback.withdrawFeedback(
          { ticketMessageId: ids.id },
          fullyPermissioned(stranger),
        ),
    },
  ];

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    tickets = fx.moduleRef.get(TicketsService);
    assignments = fx.moduleRef.get(AssignmentsService);
    messages = fx.moduleRef.get(MessagesService);
    ai = fx.moduleRef.get(AiService);
    feedback = fx.moduleRef.get(FeedbackService);
    auditRead = fx.moduleRef.get(AuditReadService);

    const authReference = fx.moduleRef.get(AuthReferenceService);
    jest.spyOn(authReference, 'assertUserExists').mockResolvedValue(undefined);
    jest
      .spyOn(authReference, 'assertDepartmentExists')
      .mockResolvedValue(undefined);
    jest
      .spyOn(fx.moduleRef.get(TicketEventPublisher), 'publish')
      .mockImplementation(() => {});
  });

  beforeEach(async () => {
    await fx.reset();
    owner = buildTenant();
    stranger = buildTenant();
  });

  afterAll(() => fx.close());

  it.each(PROBES.map((p) => [`${p.module}.${p.operation}`, p] as const))(
    '%s answers NOT_FOUND across tenants',
    async (_label, probe) => {
      const ids = await probe.seed();

      await expect(probe.run(ids)).rejects.toBeInstanceOf(RpcException);
      await probe.run(ids).catch((error: unknown) => {
        expect(rpcCode(error)).toBe(status.NOT_FOUND);
      });
    },
  );

  /**
   * The LIST endpoints, which cannot 404 — they answer with an empty page.
   *
   * An emptiness assertion is weaker than a 404 one, so each of these also
   * seeds a row the stranger CAN see and asserts they get exactly that: it
   * proves the query ran and filtered, rather than failing for some unrelated
   * reason that would make any list look empty.
   */
  describe('list endpoints return the caller’s OWN rows only', () => {
    it('1. listTickets', async () => {
      await createTicket(fx.prisma, owner);
      const mine = await createTicket(fx.prisma, stranger);

      const { items } = await tickets.listTickets(
        {
          page: pageRequest(),
          status: 0,
          priority: 0,
          source: 0,
          assigneeId: '',
          departmentId: '',
          authorId: '',
          includeDeleted: false,
        },
        fullyPermissioned(stranger),
      );

      expect(items.map((t) => t.id)).toEqual([mine.id]);
    });

    it('2. listFeedback', async () => {
      const ownerTicket = await createTicket(fx.prisma, owner);
      const ownerReply = await createAiMessage(fx.prisma, ownerTicket.id);
      await fx.prisma.aiResponseFeedback.create({
        data: {
          ticketMessageId: ownerReply.id,
          userId: owner.userId,
          organizationId: owner.organizationId,
          rating: 1,
        },
      });

      const myTicket = await createTicket(fx.prisma, stranger);
      const myReply = await createAiMessage(fx.prisma, myTicket.id);
      const mine = await fx.prisma.aiResponseFeedback.create({
        data: {
          ticketMessageId: myReply.id,
          userId: stranger.userId,
          organizationId: stranger.organizationId,
          rating: -1,
        },
      });

      const { items } = await feedback.listFeedback(
        {
          page: pageRequest(),
          rating: 0,
          citationAccurate: undefined,
          from: undefined,
          to: undefined,
        },
        fullyPermissioned(stranger),
      );

      expect(items.map((f) => f.id)).toEqual([mine.id]);
    });

    it('3. listAuditLogs', async () => {
      await createAuditLog(fx.prisma, {
        organizationId: owner.organizationId,
      });
      const mine = await createAuditLog(fx.prisma, {
        organizationId: stranger.organizationId,
      });

      const { items } = await auditRead.listAuditLogs(
        {
          page: pageRequest(),
          // UNSPECIFIED on both enumerated filters — "no filter", which is what
          // the empty strings used to mean.
          action: AuditAction.AUDIT_ACTION_UNSPECIFIED,
          userId: '',
          resourceType: AuditResourceType.AUDIT_RESOURCE_TYPE_UNSPECIFIED,
          resourceId: '',
          from: undefined,
          to: undefined,
          platformScope: false,
        },
        fullyPermissioned(stranger),
      );

      expect(items.map((l) => l.id)).toEqual([mine.id]);
    });
  });

  it('a NONEXISTENT id is indistinguishable from another tenant’s', async () => {
    // The property that makes NOT_FOUND the right answer. If the two differed,
    // the difference itself would be the oracle.
    const theirs = await createTicket(fx.prisma, owner);
    const nowhere = faker.string.uuid();

    const codes: number[] = [];
    for (const id of [theirs.id, nowhere]) {
      await tickets
        .getTicket({ id }, fullyPermissioned(stranger))
        .catch((error: unknown) => codes.push(rpcCode(error)!));
    }

    expect(codes).toEqual([status.NOT_FOUND, status.NOT_FOUND]);
  });
});
