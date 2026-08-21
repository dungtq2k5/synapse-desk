import { RpcException } from '@nestjs/microservices';
import { randomUUID } from 'node:crypto';
import {
  BATCH_ID_LIMIT,
  canTransition,
  compareAlphabetically,
  TICKET_PATTERNS,
  MAX_STATUS_CHANGE_REASON_LENGTH,
  systemContext,
  TicketPriority,
  TicketSource,
  TERMINAL_TICKET_STATUSES,
  TicketStatus,
} from '@synapsedesk/common';
import { expectRpc, rpcCode } from '@synapsedesk/common/testing/rpc';
import { status } from '@grpc/grpc-js';
import { faker } from '@faker-js/faker';
import {
  TicketPriority as ProtoTicketPriority,
  TicketSource as ProtoTicketSource,
  TicketStatus as ProtoTicketStatus,
  fromProtoTimestamp,
  toProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import {
  E2eFixture,
  bootstrapE2eTest,
  memberContext,
  pageRequest,
  superAdminContext,
} from '../utils';
import {
  buildTenant,
  createMessage,
  createTicket,
  TenantFixture,
} from '../factories';
import { TicketsService } from '../../src/modules/tickets/tickets.service';
import { AuthReferenceService } from '../../src/modules/auth-client/auth-reference.service';
import { TicketEventPublisher } from '../../src/modules/events/ticket-event.publisher';
import {
  fromProtoTicketStatus,
  toProtoTicketPriority,
  toProtoTicketStatus,
} from '../../src/modules/tickets/ticket.mapper';

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
    // asserts. Both have their own dedicated tests.2 for the wire, and the
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
      // Write-time validation, actually running rather than documented.
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

          // `RESOLVED` and `CLOSED` are refused here on AUTHORIZATION, not
          // legality: they need `ticket.resolve`, which this route's
          // `ticket.update` decorator cannot express. Legal or not, the
          // generic route answers FAILED_PRECONDITION and points at
          // `/resolve` and `/close`.
          const terminal = TERMINAL_TICKET_STATUSES.includes(to);
          const legal = canTransition(from, to);
          const expected = terminal
            ? status.FAILED_PRECONDITION
            : legal // NOSONAR
              ? null
              : status.ABORTED;

          if (expected === null && !result.ok) {
            failures.push(`${from} -> ${to}: rejected, expected success`);
          }
          if (expected !== null && result.ok) {
            failures.push(
              `${from} -> ${to}: ACCEPTED, expected ${status[expected]}`,
            );
          }
          if (expected !== null && !result.ok) {
            const code = rpcCode(result.error);
            if (code !== expected) {
              failures.push(
                `${from} -> ${to}: got ${status[code ?? -1]}, expected ${status[expected]}`,
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
      //
      // `NEW -> ESCALATED` is legal and `NEW -> PENDING_AGENT` is not, so this
      // reaches the transition table's own refusal. A terminal target would
      // not: the route stops those before `assertTransition` runs, and the
      // message names a ROUTE rather than a set of statuses.
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.NEW,
      });

      const error = await tickets
        .changeTicketStatus(
          {
            id: ticket.id,
            status: toProtoTicketStatus(TicketStatus.PENDING_AGENT),
          },
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

      // A NON-terminal edge: the generic route refuses `RESOLVED` and
      // `CLOSED` outright now, so an edge ending at one would never reach the
      // publish this asserts.
      await tickets.changeTicketStatus(
        { id: ticket.id, status: toProtoTicketStatus(TicketStatus.ESCALATED) },
        agent(),
      );

      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: TICKET_PATTERNS.statusChanged,
          fromStatus: TicketStatus.OPEN,
          toStatus: TicketStatus.ESCALATED,
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

      // Target is non-terminal on purpose: the terminal refusal runs BEFORE
      // the row is loaded, so `CLOSED` here would answer FAILED_PRECONDITION
      // and never exercise `assertKnownStatus` at all.
      await expectRpc(
        tickets.changeTicketStatus(
          {
            id: ticket.id,
            status: toProtoTicketStatus(TicketStatus.ESCALATED),
          },
          agent(),
        ),
        status.INVALID_ARGUMENT,
      );
    });
  });

  describe('5. the convenience RPCs are the SAME validator', () => {
    it('**status→RESOLVED is refused where /resolve succeeds, from the same state**', async () => {
      // These two USED to be interchangeable, and that was the bug: `/resolve`
      // requires `ticket.resolve` while the generic route requires only
      // `ticket.update`, so the generic route was a way around the stronger
      // right. They still share one validator — `transition` — but only one of
      // them may reach a terminal state.
      const viaAlias = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
      });
      const viaGeneric = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
      });

      const resolved = await tickets.resolveTicket(
        { ticketId: viaAlias.id },
        agent(),
      );
      expect(resolved.resolvedAt).toBeDefined();

      const refused = tickets.changeTicketStatus(
        {
          id: viaGeneric.id,
          status: toProtoTicketStatus(TicketStatus.RESOLVED),
        },
        agent(),
      );

      await expectRpc(refused, status.FAILED_PRECONDITION);
      await expect(refused).rejects.toMatchObject({
        // Names the route to use, not just the refusal — a caller cannot act
        // on "no".
        message: expect.stringContaining('resolve') as string,
      });
      // And nothing was written on the way to refusing.
      expect(
        (
          await fx.prisma.ticket.findUniqueOrThrow({
            where: { id: viaGeneric.id },
          })
        ).status,
      ).toBe(TicketStatus.OPEN);
    });

    it('**and CLOSED is refused the same way, naming its own route**', async () => {
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
      });

      const refused = tickets.changeTicketStatus(
        { id: ticket.id, status: toProtoTicketStatus(TicketStatus.CLOSED) },
        agent(),
      );

      await expectRpc(refused, status.FAILED_PRECONDITION);
      await expect(refused).rejects.toMatchObject({
        message: expect.stringContaining('close') as string,
      });
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
          () => tickets.escalateTicket({ ticketId: closed.id }, agent()),
        ],
        [
          TicketStatus.CLOSED,
          () => tickets.resolveTicket({ ticketId: closed.id }, agent()),
        ],
        [
          TicketStatus.CLOSED,
          () => tickets.closeTicket({ ticketId: closed.id }, agent()),
        ],
      );

      for (const [, run] of cases) {
        await expectRpc(run(), status.ABORTED);
      }

      // ...and the one legal alias works.
      await expect(
        tickets.reopenTicket({ ticketId: closed.id }, agent()),
      ).resolves.toMatchObject({
        status: ProtoTicketStatus.TICKET_STATUS_OPEN,
      });
    });

    it('escalate stamps escalatedAt and publishes ticket.escalated', async () => {
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
      });

      const escalated = await tickets.escalateTicket(
        { ticketId: ticket.id },
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
      await tickets.closeTicket({ ticketId: ticket.id }, agent());

      const reopened = await tickets.reopenTicket(
        { ticketId: ticket.id },
        agent(),
      );

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
      await tickets.resolveTicket({ ticketId: ticket.id }, agent());
      const reopened = await tickets.reopenTicket(
        { ticketId: ticket.id },
        agent(),
      );

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
      // NEW cannot go straight to PENDING_AGENT — it may only OPEN or ESCALATE.
      const illegal = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.NEW,
      });

      // A NON-terminal target throughout this block. Bulk is `ticket.update`
      // like the singular generic route, so it refuses RESOLVED and CLOSED for
      // the whole request — see the terminal test below. Per-item partial
      // success is what these three are about, and it is orthogonal to which
      // status is being set.
      const result = await tickets.bulkChangeTicketStatus(
        {
          ticketIds: [...ok.map((t) => t.id), illegal.id],
          status: toProtoTicketStatus(TicketStatus.PENDING_AGENT),
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
      const moved = await fx.prisma.ticket.count({
        where: { status: TicketStatus.PENDING_AGENT },
      });
      expect(moved).toBe(3);
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
          status: toProtoTicketStatus(TicketStatus.PENDING_AGENT),
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
          status: toProtoTicketStatus(TicketStatus.PENDING_AGENT),
        },
        agent(),
      );

      // Without the dedupe the second pass would find the ticket already
      // PENDING_AGENT and report a spurious failure for a ticket that
      // succeeded — no status is a legal edge to itself.
      expect(result.updated).toEqual([ticket.id]);
      expect(result.failed).toEqual([]);
    });

    it('**a terminal target is refused for the WHOLE batch, not per item**', async () => {
      // The bulk half of the bypass: `bulk/status` is `ticket.update`, so
      // without this one call closes fifty tickets behind a right that cannot
      // close one.
      //
      // Thrown rather than fifty entries in `failed[]`: the target is one value
      // for the whole request, so it is the request that is wrong. A per-item
      // refusal would also report it as a state-machine failure, which it is
      // not.
      const tickets_ = await Promise.all([
        createTicket(fx.prisma, tenant, { status: TicketStatus.OPEN }),
        createTicket(fx.prisma, tenant, { status: TicketStatus.OPEN }),
      ]);

      const refused = tickets.bulkChangeTicketStatus(
        {
          ticketIds: tickets_.map((t) => t.id),
          status: toProtoTicketStatus(TicketStatus.CLOSED),
        },
        agent(),
      );

      await expectRpc(refused, status.FAILED_PRECONDITION);
      // Nothing was touched on the way to refusing.
      expect(
        await fx.prisma.ticket.count({ where: { status: TicketStatus.OPEN } }),
      ).toBe(2);
    });
  });

  describe('9b. bulk priority change', () => {
    it('1. applies to every id and returns them', async () => {
      const ok = await Promise.all([
        createTicket(fx.prisma, tenant, { priority: TicketPriority.LOW }),
        createTicket(fx.prisma, tenant, { priority: TicketPriority.MEDIUM }),
      ]);

      const result = await tickets.bulkChangeTicketPriority(
        {
          ticketIds: ok.map((t) => t.id),
          priority: toProtoTicketPriority(TicketPriority.URGENT),
        },
        agent(),
      );

      expect([...result.updated].sort(compareAlphabetically)).toEqual(
        ok.map((t) => t.id).sort(compareAlphabetically),
      );
      expect(result.failed).toEqual([]);
      expect(
        await fx.prisma.ticket.count({
          where: { priority: TicketPriority.URGENT },
        }),
      ).toBe(2);
    });

    it('2. **a deleted ticket lands in failed[] and the rest still apply**', async () => {
      // Priority has no state machine, so every failure here is a ticket the
      // caller cannot see — which is the only failure mode this route has.
      const kept = await createTicket(fx.prisma, tenant, {
        priority: TicketPriority.LOW,
      });
      const gone = await createTicket(fx.prisma, tenant, {
        priority: TicketPriority.LOW,
        deletedAt: new Date(),
      });

      const result = await tickets.bulkChangeTicketPriority(
        {
          ticketIds: [kept.id, gone.id],
          priority: toProtoTicketPriority(TicketPriority.HIGH),
        },
        agent(),
      );

      expect(result.updated).toEqual([kept.id]);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].id).toBe(gone.id);
      expect(
        (await fx.prisma.ticket.findUniqueOrThrow({ where: { id: gone.id } }))
          .priority,
      ).toBe(TicketPriority.LOW);
    });

    it("3. another tenant's id lands in failed[], and its ticket is untouched", async () => {
      const other = buildTenant();
      const mine = await createTicket(fx.prisma, tenant, {
        priority: TicketPriority.LOW,
      });
      const theirs = await createTicket(fx.prisma, other, {
        priority: TicketPriority.LOW,
      });

      const result = await tickets.bulkChangeTicketPriority(
        {
          ticketIds: [mine.id, theirs.id],
          priority: toProtoTicketPriority(TicketPriority.URGENT),
        },
        agent(),
      );

      expect(result.updated).toEqual([mine.id]);
      expect(result.failed[0].id).toBe(theirs.id);
      expect(
        (await fx.prisma.ticket.findUniqueOrThrow({ where: { id: theirs.id } }))
          .priority,
      ).toBe(TicketPriority.LOW);
    });

    it('4. an oversized batch is refused before any write', async () => {
      // The cap is shared with `bulk/status` through `bulkIds`, and this is
      // what stops it being enforced on one route and not the other.
      const ids = Array.from({ length: 51 }, () => faker.string.uuid());

      await expectRpc(
        tickets.bulkChangeTicketPriority(
          {
            ticketIds: ids,
            priority: toProtoTicketPriority(TicketPriority.HIGH),
          },
          agent(),
        ),
        status.INVALID_ARGUMENT,
      );
    });

    it('5. an unset priority is refused rather than defaulted', async () => {
      // proto3's zero value is UNSPECIFIED, so an omitted field arrives as a
      // real value. Defaulting it would silently rewrite every ticket in the
      // batch to whatever the first enum member happens to be.
      const ticket = await createTicket(fx.prisma, tenant, {
        priority: TicketPriority.LOW,
      });

      await expectRpc(
        tickets.bulkChangeTicketPriority(
          { ticketIds: [ticket.id], priority: 0 },
          agent(),
        ),
        status.INVALID_ARGUMENT,
      );
      expect(
        (await fx.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } }))
          .priority,
      ).toBe(TicketPriority.LOW);
    });
  });

  describe('10. the status history', () => {
    it('1. records a row per transition, oldest first, with both ends', async () => {
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.NEW,
      });

      await tickets.changeTicketStatus(
        { id: ticket.id, status: toProtoTicketStatus(TicketStatus.OPEN) },
        agent(),
      );
      await tickets.escalateTicket({ ticketId: ticket.id }, agent());
      await tickets.resolveTicket({ ticketId: ticket.id }, agent());

      const { items } = await tickets.listTicketStatusChanges(
        { id: ticket.id },
        agent(),
      );

      expect(
        items.map((row) => [
          fromProtoTicketStatus(row.fromStatus),
          fromProtoTicketStatus(row.toStatus),
        ]),
      ).toEqual([
        [TicketStatus.NEW, TicketStatus.OPEN],
        [TicketStatus.OPEN, TicketStatus.ESCALATED],
        [TicketStatus.ESCALATED, TicketStatus.RESOLVED],
      ]);
      expect(items.every((row) => row.changedById === tenant.agentId)).toBe(
        true,
      );
    });

    it('2. **records the reason on RESOLVE and CLOSE, which the generic route cannot reach**', async () => {
      // The whole argument for widening the four convenience RPCs. Before it,
      // `reason` lived only on the generic route — which §0 then forbade from
      // reaching these two transitions, so the rows a history is most read to
      // explain were the rows that could never carry an explanation.
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
      });

      await tickets.resolveTicket(
        { ticketId: ticket.id, reason: 'Customer confirmed the fix' },
        agent(),
      );
      await tickets.closeTicket(
        { ticketId: ticket.id, reason: 'No reply for 14 days' },
        agent(),
      );

      const { items } = await tickets.listTicketStatusChanges(
        { id: ticket.id },
        agent(),
      );

      expect(items.map((row) => row.reason)).toEqual([
        'Customer confirmed the fix',
        'No reply for 14 days',
      ]);
    });

    it('3. a reason over the bound is refused HERE, not only at the DTO', async () => {
      // The service is reachable over gRPC where no `ValidationPipe` ever ran,
      // and the column is `Text` — nothing below this would refuse a megabyte.
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
      });

      await expectRpc(
        tickets.resolveTicket(
          {
            ticketId: ticket.id,
            reason: 'x'.repeat(MAX_STATUS_CHANGE_REASON_LENGTH + 1),
          },
          agent(),
        ),
        status.INVALID_ARGUMENT,
      );

      // And nothing was written on the way to refusing — neither the ticket
      // nor a history row.
      expect(
        (await fx.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } }))
          .status,
      ).toBe(TicketStatus.OPEN);
      expect(
        await fx.prisma.ticketStatusChange.count({
          where: { ticketId: ticket.id },
        }),
      ).toBe(0);
    });

    it('4. **a failed transition writes NO history row**', async () => {
      // Both writes are in one transaction, so an illegal move must leave the
      // path as clean as it leaves the status. A history that recorded attempts
      // would read as a ticket that bounced off a state it never entered.
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.NEW,
      });

      await expectRpc(
        tickets.escalateTicket({ ticketId: ticket.id }, agent()),
        status.ABORTED,
      ).catch(() => undefined);
      await tickets
        .changeTicketStatus(
          {
            id: ticket.id,
            status: toProtoTicketStatus(TicketStatus.PENDING_AGENT),
          },
          agent(),
        )
        .catch(() => undefined);

      expect(
        await fx.prisma.ticketStatusChange.count({
          where: { ticketId: ticket.id },
        }),
      ).toBe(1);
    });

    it('5. **an ACTORLESS caller cannot transition at all, so no row can be authorless**', async () => {
      // Why `changed_by_id` is NOT nullable. `transition` loads the ticket
      // through `tenantScope`, which refuses a caller with no `sub` — so the
      // "system moved it" row the column could have modelled has no way to be
      // written, and a nullable column would have described a state the code
      // cannot reach.
      //
      // A future auto-close sweep would enter somewhere other than
      // `transition`. This test is what should fail when it does.
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
      });

      await expectRpc(
        tickets.escalateTicket(
          { ticketId: ticket.id, reason: 'Auto-escalated at the cap' },
          systemContext(tenant.organizationId),
        ),
        status.UNAUTHENTICATED,
      );

      expect(
        await fx.prisma.ticketStatusChange.count({
          where: { ticketId: ticket.id },
        }),
      ).toBe(0);
    });

    it("**8. the AUTHOR sees every transition and NONE of the agents' reasons**", async () => {
      // The disclosure this column would otherwise be. `visibilityScope` makes
      // a ticket's author a reader of their own history, and the reason is
      // written by an agent for agents — the same need internal notes exist
      // for (ADR 0023), on a different table.
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
        authorId: tenant.userId,
      });

      await tickets.resolveTicket(
        {
          ticketId: ticket.id,
          reason: 'Duplicate of #4127 — flagging this account for review',
        },
        agent(),
      );

      const asAuthor = await tickets.listTicketStatusChanges(
        { id: ticket.id },
        member(),
      );
      const asAgent = await tickets.listTicketStatusChanges(
        { id: ticket.id },
        agent(),
      );

      // The TRANSITION is not hidden — only the note attached to it. A history
      // missing the row would be a different and worse answer.
      expect(asAuthor.items).toHaveLength(1);
      expect(fromProtoTicketStatus(asAuthor.items[0].toStatus)).toBe(
        TicketStatus.RESOLVED,
      );
      expect(asAuthor.items[0].reason).toBeUndefined();

      expect(asAgent.items[0].reason).toBe(
        'Duplicate of #4127 — flagging this account for review',
      );
    });

    it('**9. but they keep the reasons they wrote themselves**', async () => {
      // `/escalate` is the one transition an END_USER can reach, and reading
      // back their own words is not a disclosure. Without this carve-out a
      // customer would escalate with a description and never see it again.
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
        authorId: tenant.userId,
      });

      await tickets.escalateTicket(
        { ticketId: ticket.id, reason: 'The app crashes when I click save' },
        member(),
      );
      await tickets.resolveTicket(
        { ticketId: ticket.id, reason: 'Known issue, tracked internally' },
        agent(),
      );

      const { items } = await tickets.listTicketStatusChanges(
        { id: ticket.id },
        member(),
      );

      expect(items.map((row) => row.reason)).toEqual([
        'The app crashes when I click save',
        undefined,
      ]);
    });

    it('**10. an agent scoped by ticket.message.moderate alone still reads them**', async () => {
      // "Agent" is queue access, and the predicate is shared with internal
      // notes rather than re-derived — two definitions would be two things to
      // keep in step.
      //
      // Assigned to them, because `isAgent` and `visibilityScope` are NOT the
      // same question: `ticket.message.moderate` makes you an agent for the
      // purpose of reading notes, and does not by itself let you reach a ticket
      // you neither raised nor hold. So this caller sees one ticket and reads
      // the reasons on it.
      // A DIFFERENT person from the one who wrote the reason, or the own-reason
      // carve-out would carry this test and it would pass with `isAgent`
      // narrowed to `ticket.read.all` — which is exactly what it exists to
      // catch.
      const moderatorId = faker.string.uuid();
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
        authorId: tenant.userId,
        currentAssigneeId: moderatorId,
      });
      await tickets.resolveTicket(
        { ticketId: ticket.id, reason: 'Internal justification' },
        agent(),
      );

      const { items } = await tickets.listTicketStatusChanges(
        { id: ticket.id },
        memberContext(
          { id: moderatorId, organizationId: tenant.organizationId },
          ['ticket.message.moderate'],
        ),
      );

      expect(items[0].changedById).not.toBe(moderatorId);
      expect(items[0].reason).toBe('Internal justification');
    });

    it('6. is NOT_FOUND across the tenant boundary', async () => {
      // Scoped by the same `load` the ticket read uses, which is what makes
      // this a ticket sub-resource rather than a second way into a log.
      const other = buildTenant();
      const theirs = await createTicket(fx.prisma, other, {
        status: TicketStatus.OPEN,
      });
      await tickets.escalateTicket(
        { ticketId: theirs.id },
        memberContext(
          { id: other.agentId, organizationId: other.organizationId },
          ['ticket.read.all', 'ticket.update'],
        ),
      );

      await expectRpc(
        tickets.listTicketStatusChanges({ id: theirs.id }, agent()),
        status.NOT_FOUND,
      );
    });

    it('7. **carries no reassignments — those have their own history**', async () => {
      // The split doc 47 §1 draws. `ticket_assignments` is richer than this
      // shape could be, and merging them would be one list with two meanings.
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
      });
      await tickets.escalateTicket({ ticketId: ticket.id }, agent());

      const { items } = await tickets.listTicketStatusChanges(
        { id: ticket.id },
        agent(),
      );

      expect(items).toHaveLength(1);
      expect(Object.keys(items[0]).sort(compareAlphabetically)).toEqual(
        [
          'changedAt',
          'changedById',
          'fromStatus',
          'id',
          'reason',
          'ticketId',
          'toStatus',
        ].sort(compareAlphabetically),
      );
    });
  });

  describe('11. the read cursor and the unread count', () => {
    /**
     * A ticket the member authored, with `count` replies from a THIRD party.
     *
     * Not from `tenant.agentId`: own messages never count, so an agent reading
     * their own replies back would see zero and every assertion below would
     * pass for the wrong reason.
     */
    const senderId = faker.string.uuid();
    const seedThread = async (count: number, overrides = {}) => {
      const ticket = await createTicket(fx.prisma, tenant, {
        authorId: tenant.userId,
      });
      for (let index = 0; index < count; index += 1) {
        await createMessage(fx.prisma, ticket.id, {
          senderId,
          content: `Reply ${index}`,
          ...overrides,
        });
      }
      return ticket;
    };

    const listFor = async (context = member()) => {
      const { items } = await tickets.listTickets(
        { page: pageRequest(), includeDeleted: false } as never,
        context,
      );
      return new Map(items.map((item) => [item.id, item.unreadCount]));
    };

    it('1. **a ticket never opened counts EVERYTHING, not zero**', async () => {
      // The arm that decides whether a badge works at all. No read-state row
      // means "read nothing", and treating it as "read everything" makes every
      // untouched ticket look caught-up.
      const ticket = await seedThread(3);

      expect((await listFor()).get(ticket.id)).toBe(3);
    });

    it('2. marking read clears it, and a later message brings it back', async () => {
      const ticket = await seedThread(2);

      await tickets.markTicketRead({ ticketId: ticket.id }, member());
      expect((await listFor()).get(ticket.id)).toBe(0);

      await createMessage(fx.prisma, ticket.id, {
        senderId,
        content: 'One more',
      });
      expect((await listFor()).get(ticket.id)).toBe(1);
    });

    it("3. **the caller's OWN messages never count**", async () => {
      // Or sending a message would make your own ticket unread.
      const ticket = await createTicket(fx.prisma, tenant, {
        authorId: tenant.userId,
      });
      await createMessage(fx.prisma, ticket.id, {
        senderId: tenant.userId,
        content: 'Mine',
      });

      expect((await listFor()).get(ticket.id)).toBe(0);
    });

    it('4. **internal notes do not count for a non-agent, and do for an agent**', async () => {
      // A badge counting notes the caller cannot open is an unread count they
      // can never clear. Same fragment as the thread read, not a second copy.
      const ticket = await seedThread(1, { isInternalNote: true });

      expect((await listFor(member())).get(ticket.id)).toBe(0);
      expect((await listFor(agent())).get(ticket.id)).toBe(1);
    });

    it('**4b. a REDACTED message does not count**', async () => {
      // The asymmetry that decides it: `redactedAt` leaves `createdAt` alone,
      // so a message redacted after someone read it stays under their watermark
      // forever. The badge could only ever rise for one redacted BEFORE it was
      // read — the exact case where the redaction was protecting that reader.
      const ticket = await seedThread(2);
      const [first] = await fx.prisma.ticketMessage.findMany({
        where: { ticketId: ticket.id },
        orderBy: { createdAt: 'asc' },
      });
      await fx.prisma.ticketMessage.update({
        where: { id: first.id },
        data: { redactedAt: new Date(), redactedById: tenant.agentId },
      });

      expect((await listFor()).get(ticket.id)).toBe(1);
    });

    it('4c. and redacting the ONLY unread message clears the badge', async () => {
      // The whole-badge version, so 4b cannot pass on an off-by-one.
      const ticket = await seedThread(1);
      const [only] = await fx.prisma.ticketMessage.findMany({
        where: { ticketId: ticket.id },
      });

      expect((await listFor()).get(ticket.id)).toBe(1);

      await fx.prisma.ticketMessage.update({
        where: { id: only.id },
        data: { redactedAt: new Date(), redactedById: tenant.agentId },
      });

      expect((await listFor()).get(ticket.id) ?? 0).toBe(0);
    });

    it('5. **the CLIENT names the point, so a message that arrived mid-render stays unread**', async () => {
      // The `now()` race, which is why this takes a body. The client renders
      // two messages, a third lands, and the mark-read must not clear it.
      const ticket = await seedThread(2);
      const rendered = await fx.prisma.ticketMessage.findFirstOrThrow({
        where: { ticketId: ticket.id },
        orderBy: { createdAt: 'desc' },
      });

      await createMessage(fx.prisma, ticket.id, {
        senderId,
        content: 'Arrived while you were reading',
      });

      await tickets.markTicketRead(
        { ticketId: ticket.id, readAt: toProtoTimestamp(rendered.createdAt) },
        member(),
      );

      expect((await listFor()).get(ticket.id)).toBe(1);
    });

    it('6. and stamping NOW would have cleared it — the difference, asserted', async () => {
      // The other half of test 5: without a client stamp the message is gone
      // from the badge, and this is what that looks like.
      const ticket = await seedThread(2);
      await createMessage(fx.prisma, ticket.id, {
        senderId,
        content: 'Arrived while you were reading',
      });

      await tickets.markTicketRead({ ticketId: ticket.id }, member());

      expect((await listFor()).get(ticket.id)).toBe(0);
    });

    it('7. **a client clock running fast is CLAMPED to the server**', async () => {
      // Otherwise one skewed client marks messages read before they are
      // written, and its badge stays at zero through a whole conversation.
      const ticket = await seedThread(1);
      const future = new Date(Date.now() + 60 * 60 * 1000);

      const result = await tickets.markTicketRead(
        { ticketId: ticket.id, readAt: toProtoTimestamp(future) },
        member(),
      );

      const stored = fromProtoTimestamp(result.lastReadAt)!;
      expect(stored.getTime()).toBeLessThan(future.getTime());

      await createMessage(fx.prisma, ticket.id, {
        senderId,
        content: 'After the fake future',
      });
      expect((await listFor()).get(ticket.id)).toBe(1);
    });

    it('**7b. an OLDER stamp is declined — the write is monotonic**', async () => {
      // Last-write-wins does not need two tabs to go wrong: a thread view that
      // fires this on render has two requests in flight whenever a message
      // lands mid-render, and if they reorder the earlier stamp wins and the
      // badge reappears. `GREATEST` in the ON CONFLICT is what refuses it.
      const ticket = await seedThread(2);
      const [older, newer] = await fx.prisma.ticketMessage.findMany({
        where: { ticketId: ticket.id },
        orderBy: { createdAt: 'asc' },
      });

      await tickets.markTicketRead(
        { ticketId: ticket.id, readAt: toProtoTimestamp(newer.createdAt) },
        member(),
      );
      expect((await listFor()).get(ticket.id) ?? 0).toBe(0);

      // The late-arriving earlier render.
      const result = await tickets.markTicketRead(
        { ticketId: ticket.id, readAt: toProtoTimestamp(older.createdAt) },
        member(),
      );

      // The badge does NOT come back...
      expect((await listFor()).get(ticket.id) ?? 0).toBe(0);
      // ...and the response reports what is STORED, not what was claimed —
      // which is the whole reason it uses RETURNING.
      expect(fromProtoTimestamp(result.lastReadAt)!.getTime()).toBe(
        newer.createdAt.getTime(),
      );
    });

    it('8. is scoped per USER — one reader clearing does not clear the other', async () => {
      const ticket = await seedThread(2);

      await tickets.markTicketRead({ ticketId: ticket.id }, member());

      expect((await listFor(member())).get(ticket.id)).toBe(0);
      expect((await listFor(agent())).get(ticket.id)).toBe(2);
    });

    it('9. is NOT_FOUND for a ticket the caller cannot see', async () => {
      const other = buildTenant();
      const theirs = await createTicket(fx.prisma, other);

      await expectRpc(
        tickets.markTicketRead({ ticketId: theirs.id }, member()),
        status.NOT_FOUND,
      );
      expect(await fx.prisma.ticketReadState.count()).toBe(0);
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
   * The batch contract.
   *
   * The property specific to THIS service: `visibilityScope` applies to a batch
   * read exactly as it does to the list. A batch RPC that skipped it would be a
   * way to fetch any ticket in the tenant one id at a time — which is precisely
   * what "it is just a simple `WHERE id IN (…)`" makes easy to miss.
   */
  describe('ListTicketsByIds — the batch contract', () => {
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
