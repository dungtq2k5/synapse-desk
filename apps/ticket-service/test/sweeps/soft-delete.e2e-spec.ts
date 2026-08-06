import { rpcCode } from '@synapsedesk/common/testing/rpc';
import { status } from '@grpc/grpc-js';
import { TicketStatus } from '@synapsedesk/common';
import {
  E2eFixture,
  bootstrapE2eTest,
  memberContext,
  pageRequest,
} from '../utils';
import {
  buildTenant,
  createAssignedTicket,
  createMessage,
  createTicket,
  TenantFixture,
} from '../factories';
import { TicketsService } from '../../src/modules/tickets/tickets.service';
import { MessagesService } from '../../src/modules/messages/messages.service';
import { AssignmentsService } from '../../src/modules/assignments/assignments.service';
import { AuthReferenceService } from '../../src/modules/auth-client/auth-reference.service';
import { TicketEventPublisher } from '../../src/modules/events/ticket-event.publisher';

/**
 * §3.2 The soft-delete sweep.
 *
 * TICKETS ONLY, and the scope is the interesting part. Messages, attachments
 * and assignments have no independent soft-delete: they follow their parent
 * ticket, and giving them their own `deleted_at` would create states nothing in
 * the product means — a live message on a deleted ticket, or a deleted
 * assignment on a live one.
 *
 * What that leaves to prove is narrow and exact: a soft-deleted ticket is
 * invisible everywhere, surfacing it takes BOTH a permission and an explicit
 * flag, and restoring it brings back everything that hung off it untouched.
 */
