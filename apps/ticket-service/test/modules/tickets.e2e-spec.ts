import { RpcException } from '@nestjs/microservices';
import { randomUUID } from 'node:crypto';
import {
  BATCH_ID_LIMIT,
  canTransition,
  compareAlphabetically,
  TICKET_PATTERNS,
  TicketPriority,
  TicketSource,
  TicketStatus,
} from '@synapsedesk/common';
import { expectRpc, rpcCode } from '@synapsedesk/common/testing/rpc';
import { status } from '@grpc/grpc-js';
import { faker } from '@faker-js/faker';
import {
  TicketPriority as ProtoTicketPriority,
  TicketSource as ProtoTicketSource,
  TicketStatus as ProtoTicketStatus,
} from '@synapsedesk/grpc-proto';
import {
  E2eFixture,
  bootstrapE2eTest,
  memberContext,
  pageRequest,
  superAdminContext,
} from '../utils';
import { buildTenant, createTicket, TenantFixture } from '../factories';
import { TicketsService } from '../../src/modules/tickets/tickets.service';
import { AuthReferenceService } from '../../src/modules/auth-client/auth-reference.service';
import { TicketEventPublisher } from '../../src/modules/events/ticket-event.publisher';
import { toProtoTicketStatus } from '../../src/modules/tickets/ticket.mapper';