describe('§3.2 soft-delete sweep (e2e)', () => {
  let fx: E2eFixture;
  let tickets: TicketsService;
  let messages: MessagesService;
  let assignments: AssignmentsService;

  let tenant: TenantFixture;

  const admin = () =>
    memberContext(
      { id: tenant.agentId, organizationId: tenant.organizationId },
      [
        'ticket.read.all',
        'ticket.update',
        'ticket.delete',
        'ticket.assign',
        'ticket.message.moderate',
      ],
    );

  /** An agent WITHOUT `ticket.delete` — the recycle bin is not theirs. */
  const agentWithoutDelete = () =>
    memberContext(
      { id: tenant.agentId, organizationId: tenant.organizationId },
      ['ticket.read.all', 'ticket.update'],
    );

  const listRequest = (includeDeleted: boolean) => ({
    page: pageRequest(),
    status: 0,
    priority: 0,
    source: 0,
    assigneeId: '',
    departmentId: '',
    authorId: '',
    includeDeleted,
  });

  const softDelete = async () => {
    const ticket = await createTicket(fx.prisma, tenant, {
      status: TicketStatus.OPEN,
    });
    await tickets.deleteTicket({ id: ticket.id }, admin());
    return ticket;
  };

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    tickets = fx.moduleRef.get(TicketsService);
    messages = fx.moduleRef.get(MessagesService);
    assignments = fx.moduleRef.get(AssignmentsService);

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
    tenant = buildTenant();
  });

  afterAll(() => fx.close());

  describe('a soft-deleted ticket is INVISIBLE by default', () => {
    it('1. is absent from the list', async () => {
      const deleted = await softDelete();
      const live = await createTicket(fx.prisma, tenant);

      const { items } = await tickets.listTickets(listRequest(false), admin());

      expect(items.map((t) => t.id)).toEqual([live.id]);
      expect(items.map((t) => t.id)).not.toContain(deleted.id);
    });

    it('2. is excluded from the COUNT as well as the rows', async () => {
      // Not just cosmetic: a total that includes rows nobody can fetch makes
      // the last page of any paginated view silently empty.
      await softDelete();
      await createTicket(fx.prisma, tenant);

      const { meta } = await tickets.listTickets(listRequest(false), admin());

      expect(meta!.totalItems).toBe(1);
    });

    it('3. 404s on a by-id fetch', async () => {
      const deleted = await softDelete();

      await tickets
        .getTicket({ id: deleted.id }, admin())
        .catch((error: unknown) =>
          expect(rpcCode(error)).toBe(status.NOT_FOUND),
        );
    });

    it('4. 404s on a by-NUMBER fetch', async () => {
      // The other lookup path. A filter applied to one and not the other is the
      // classic way a "deleted" row stays reachable.
      const deleted = await softDelete();

      await tickets
        .getTicketByNumber(
          { ticketNumber: Number(deleted.ticketNumber) },
          admin(),
        )
        .catch((error: unknown) =>
          expect(rpcCode(error)).toBe(status.NOT_FOUND),
        );
    });

    it('5. 404s on every WRITE, not merely on reads', async () => {
      // A deleted ticket that can still be edited or closed is not deleted.
      const deleted = await softDelete();

      // THUNKS, not promises. Four rejecting promises built up front leave
      // three unhandled until the loop reaches them, which Node reports as an
      // unhandled rejection and Jest fails the run on — a failure with nothing
      // to do with what this test checks.
      const writes: Array<[string, () => Promise<unknown>]> = [
        [
          'update',
          () =>
            tickets.updateTicket(
              {
                id: deleted.id,
                title: 'Edited',
                description: undefined,
                priority: 0,
              },
              admin(),
            ),
        ],
        ['close', () => tickets.closeTicket({ id: deleted.id }, admin())],
        [
          'assign',
          () =>
            assignments.assignTicket(
              {
                ticketId: deleted.id,
                assigneeId: tenant.agentId,
                departmentId: tenant.departmentId,
                reason: 0,
              },
              admin(),
            ),
        ],
        [
          'post message',
          () =>
            messages.createMessage(
              {
                ticketId: deleted.id,
                content: 'hello',
                isInternalNote: false,
                invokeAi: false,
              },
              admin(),
            ),
        ],
      ];

      for (const [label, write] of writes) {
        await write().catch((error: unknown) =>
          expect([label, rpcCode(error)]).toEqual([label, status.NOT_FOUND]),
        );
      }
    });

    it('6. hides its MESSAGES and its ASSIGNMENT HISTORY', async () => {
      // The children have no soft-delete of their own — they follow the parent,
      // and this is what "follow" has to mean in practice.
      const { ticket } = await createAssignedTicket(fx.prisma, tenant);
      await createMessage(fx.prisma, ticket.id);
      await tickets.deleteTicket({ id: ticket.id }, admin());

      await messages
        .listMessages({ ticketId: ticket.id, page: pageRequest() }, admin())
        .catch((error: unknown) =>
          expect(rpcCode(error)).toBe(status.NOT_FOUND),
        );
      await assignments
        .listAssignments({ ticketId: ticket.id }, admin())
        .catch((error: unknown) =>
          expect(rpcCode(error)).toBe(status.NOT_FOUND),
        );
    });
  });

  describe('surfacing it takes BOTH a permission and a flag', () => {
    it('1. the flag alone surfaces it for a holder of ticket.delete', async () => {
      const deleted = await softDelete();

      const { items } = await tickets.listTickets(listRequest(true), admin());

      expect(items.map((t) => t.id)).toContain(deleted.id);
    });

    it('2. WITHOUT the flag, the permission alone shows nothing', async () => {
      // The recycle bin is a deliberate view, not a default. Otherwise every
      // admin's ordinary queue would silently include deleted work.
      const deleted = await softDelete();

      const { items } = await tickets.listTickets(listRequest(false), admin());

      expect(items.map((t) => t.id)).not.toContain(deleted.id);
    });

    it('3. the gateway is what withholds the FLAG from an unprivileged agent', async () => {
      // Stated so the division of labour is explicit rather than assumed. The
      // SERVICE honours `includeDeleted` from anyone — it is the gateway that
      // refuses to send it without `ticket.delete` (asserted in the gateway
      // suite). If that check were ever removed, this is the behaviour it would
      // expose, so it is written down rather than left as a surprise.
      const deleted = await softDelete();

      const { items } = await tickets.listTickets(
        listRequest(true),
        agentWithoutDelete(),
      );

      expect(items.map((t) => t.id)).toContain(deleted.id);
    });
  });

  describe('restore', () => {
    it('1. brings the ticket back into the ordinary list', async () => {
      const deleted = await softDelete();

      await tickets.restoreTicket({ id: deleted.id }, admin());

      const { items } = await tickets.listTickets(listRequest(false), admin());
      expect(items.map((t) => t.id)).toContain(deleted.id);
    });

    it('2. clears BOTH deletedAt and deletedById', async () => {
      // Leaving `deleted_by_id` set would make a restored ticket look deleted
      // to anything reading provenance rather than the timestamp.
      const deleted = await softDelete();

      await tickets.restoreTicket({ id: deleted.id }, admin());

      const row = await fx.prisma.ticket.findUniqueOrThrow({
        where: { id: deleted.id },
      });
      expect(row.deletedAt).toBeNull();
      expect(row.deletedById).toBeNull();
    });

    it('3. brings back the CHILDREN untouched', async () => {
      // They were never modified, which is the whole advantage of the parent
      // owning the delete: nothing had to be walked on the way down, so nothing
      // has to be walked on the way back up.
      const { ticket } = await createAssignedTicket(fx.prisma, tenant);
      await createMessage(fx.prisma, ticket.id);
      await tickets.deleteTicket({ id: ticket.id }, admin());

      await tickets.restoreTicket({ id: ticket.id }, admin());

      const { items } = await messages.listMessages(
        { ticketId: ticket.id, page: pageRequest() },
        admin(),
      );
      const { items: history } = await assignments.listAssignments(
        { ticketId: ticket.id },
        admin(),
      );
      expect(items).toHaveLength(1);
      expect(history).toHaveLength(1);
    });

    it('4. 404s for a ticket that is not deleted', async () => {
      // Restore acts only on deleted rows. Answering success for a live one
      // would let a client believe it had recovered something.
      const live = await createTicket(fx.prisma, tenant);

      await tickets
        .restoreTicket({ id: live.id }, admin())
        .catch((error: unknown) =>
          expect(rpcCode(error)).toBe(status.NOT_FOUND),
        );
    });

    it('5. 404s across tenants even for a genuinely deleted ticket', async () => {
      const deleted = await softDelete();
      const stranger = buildTenant();

      await tickets
        .restoreTicket(
          { id: deleted.id },
          memberContext(
            { id: stranger.agentId, organizationId: stranger.organizationId },
            ['ticket.read.all', 'ticket.delete'],
          ),
        )
        .catch((error: unknown) =>
          expect(rpcCode(error)).toBe(status.NOT_FOUND),
        );
    });
  });

  it('records WHO deleted it', async () => {
    const deleted = await softDelete();

    const row = await fx.prisma.ticket.findUniqueOrThrow({
      where: { id: deleted.id },
    });
    expect(row.deletedById).toBe(tenant.agentId);
    expect(row.deletedAt).not.toBeNull();
  });
});