describe('Tickets (e2e)', () => {
  let fx: E2eFixture;
  let tickets: TicketsService;
  let authReference: AuthReferenceService;
  let events: TicketEventPublisher;

  /** Spies, installed once. auth-service and NATS are not running for this suite. */
  let assertUserExists: jest.SpyInstance;
  let publish: jest.SpyInstance;

  let tenant: TenantFixture;

  const createRequest = (overrides: Record<string, unknown> = {}) => {
    return {
      title: 'Printer is on fire',
      description: 'It really is, and the alarm is going',
      priority: ProtoTicketPriority.TICKET_PRIORITY_UNSPECIFIED,
      source: ProtoTicketSource.TICKET_SOURCE_UNSPECIFIED,
      ...overrides,
    };
  };

  /** An ordinary member: their own tickets and nothing else. */
  const member = (t = tenant) =>
    memberContext({ id: t.userId, organizationId: t.organizationId });

  /** An agent holding the tenant queue. */
  const agent = (t = tenant) =>
    memberContext({ id: t.agentId, organizationId: t.organizationId }, [
      'ticket.read.all',
      'ticket.create',
      'ticket.update',
      'ticket.delete',
    ]);

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    tickets = fx.moduleRef.get(TicketsService);
    authReference = fx.moduleRef.get(AuthReferenceService);
    events = fx.moduleRef.get(TicketEventPublisher);

    // Stubbed rather than merely observed. The cross-service validation is a
    // real gRPC call to a peer that is not running in this suite, and the
    // publisher is fire-and-forget into a broker whose delivery nothing here
    // asserts. Both have their own dedicated tests — §2.2 for the wire, and the
    // NOT_FOUND case below for the validation.
    assertUserExists = jest
      .spyOn(authReference, 'assertUserExists')
      .mockResolvedValue(undefined);
    jest
      .spyOn(authReference, 'assertDepartmentExists')
      .mockResolvedValue(undefined);
    publish = jest.spyOn(events, 'publish').mockImplementation(() => {});
  });

  beforeEach(async () => {
    await fx.reset();
    jest.clearAllMocks();
    assertUserExists.mockResolvedValue(undefined);
    tenant = buildTenant();
  });

  afterAll(() => fx.close());

  // --------------------------------------------------------------- create

  describe('createTicket', () => {
    it('1. creates with status NEW and source WEB, and publishes ticket.created', async () => {
      const created = await tickets.createTicket(createRequest(), member());

      expect(created.status).toBe(ProtoTicketStatus.TICKET_STATUS_NEW);
      expect(created.source).toBe(ProtoTicketSource.TICKET_SOURCE_WEB);
      expect(created.priority).toBe(ProtoTicketPriority.TICKET_PRIORITY_MEDIUM);
      expect(created.authorId).toBe(tenant.userId);

      // The EVENT is the contract; the row is incidental. A consumer reads this
      // payload and nothing else, so what it carries is what must be asserted.
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: TICKET_PATTERNS.created,
          organizationId: tenant.organizationId,
          ticketId: created.id,
          authorId: tenant.userId,
          source: TicketSource.WEB,
          ticketNumber: expect.any(Number),
        }),
      );
    });

    it('1b. a client cannot choose the initial status', async () => {
      // There is no status field on the create request at all — the assertion
      // is on the SHAPE, which is what makes skipping triage impossible rather
      // than merely discouraged.
      const created = await tickets.createTicket(
        createRequest({ status: ProtoTicketStatus.TICKET_STATUS_RESOLVED }),
        member(),
      );

      expect(created.status).toBe(ProtoTicketStatus.TICKET_STATUS_NEW);
    });

    it('an explicit priority and source are honoured', async () => {
      const created = await tickets.createTicket(
        createRequest({
          priority: ProtoTicketPriority.TICKET_PRIORITY_URGENT,
          source: ProtoTicketSource.TICKET_SOURCE_CHAT,
        }),
        member(),
      );

      expect(created.priority).toBe(ProtoTicketPriority.TICKET_PRIORITY_URGENT);
      expect(created.source).toBe(ProtoTicketSource.TICKET_SOURCE_CHAT);
    });

    it('11. an authorId that does not resolve is INVALID_ARGUMENT, and NOTHING is written', async () => {
      // §1.1's write-time validation, actually running rather than documented.
      // There is no foreign key that could catch this — the users table is in
      // another database.
      assertUserExists.mockRejectedValue(
        new RpcException({
          code: status.INVALID_ARGUMENT,
          message: "No user with id 'x' in this workspace",
        }),
      );

      await expectRpc(
        tickets.createTicket(
          createRequest({ authorId: faker.string.uuid() }),
          agent(),
        ),
        status.INVALID_ARGUMENT,
      );

      expect(await fx.prisma.ticket.count()).toBe(0);
    });

    it('11b. the caller authoring their OWN ticket needs no lookup', async () => {
      // The id came from a verified token. Validating it would be a gRPC round
      // trip per ticket to re-confirm something the gateway already proved.
      await tickets.createTicket(createRequest(), member());

      expect(assertUserExists).not.toHaveBeenCalled();
    });

    it('11c. authoring on BEHALF of someone else IS validated', async () => {
      const onBehalfOf = faker.string.uuid();
      await tickets.createTicket(
        createRequest({ authorId: onBehalfOf }),
        agent(),
      );

      expect(assertUserExists).toHaveBeenCalledWith(
        onBehalfOf,
        expect.objectContaining({ organizationId: tenant.organizationId }),
      );
    });
  });

  // ---------------------------------------------------------------- read

  describe('listTickets — visibility scoping', () => {
    it('2. a non-agent sees ONLY their own authored and assigned tickets', async () => {
      // The filter that is narrower than tenant scoping, and the easiest thing
      // in the module to forget: one tenant shares one ticket table, so without
      // it every end user reads every colleague's ticket — including the ones
      // about them.
      const colleague = faker.string.uuid();

      const mine = await createTicket(fx.prisma, tenant);
      const assignedToMe = await createTicket(fx.prisma, tenant, {
        authorId: colleague,
        currentAssigneeId: tenant.userId,
      });
      const theirs = await createTicket(fx.prisma, tenant, {
        authorId: colleague,
      });

      const list = await tickets.listTickets(
        { page: pageRequest(), includeDeleted: false } as never,
        member(),
      );

      const ids = list.items.map((t) => t.id);
      expect(ids).toContain(mine.id);
      expect(ids).toContain(assignedToMe.id);
      expect(ids).not.toContain(theirs.id);
    });

    it('2b. the page META follows the same filter as the items', async () => {
      // A meta counting rows the items exclude produces a paginator promising a
      // page 2 that is empty — and an items-only assertion never catches it.
      await createTicket(fx.prisma, tenant);
      await createTicket(fx.prisma, tenant, { authorId: faker.string.uuid() });

      const list = await tickets.listTickets(
        { page: pageRequest(), includeDeleted: false } as never,
        member(),
      );

      expect(list.meta!.totalItems).toBe(list.items.length);
      expect(list.meta!.totalItems).toBe(1);
    });

    it('3. an agent with ticket.read.all sees the whole tenant queue', async () => {
      await createTicket(fx.prisma, tenant);
      await createTicket(fx.prisma, tenant, { authorId: faker.string.uuid() });
      await createTicket(fx.prisma, tenant, { authorId: faker.string.uuid() });

      const list = await tickets.listTickets(
        { page: pageRequest(), includeDeleted: false } as never,
        agent(),
      );

      expect(list.items).toHaveLength(3);
    });

    it('3b. an agent still sees NOTHING from another tenant', async () => {
      // `ticket.read.all` is the tenant's queue, not the platform's. The
      // permission short-circuit must not skip the tenant filter.
      const other = buildTenant();
      await createTicket(fx.prisma, tenant);
      await createTicket(fx.prisma, other);

      const list = await tickets.listTickets(
        { page: pageRequest(), includeDeleted: false } as never,
        agent(),
      );

      expect(list.items).toHaveLength(1);
      expect(list.items[0].organizationId).toBe(tenant.organizationId);
    });

    it('filters by status, priority and assignee', async () => {
      await createTicket(fx.prisma, tenant, { status: TicketStatus.OPEN });
      await createTicket(fx.prisma, tenant, {
        status: TicketStatus.RESOLVED,
        priority: TicketPriority.URGENT,
      });

      const open = await tickets.listTickets(
        {
          page: pageRequest(),
          status: ProtoTicketStatus.TICKET_STATUS_OPEN,
          includeDeleted: false,
        } as never,
        agent(),
      );
      const urgent = await tickets.listTickets(
        {
          page: pageRequest(),
          priority: ProtoTicketPriority.TICKET_PRIORITY_URGENT,
          includeDeleted: false,
        } as never,
        agent(),
      );

      expect(open.items).toHaveLength(1);
      expect(urgent.items).toHaveLength(1);
      expect(urgent.items[0].priority).toBe(
        ProtoTicketPriority.TICKET_PRIORITY_URGENT,
      );
    });

    it('an UNSPECIFIED filter means "no filter", not "match UNSPECIFIED"', async () => {
      // The proto zero value has to mean absence here, or every unfiltered list
      // would silently return nothing.
      await createTicket(fx.prisma, tenant, { status: TicketStatus.OPEN });
      await createTicket(fx.prisma, tenant, { status: TicketStatus.NEW });

      const all = await tickets.listTickets(
        {
          page: pageRequest(),
          status: ProtoTicketStatus.TICKET_STATUS_UNSPECIFIED,
          includeDeleted: false,
        } as never,
        agent(),
      );

      expect(all.items).toHaveLength(2);
    });
  });

  describe('getTicket / getTicketByNumber', () => {
    it('10. by-number resolves across the tenant-global sequence', async () => {
      const created = await createTicket(fx.prisma, tenant);

      const found = await tickets.getTicketByNumber(
        { ticketNumber: Number(created.ticketNumber) },
        member(),
      );

      expect(found.id).toBe(created.id);
    });

    it('10b. by-number is TENANT-SCOPED — an incrementing integer is not a key', async () => {
      // The reason this matters more than the id lookup: guessing a UUID is
      // hard, and guessing the next integer is not. Without the scope this is
      // an enumeration oracle over every tenant's tickets.
      const other = buildTenant();
      const theirs = await createTicket(fx.prisma, other);

      await expectRpc(
        tickets.getTicketByNumber(
          { ticketNumber: Number(theirs.ticketNumber) },
          agent(),
        ),
        status.NOT_FOUND,
      );
    });

    it('7. a cross-tenant get by id is NOT_FOUND', async () => {
      const other = buildTenant();
      const theirs = await createTicket(fx.prisma, other);

      await expectRpc(
        tickets.getTicket({ id: theirs.id }, agent()),
        status.NOT_FOUND,
      );
    });

    it("a non-agent reading a COLLEAGUE's ticket is NOT_FOUND, not 403", async () => {
      // 403 would confirm the ticket exists, which is the whole answer someone
      // enumerating ids is after.
      const theirs = await createTicket(fx.prisma, tenant, {
        authorId: faker.string.uuid(),
      });

      await expectRpc(
        tickets.getTicket({ id: theirs.id }, member()),
        status.NOT_FOUND,
      );
    });
  });

  // ------------------------------------------------------- state machine

  describe('4. the state machine', () => {
    const ALL = Object.values(TicketStatus);

    it('every legal (from, to) pair succeeds and every other is 409', async () => {
      // The full 6x6 grid, driven off the SAME table the implementation reads.
      // Enumerating it programmatically rather than listing the legal edges by
      // hand means a change to the table is checked in both directions — and
      // that a new status cannot be added without this test covering it.
      const failures: string[] = [];

      for (const from of ALL) {
        for (const to of ALL) {
          await fx.reset();
          const ticket = await createTicket(fx.prisma, tenant, {
            status: from,
          });

          const result = await tickets
            .changeTicketStatus(
              { id: ticket.id, status: toProtoTicketStatus(to) },
              agent(),
            )
            .then(
              () => ({ ok: true as const }),
              (error: unknown) => ({ ok: false as const, error }),
            );

          const legal = canTransition(from, to);

          if (legal && !result.ok) {
            failures.push(`${from} -> ${to}: rejected, expected success`);
          }
          if (!legal && result.ok) {
            failures.push(`${from} -> ${to}: ACCEPTED, expected 409`);
          }
          if (!legal && !result.ok) {
            const code = rpcCode(result.error);
            if (code !== status.ABORTED) {
              failures.push(
                `${from} -> ${to}: got ${status[code ?? -1]}, expected ABORTED`,
              );
            }
          }
        }
      }

      // One assertion listing every offender: a grid that stopped at the first
      // failure would hide the other thirty-five.
      expect(failures).toEqual([]);
    }, 60_000);

    it('a self-transition is refused — nothing is a legal edge to itself', async () => {
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
      });

      await expectRpc(
        tickets.changeTicketStatus(
          { id: ticket.id, status: toProtoTicketStatus(TicketStatus.OPEN) },
          agent(),
        ),
        status.ABORTED,
      );
    });

    it('the 409 names the legal targets', async () => {
      // A caller must be able to act on the error without reading the source.
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.NEW,
      });

      const error = await tickets
        .changeTicketStatus(
          { id: ticket.id, status: toProtoTicketStatus(TicketStatus.RESOLVED) },
          agent(),
        )
        .catch((e: unknown) => e);

      expect((error as RpcException).getError()).toMatchObject({
        message: expect.stringContaining('OPEN, ESCALATED'),
      });
    });

    it('publishes ticket.status_changed with both ends of the edge', async () => {
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
      });

      await tickets.changeTicketStatus(
        { id: ticket.id, status: toProtoTicketStatus(TicketStatus.RESOLVED) },
        agent(),
      );

      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: TICKET_PATTERNS.statusChanged,
          fromStatus: TicketStatus.OPEN,
          toStatus: TicketStatus.RESOLVED,
          changedById: tenant.agentId,
        }),
      );
    });

    it('a status stored OUTSIDE the enum is rejected, not treated as anything-goes', async () => {
      // `status` is a VarChar, so a migration or a psql session can put a value
      // there the table knows nothing about. Looking that up would return
      // `undefined` and permit every transition.
      const ticket = await createTicket(fx.prisma, tenant);
      await fx.prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: 'NONSENSE' },
      });

      await expectRpc(
        tickets.changeTicketStatus(
          { id: ticket.id, status: toProtoTicketStatus(TicketStatus.CLOSED) },
          agent(),
        ),
        status.INVALID_ARGUMENT,
      );
    });
  });

  describe('5. the convenience RPCs are the SAME validator', () => {
    it('resolve and status→RESOLVED produce identical state', async () => {
      // The "one validator, two entry points" rule. If each carried its own
      // idea of what it may transition from, these two would diverge the first
      // time one was updated.
      const viaAlias = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
      });
      const viaGeneric = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
      });

      const a = await tickets.resolveTicket({ id: viaAlias.id }, agent());
      const b = await tickets.changeTicketStatus(
        {
          id: viaGeneric.id,
          status: toProtoTicketStatus(TicketStatus.RESOLVED),
        },
        agent(),
      );

      expect(a.status).toBe(b.status);
      expect(Boolean(a.resolvedAt)).toBe(Boolean(b.resolvedAt));
      expect(a.resolvedAt).toBeDefined();
    });

    it('every alias refuses an illegal edge exactly as the generic RPC does', async () => {
      const cases: [TicketStatus, () => Promise<unknown>][] = [];
      const closed = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.CLOSED,
      });

      // CLOSED may only reopen. Every other alias must refuse it.
      cases.push(
        [
          TicketStatus.CLOSED,
          () => tickets.escalateTicket({ id: closed.id }, agent()),
        ],
        [
          TicketStatus.CLOSED,
          () => tickets.resolveTicket({ id: closed.id }, agent()),
        ],
        [
          TicketStatus.CLOSED,
          () => tickets.closeTicket({ id: closed.id }, agent()),
        ],
      );

      for (const [, run] of cases) {
        await expectRpc(run(), status.ABORTED);
      }

      // ...and the one legal alias works.
      await expect(
        tickets.reopenTicket({ id: closed.id }, agent()),
      ).resolves.toMatchObject({
        status: ProtoTicketStatus.TICKET_STATUS_OPEN,
      });
    });

    it('escalate stamps escalatedAt and publishes ticket.escalated', async () => {
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
      });

      const escalated = await tickets.escalateTicket(
        { id: ticket.id },
        agent(),
      );

      expect(escalated.escalatedAt).toBeDefined();
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ pattern: TICKET_PATTERNS.escalated }),
      );
    });

    it('6. reopen on CLOSED clears resolvedAt', async () => {
      // Leaving it set would make every time-to-resolution metric count a
      // ticket that is open again.
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.RESOLVED,
        resolvedAt: new Date(),
      });
      await tickets.closeTicket({ id: ticket.id }, agent());

      const reopened = await tickets.reopenTicket({ id: ticket.id }, agent());

      expect(reopened.status).toBe(ProtoTicketStatus.TICKET_STATUS_OPEN);
      expect(reopened.resolvedAt).toBeUndefined();
    });

    it('6b. reopen KEEPS escalatedAt — it really was escalated once', async () => {
      // History, not current state. Clearing it would erase the fact that the
      // ticket was ever escalated.
      const escalatedAt = new Date('2026-01-15T00:00:00.000Z');
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.ESCALATED,
        escalatedAt,
      });
      await tickets.resolveTicket({ id: ticket.id }, agent());
      const reopened = await tickets.reopenTicket({ id: ticket.id }, agent());

      expect(reopened.escalatedAt).toBeDefined();
    });
  });

  // ----------------------------------------------------------------- bulk

  describe('9. bulk status change', () => {
    it('3 valid + 1 illegal → 3 updated, 1 in failed[], no rollback', async () => {
      const ok = await Promise.all([
        createTicket(fx.prisma, tenant, { status: TicketStatus.OPEN }),
        createTicket(fx.prisma, tenant, { status: TicketStatus.OPEN }),
        createTicket(fx.prisma, tenant, { status: TicketStatus.OPEN }),
      ]);
      // NEW cannot go straight to RESOLVED.
      const illegal = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.NEW,
      });

      const result = await tickets.bulkChangeTicketStatus(
        {
          ticketIds: [...ok.map((t) => t.id), illegal.id],
          status: toProtoTicketStatus(TicketStatus.RESOLVED),
        },
        agent(),
      );

      // Spread before sorting: `.sort()` mutates, and `result.updated` is the
      // object under assertion — sorting it in place edits the value being
      // checked. (`toSorted` would be the other answer; the target is ES2022.)
      expect([...result.updated].sort(compareAlphabetically)).toEqual(
        ok.map((t) => t.id).sort(compareAlphabetically),
      );
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].id).toBe(illegal.id);
      // The REASON travels, not just the id: a caller looking at failures needs
      // to know which were already closed and which belong to another tenant.
      expect(result.failed[0].reason).toMatch(/cannot move/i);

      // The three really did commit — no rollback of the successes.
      const resolved = await fx.prisma.ticket.count({
        where: { status: TicketStatus.RESOLVED },
      });
      expect(resolved).toBe(3);
    });

    it("another tenant's id lands in failed[], and its ticket is untouched", async () => {
      const other = buildTenant();
      const mine = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
      });
      const theirs = await createTicket(fx.prisma, other, {
        status: TicketStatus.OPEN,
      });

      const result = await tickets.bulkChangeTicketStatus(
        {
          ticketIds: [mine.id, theirs.id],
          status: toProtoTicketStatus(TicketStatus.RESOLVED),
        },
        agent(),
      );

      expect(result.updated).toEqual([mine.id]);
      expect(result.failed[0].id).toBe(theirs.id);
      expect(
        (await fx.prisma.ticket.findUniqueOrThrow({ where: { id: theirs.id } }))
          .status,
      ).toBe(TicketStatus.OPEN);
    });

    it('an oversized batch is refused before any write', async () => {
      const ids = Array.from({ length: 51 }, () => faker.string.uuid());

      await expectRpc(
        tickets.bulkChangeTicketStatus(
          { ticketIds: ids, status: toProtoTicketStatus(TicketStatus.CLOSED) },
          agent(),
        ),
        status.INVALID_ARGUMENT,
      );
    });

    it('duplicate ids are collapsed, not processed twice', async () => {
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
      });

      const result = await tickets.bulkChangeTicketStatus(
        {
          ticketIds: [ticket.id, ticket.id, ticket.id],
          status: toProtoTicketStatus(TicketStatus.RESOLVED),
        },
        agent(),
      );

      // Without the dedupe the second pass would find the ticket already
      // RESOLVED and report a spurious failure for a ticket that succeeded.
      expect(result.updated).toEqual([ticket.id]);
      expect(result.failed).toEqual([]);
    });
  });

  // --------------------------------------------------------- soft delete

  describe('8. soft delete', () => {
    it('a deleted ticket is ABSENT from the list and present with includeDeleted', async () => {
      const gone = await createTicket(fx.prisma, tenant);
      const kept = await createTicket(fx.prisma, tenant);

      await tickets.deleteTicket({ id: gone.id }, agent());

      const hidden = await tickets.listTickets(
        { page: pageRequest(), includeDeleted: false } as never,
        agent(),
      );
      const shown = await tickets.listTickets(
        { page: pageRequest(), includeDeleted: true } as never,
        agent(),
      );

      expect(hidden.items.map((t) => t.id)).toEqual([kept.id]);
      expect(shown.items.map((t) => t.id).sort(compareAlphabetically)).toEqual(
        [gone.id, kept.id].sort(compareAlphabetically),
      );
    });

    it('a deleted ticket is invisible to getTicket too', async () => {
      // The list filter alone is not the guarantee: an id that still resolves
      // by direct read is a row that never really went away.
      const gone = await createTicket(fx.prisma, tenant);
      await tickets.deleteTicket({ id: gone.id }, agent());

      await expectRpc(
        tickets.getTicket({ id: gone.id }, agent()),
        status.NOT_FOUND,
      );
    });

    it('the row SURVIVES — this is never a hard delete', async () => {
      const gone = await createTicket(fx.prisma, tenant);
      await tickets.deleteTicket({ id: gone.id }, agent());

      const row = await fx.prisma.ticket.findUniqueOrThrow({
        where: { id: gone.id },
      });
      expect(row.deletedAt).not.toBeNull();
      expect(row.deletedById).toBe(tenant.agentId);
    });

    it('restore brings it back', async () => {
      const gone = await createTicket(fx.prisma, tenant);
      await tickets.deleteTicket({ id: gone.id }, agent());

      const restored = await tickets.restoreTicket({ id: gone.id }, agent());

      expect(restored.deletedAt).toBeUndefined();
      await expect(
        tickets.getTicket({ id: gone.id }, agent()),
      ).resolves.toBeDefined();
    });

    it('restoring a LIVE ticket is NOT_FOUND', async () => {
      const live = await createTicket(fx.prisma, tenant);

      await expectRpc(
        tickets.restoreTicket({ id: live.id }, agent()),
        status.NOT_FOUND,
      );
    });
  });

  // --------------------------------------------------------------- update

  describe('updateTicket', () => {
    it('an absent field is left unchanged', async () => {
      const ticket = await createTicket(fx.prisma, tenant, {
        title: 'Original',
        description: 'Original description',
      });

      const updated = await tickets.updateTicket(
        { id: ticket.id, title: 'Renamed' } as never,
        agent(),
      );

      expect(updated.title).toBe('Renamed');
      expect(updated.description).toBe('Original description');
    });

    it('status is NOT settable here — the state machine is the only path', async () => {
      // A general update that accepted status would be a second, unvalidated
      // route around the transition table.
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.NEW,
      });

      await tickets.updateTicket(
        {
          id: ticket.id,
          title: 'Renamed',
          status: ProtoTicketStatus.TICKET_STATUS_CLOSED,
        } as never,
        agent(),
      );

      expect(
        (await fx.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } }))
          .status,
      ).toBe(TicketStatus.NEW);
    });

    it('a cross-tenant update is NOT_FOUND and writes nothing', async () => {
      const other = buildTenant();
      const theirs = await createTicket(fx.prisma, other, { title: 'Theirs' });

      await expectRpc(
        tickets.updateTicket(
          { id: theirs.id, title: 'Hijacked' } as never,
          agent(),
        ),
        status.NOT_FOUND,
      );

      expect(
        (await fx.prisma.ticket.findUniqueOrThrow({ where: { id: theirs.id } }))
          .title,
      ).toBe('Theirs');
    });
  });

  describe('a Super Admin', () => {
    it('reads across tenants — the platform view', async () => {
      const other = buildTenant();
      await createTicket(fx.prisma, tenant);
      await createTicket(fx.prisma, other);

      const list = await tickets.listTickets(
        { page: pageRequest(), includeDeleted: false } as never,
        superAdminContext(),
      );

      expect(list.items).toHaveLength(2);
    });
  });

  /**
   * The batch contract
   *
   * The property specific to THIS service: `visibilityScope` applies to a batch
   * read exactly as it does to the list. A batch RPC that skipped it would be a
   * way to fetch any ticket in the tenant one id at a time — which is precisely
   * what "it is just a simple `WHERE id IN (…)`" makes easy to miss.
   */
  describe('§1 ListTicketsByIds — the batch contract', () => {
    it("1. **returns only the caller's tenant**", async () => {
      const mine = await tickets.createTicket(createRequest(), member());
      // A second tenant is just a second set of ids — this service holds no
      // organizations table, and the tenant is whatever the caller context says.
      const otherTenant = buildTenant();
      const theirs = await tickets.createTicket(
        createRequest(),
        member(otherTenant),
      );

      const { items } = await tickets.listTicketsByIds(
        { ticketIds: [mine.id, theirs.id] },
        agent(),
      );

      expect(items.map((item) => item.id)).toEqual([mine.id]);
    });

    it("2. **`visibilityScope` applies — a member cannot fetch a stranger's ticket by id**", async () => {
      // The one that matters most here. Without it, a caller with no
      // `ticket.read.all` could enumerate the whole queue an id at a time,
      // which is exactly the narrowing the list route exists to apply.
      const strangers = await tickets.createTicket(createRequest(), agent());

      const { items } = await tickets.listTicketsByIds(
        { ticketIds: [strangers.id] },
        member(),
      );

      expect(items).toEqual([]);
    });

    it('3. unknown ids are omitted, not an error', async () => {
      const mine = await tickets.createTicket(createRequest(), member());

      const { items } = await tickets.listTicketsByIds(
        { ticketIds: [mine.id, randomUUID()] },
        member(),
      );

      expect(items.map((item) => item.id)).toEqual([mine.id]);
    });

    it('4. duplicates collapse, and an empty request is empty', async () => {
      const mine = await tickets.createTicket(createRequest(), member());

      const duplicated = await tickets.listTicketsByIds(
        { ticketIds: [mine.id, mine.id] },
        member(),
      );
      const empty = await tickets.listTicketsByIds({ ticketIds: [] }, member());

      expect(duplicated.items).toHaveLength(1);
      expect(empty.items).toEqual([]);
    });

    it('5. an over-cap batch is INVALID_ARGUMENT', async () => {
      await expectRpc(
        tickets.listTicketsByIds(
          {
            ticketIds: Array.from({ length: BATCH_ID_LIMIT + 1 }, () =>
              randomUUID(),
            ),
          },
          agent(),
        ),
        status.INVALID_ARGUMENT,
      );
    });
  });
});
