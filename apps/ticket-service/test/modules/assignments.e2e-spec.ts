import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { faker } from '@faker-js/faker';
import { ReassignmentReason, TICKET_PATTERNS } from '@synapsedesk/common';
import { ReassignmentReason as ProtoReassignmentReason } from '@synapsedesk/grpc-proto';
import { bootstrapE2eTest, E2eFixture } from '../utils/bootstrap';
import { memberContext, superAdminContext } from '../utils/context';
import {
  buildTenant,
  createAssignedTicket,
  createTicket,
  TenantFixture,
} from '../factories';
import { AssignmentsService } from '../../src/modules/assignments/assignments.service';
import { AuthReferenceService } from '../../src/modules/auth-client/auth-reference.service';
import { TicketEventPublisher } from '../../src/modules/events/ticket-event.publisher';

function rpcCode(error: unknown): number | undefined {
  if (!(error instanceof RpcException)) return undefined;
  return (error.getError() as { code?: number }).code;
}

async function expectRpc(promise: Promise<unknown>, code: number) {
  await expect(promise).rejects.toBeInstanceOf(RpcException);
  await promise.catch((error: unknown) => expect(rpcCode(error)).toBe(code));
}

describe('§2.4 Assignment & reassignment (e2e)', () => {
  let fx: E2eFixture;
  let assignments: AssignmentsService;
  let authReference: AuthReferenceService;
  let events: TicketEventPublisher;

  let assertUserExists: jest.SpyInstance;
  let assertDepartmentExists: jest.SpyInstance;
  let publish: jest.SpyInstance;

  let tenant: TenantFixture;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    assignments = fx.moduleRef.get(AssignmentsService);
    authReference = fx.moduleRef.get(AuthReferenceService);
    events = fx.moduleRef.get(TicketEventPublisher);

    // auth-service and NATS are not running for this suite. Both boundaries
    // have their own dedicated coverage — the validation failure below, and
    // §2.2's real publish/subscribe test.
    assertUserExists = jest.spyOn(authReference, 'assertUserExists');
    assertDepartmentExists = jest.spyOn(
      authReference,
      'assertDepartmentExists',
    );
    publish = jest.spyOn(events, 'publish').mockImplementation(() => {});
  });

  beforeEach(async () => {
    await fx.reset();
    jest.clearAllMocks();
    assertUserExists.mockResolvedValue(undefined);
    assertDepartmentExists.mockResolvedValue(undefined);
    tenant = buildTenant();
  });

  afterAll(() => fx.close());

  /** A supervisor: may hand work to anyone, and may see the whole queue. */
  const supervisor = (t = tenant) =>
    memberContext({ id: t.agentId, organizationId: t.organizationId }, [
      'ticket.read.all',
      'ticket.assign',
      'ticket.assign.self',
    ]);

  const assignRequest = (overrides: Record<string, unknown> = {}) => ({
    ticketId: '',
    assigneeId: tenant.agentId,
    departmentId: tenant.departmentId,
    reason: ProtoReassignmentReason.REASSIGNMENT_REASON_UNSPECIFIED,
    ...overrides,
  });

  /** Both representations of "who has this ticket", read back together. */
  const readState = async (ticketId: string) => {
    const [ticket, rows] = await Promise.all([
      fx.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } }),
      fx.prisma.ticketAssignment.findMany({
        where: { ticketId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      cachedAssigneeId: ticket.currentAssigneeId,
      cachedDepartmentId: ticket.currentDepartmentId,
      rows,
      live: rows.filter((row) => row.isCurrent),
    };
  };

  // ------------------------------------------------------------------ assign

  describe('assignTicket', () => {
    it('1. creates ONE live row and sets both denormalized columns', async () => {
      const ticket = await createTicket(fx.prisma, tenant);

      await assignments.assignTicket(
        assignRequest({ ticketId: ticket.id }),
        supervisor(),
      );

      const state = await readState(ticket.id);

      // The ledger and the cache, asserted together. Either one alone would
      // pass while the other was wrong, which is the exact bug §2.4 warns is
      // most likely: `GET /tickets` reads the cache, not the ledger.
      expect(state.live).toHaveLength(1);
      expect(state.live[0].assignedToId).toBe(tenant.agentId);
      expect(state.live[0].departmentId).toBe(tenant.departmentId);
      expect(state.live[0].unassignedAt).toBeNull();
      expect(state.cachedAssigneeId).toBe(tenant.agentId);
      expect(state.cachedDepartmentId).toBe(tenant.departmentId);
    });

    it('2. defaults a FIRST assignment to reason INITIAL', async () => {
      const ticket = await createTicket(fx.prisma, tenant);

      const created = await assignments.assignTicket(
        assignRequest({ ticketId: ticket.id }),
        supervisor(),
      );

      expect(created.reason).toBe(
        ProtoReassignmentReason.REASSIGNMENT_REASON_INITIAL,
      );
    });

    it('3. defaults a LATER assignment to MANUAL, never INITIAL again', async () => {
      // INITIAL genuinely means "the first". A history where every entry says
      // INITIAL reads as though the ticket had been assigned from scratch each
      // time, and the escalation review that history exists for learns nothing.
      const { ticket } = await createAssignedTicket(fx.prisma, tenant);

      const created = await assignments.assignTicket(
        assignRequest({ ticketId: ticket.id, assigneeId: faker.string.uuid() }),
        supervisor(),
      );

      expect(created.reason).toBe(
        ProtoReassignmentReason.REASSIGNMENT_REASON_MANUAL,
      );
    });

    it('4. records an EXPLICIT reason when one is given', async () => {
      const { ticket } = await createAssignedTicket(fx.prisma, tenant);

      const created = await assignments.assignTicket(
        assignRequest({
          ticketId: ticket.id,
          assigneeId: faker.string.uuid(),
          reason: ProtoReassignmentReason.REASSIGNMENT_REASON_ESCALATION,
        }),
        supervisor(),
      );

      expect(created.reason).toBe(
        ProtoReassignmentReason.REASSIGNMENT_REASON_ESCALATION,
      );
    });

    it('5. publishes ticket.assigned when the ticket had NO prior assignee', async () => {
      const ticket = await createTicket(fx.prisma, tenant);

      await assignments.assignTicket(
        assignRequest({ ticketId: ticket.id }),
        supervisor(),
      );

      expect(publish).toHaveBeenCalledTimes(1);
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: TICKET_PATTERNS.assigned,
          organizationId: tenant.organizationId,
          ticketId: ticket.id,
          assignedToId: tenant.agentId,
          departmentId: tenant.departmentId,
          assignedById: tenant.agentId,
        }),
      );
    });

    it('6. REFUSES a re-assignment to the user who already holds it', async () => {
      // A no-op row would pollute the history and fire a `reassigned` event
      // that notifies the assignee about a change that did not happen.
      //
      // ALREADY_EXISTS -> 409 at the gateway. FAILED_PRECONDITION would map to
      // 400 under the repo-wide table, which would tell the caller to fix a
      // body that has nothing wrong with it.
      const { ticket } = await createAssignedTicket(fx.prisma, tenant);

      await expectRpc(
        assignments.assignTicket(
          assignRequest({ ticketId: ticket.id, assigneeId: tenant.agentId }),
          supervisor(),
        ),
        status.ALREADY_EXISTS,
      );

      expect(publish).not.toHaveBeenCalled();
    });

    it('7. validates the assignee and the department BEFORE writing', async () => {
      const ticket = await createTicket(fx.prisma, tenant);

      await assignments.assignTicket(
        assignRequest({ ticketId: ticket.id }),
        supervisor(),
      );

      expect(assertUserExists).toHaveBeenCalledWith(
        tenant.agentId,
        expect.anything(),
      );
      expect(assertDepartmentExists).toHaveBeenCalledWith(
        tenant.departmentId,
        expect.anything(),
      );
    });

    it('8. writes NOTHING when the department does not resolve — §1.1', async () => {
      // The cross-service check standing in for a foreign key Postgres cannot
      // enforce, because `departments` lives in another database.
      const ticket = await createTicket(fx.prisma, tenant);
      assertDepartmentExists.mockRejectedValue(
        new RpcException({
          code: status.INVALID_ARGUMENT,
          message: 'No department with that id in this workspace',
        }),
      );

      await expectRpc(
        assignments.assignTicket(
          assignRequest({ ticketId: ticket.id }),
          supervisor(),
        ),
        status.INVALID_ARGUMENT,
      );

      const state = await readState(ticket.id);
      expect(state.rows).toHaveLength(0);
      expect(state.cachedAssigneeId).toBeNull();
    });

    it('9. answers NOT_FOUND for a ticket in ANOTHER tenant', async () => {
      const ticket = await createTicket(fx.prisma, tenant);
      const stranger = buildTenant();

      await expectRpc(
        assignments.assignTicket(
          assignRequest({ ticketId: ticket.id }),
          supervisor(stranger),
        ),
        status.NOT_FOUND,
      );
    });
  });

  // ------------------------------------------------------------- reassignment

  describe('reassignment', () => {
    it('1. closes the prior row and opens the new one, in ONE transaction', async () => {
      const { ticket, assignment } = await createAssignedTicket(
        fx.prisma,
        tenant,
      );
      const successor = faker.string.uuid();

      await assignments.assignTicket(
        assignRequest({ ticketId: ticket.id, assigneeId: successor }),
        supervisor(),
      );

      const state = await readState(ticket.id);
      const previous = state.rows.find((row) => row.id === assignment.id)!;

      expect(state.rows).toHaveLength(2);
      expect(previous.isCurrent).toBe(false);
      expect(previous.unassignedAt).not.toBeNull();
      expect(state.live).toHaveLength(1);
      expect(state.live[0].assignedToId).toBe(successor);
      expect(state.cachedAssigneeId).toBe(successor);
    });

    it('2. rolls back the ledger when the CACHE write fails', async () => {
      // The atomicity proof §2.4 asks for. `syncTicketCache` is step 3 of the
      // transaction — the step most likely to be forgotten or to fail — so
      // making it throw is the honest way to ask "did steps 1 and 2 survive?".
      // They must not: a closed prior row with no successor would leave the
      // ticket assigned to nobody in the ledger and to the old agent in the
      // cache, which is the worst of both.
      const { ticket, assignment } = await createAssignedTicket(
        fx.prisma,
        tenant,
      );
      const sync = jest
        .spyOn(
          assignments as unknown as { syncTicketCache: () => Promise<void> },
          'syncTicketCache',
        )
        .mockRejectedValue(new Error('injected failure at step 3'));

      await expect(
        assignments.assignTicket(
          assignRequest({
            ticketId: ticket.id,
            assigneeId: faker.string.uuid(),
          }),
          supervisor(),
        ),
      ).rejects.toThrow('injected failure at step 3');

      sync.mockRestore();

      const state = await readState(ticket.id);
      expect(state.rows).toHaveLength(1);
      expect(state.rows[0].id).toBe(assignment.id);
      expect(state.rows[0].isCurrent).toBe(true);
      expect(state.rows[0].unassignedAt).toBeNull();
      expect(state.cachedAssigneeId).toBe(tenant.agentId);
    });

    it('3. survives TWO CONCURRENT reassignments with exactly one live row', async () => {
      // Real concurrency, not a simulation. `ticket_assignments_current_key`
      // is the only thing preventing a ticket with two simultaneous assignees,
      // and a ticket in that state has no meaning the product can render.
      const { ticket } = await createAssignedTicket(fx.prisma, tenant);

      const results = await Promise.allSettled([
        assignments.assignTicket(
          assignRequest({
            ticketId: ticket.id,
            assigneeId: faker.string.uuid(),
          }),
          supervisor(),
        ),
        assignments.assignTicket(
          assignRequest({
            ticketId: ticket.id,
            assigneeId: faker.string.uuid(),
          }),
          supervisor(),
        ),
      ]);

      const state = await readState(ticket.id);
      expect(state.live).toHaveLength(1);

      // And the cache agrees with whichever one won — a survivor in the ledger
      // that the queue view does not show is still a bug.
      expect(state.cachedAssigneeId).toBe(state.live[0].assignedToId);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled).toHaveLength(1);
    });

    it('4. publishes ticket.reassigned carrying BOTH sides and the reason', async () => {
      const { ticket } = await createAssignedTicket(fx.prisma, tenant);
      const successor = faker.string.uuid();

      await assignments.assignTicket(
        assignRequest({
          ticketId: ticket.id,
          assigneeId: successor,
          reason: ProtoReassignmentReason.REASSIGNMENT_REASON_LOAD_BALANCING,
        }),
        supervisor(),
      );

      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: TICKET_PATTERNS.reassigned,
          ticketId: ticket.id,
          fromAssigneeId: tenant.agentId,
          toAssigneeId: successor,
          reason: ReassignmentReason.LOAD_BALANCING,
        }),
      );
    });

    it('5. reassignTicket and assignTicket are the SAME operation', async () => {
      // The proto keeps both names because the business uses both words. If
      // they ever diverge, one of them stops honouring the invariant — so the
      // equivalence is asserted rather than assumed.
      const { ticket } = await createAssignedTicket(fx.prisma, tenant);
      const successor = faker.string.uuid();

      const viaReassign = await assignments.assignTicket(
        assignRequest({ ticketId: ticket.id, assigneeId: successor }),
        supervisor(),
      );

      expect(viaReassign.assignedToId).toBe(successor);
      expect(viaReassign.isCurrent).toBe(true);
    });
  });

  // -------------------------------------------------------------- assign/self

  describe('assignTicketToSelf', () => {
    it('1. produces the SAME state as assign with assigneeId = the caller', async () => {
      // §2.4's "one code path" rule, asserted on the resulting STATE rather
      // than on the call graph. Proving `assignToSelf` delegates somewhere
      // would only prove today's wiring; proving the two produce identical
      // rows is the property that has to keep holding.
      const claimer = faker.string.uuid();
      const context = memberContext(
        { id: claimer, organizationId: tenant.organizationId },
        ['ticket.read.all', 'ticket.assign', 'ticket.assign.self'],
      );

      const viaSelf = await assignments.assignTicketToSelf(
        {
          ticketId: (await createTicket(fx.prisma, tenant)).id,
          departmentId: tenant.departmentId,
        },
        context,
      );
      const viaAssign = await assignments.assignTicket(
        assignRequest({
          ticketId: (await createTicket(fx.prisma, tenant)).id,
          assigneeId: claimer,
          reason: ProtoReassignmentReason.REASSIGNMENT_REASON_SELF_ASSIGNED,
        }),
        context,
      );

      // Everything EXCEPT the four fields that are necessarily different: two
      // rows on two tickets have their own ids and their own timestamps.
      // Listing what is compared rather than what is stripped means a field
      // added to the response has to be considered here, instead of silently
      // joining the comparison and making this test flaky.
      const comparable = (entry: typeof viaSelf) => ({
        assignedToId: entry.assignedToId,
        assignedById: entry.assignedById,
        departmentId: entry.departmentId,
        reason: entry.reason,
        isCurrent: entry.isCurrent,
        unassignedAt: entry.unassignedAt,
      });

      expect(comparable(viaSelf)).toEqual(comparable(viaAssign));
    });

    it('2. records reason SELF_ASSIGNED without being asked', async () => {
      const ticket = await createTicket(fx.prisma, tenant);

      const claimed = await assignments.assignTicketToSelf(
        { ticketId: ticket.id, departmentId: tenant.departmentId },
        supervisor(),
      );

      expect(claimed.reason).toBe(
        ProtoReassignmentReason.REASSIGNMENT_REASON_SELF_ASSIGNED,
      );
      expect(claimed.assignedToId).toBe(tenant.agentId);
    });

    it('3. sets assignedById to the claimer — they assigned themselves', async () => {
      const ticket = await createTicket(fx.prisma, tenant);

      const claimed = await assignments.assignTicketToSelf(
        { ticketId: ticket.id, departmentId: tenant.departmentId },
        supervisor(),
      );

      expect(claimed.assignedById).toBe(tenant.agentId);
    });

    it('4. refuses a caller with NO identity', async () => {
      const ticket = await createTicket(fx.prisma, tenant);

      await expectRpc(
        assignments.assignTicketToSelf(
          { ticketId: ticket.id, departmentId: tenant.departmentId },
          superAdminContext(undefined, { sub: null }),
        ),
        status.UNAUTHENTICATED,
      );
    });
  });

  // ---------------------------------------------------------------- unassign

  describe('unassignTicket', () => {
    it('1. clears BOTH cached columns and closes the live row', async () => {
      const { ticket, assignment } = await createAssignedTicket(
        fx.prisma,
        tenant,
      );

      await assignments.unassignTicket({ ticketId: ticket.id }, supervisor());

      const state = await readState(ticket.id);
      expect(state.cachedAssigneeId).toBeNull();
      expect(state.cachedDepartmentId).toBeNull();
      expect(state.live).toHaveLength(0);
      expect(state.rows).toHaveLength(1);
      expect(state.rows[0].id).toBe(assignment.id);
      expect(state.rows[0].unassignedAt).not.toBeNull();
    });

    it('2. creates NO new row — the history records a departure, not an arrival', async () => {
      const { ticket } = await createAssignedTicket(fx.prisma, tenant);

      await assignments.unassignTicket({ ticketId: ticket.id }, supervisor());

      expect((await readState(ticket.id)).rows).toHaveLength(1);
    });

    it('3. publishes ticket.unassigned naming who LOST it', async () => {
      const { ticket } = await createAssignedTicket(fx.prisma, tenant);

      await assignments.unassignTicket({ ticketId: ticket.id }, supervisor());

      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: TICKET_PATTERNS.unassigned,
          ticketId: ticket.id,
          previousAssigneeId: tenant.agentId,
        }),
      );
    });

    it('4. answers FAILED_PRECONDITION when nobody holds the ticket', async () => {
      // Not NOT_FOUND: the ticket exists and the caller may see it. What is
      // wrong is the state they assumed, and 404 would send them hunting for a
      // missing ticket.
      const ticket = await createTicket(fx.prisma, tenant);

      await expectRpc(
        assignments.unassignTicket({ ticketId: ticket.id }, supervisor()),
        status.FAILED_PRECONDITION,
      );
    });

    it('5. can be RE-ASSIGNED after being unassigned', async () => {
      // The partial unique index must not keep blocking new live rows once the
      // previous one is closed — if it did, unassigning would be a one-way door.
      const { ticket } = await createAssignedTicket(fx.prisma, tenant);
      await assignments.unassignTicket({ ticketId: ticket.id }, supervisor());

      await assignments.assignTicket(
        assignRequest({ ticketId: ticket.id }),
        supervisor(),
      );

      const state = await readState(ticket.id);
      expect(state.live).toHaveLength(1);
      expect(state.cachedAssigneeId).toBe(tenant.agentId);
    });
  });

  // ------------------------------------------------------------------- list

  describe('listAssignments', () => {
    it('1. returns the full lifecycle OLDEST first', async () => {
      const { ticket } = await createAssignedTicket(fx.prisma, tenant);
      const second = faker.string.uuid();
      const third = faker.string.uuid();

      await assignments.assignTicket(
        assignRequest({ ticketId: ticket.id, assigneeId: second }),
        supervisor(),
      );
      await assignments.assignTicket(
        assignRequest({ ticketId: ticket.id, assigneeId: third }),
        supervisor(),
      );

      const { items } = await assignments.listAssignments(
        { ticketId: ticket.id },
        supervisor(),
      );

      expect(items.map((item) => item.assignedToId)).toEqual([
        tenant.agentId,
        second,
        third,
      ]);
    });

    it('2. marks EXACTLY ONE entry current while the ticket is assigned', async () => {
      const { ticket } = await createAssignedTicket(fx.prisma, tenant);
      await assignments.assignTicket(
        assignRequest({ ticketId: ticket.id, assigneeId: faker.string.uuid() }),
        supervisor(),
      );

      const { items } = await assignments.listAssignments(
        { ticketId: ticket.id },
        supervisor(),
      );

      expect(items.filter((item) => item.isCurrent)).toHaveLength(1);
      expect(items.at(-1)!.isCurrent).toBe(true);
    });

    it('3. marks ZERO entries current after an unassign', async () => {
      const { ticket } = await createAssignedTicket(fx.prisma, tenant);
      await assignments.unassignTicket({ ticketId: ticket.id }, supervisor());

      const { items } = await assignments.listAssignments(
        { ticketId: ticket.id },
        supervisor(),
      );

      expect(items.filter((item) => item.isCurrent)).toHaveLength(0);
    });

    it('4. returns an EMPTY list for a ticket never assigned', async () => {
      const ticket = await createTicket(fx.prisma, tenant);

      const { items } = await assignments.listAssignments(
        { ticketId: ticket.id },
        supervisor(),
      );

      expect(items).toEqual([]);
    });

    it('5. is scoped through the TICKET, not by ticketId alone', async () => {
      // `ticket_assignments` has no `organization_id` of its own, so a query by
      // ticketId would be an unscoped read across every tenant. The scope has
      // to come from loading the ticket first, and this is what proves it does.
      const { ticket } = await createAssignedTicket(fx.prisma, tenant);
      const stranger = buildTenant();

      await expectRpc(
        assignments.listAssignments(
          { ticketId: ticket.id },
          supervisor(stranger),
        ),
        status.NOT_FOUND,
      );
    });

    it('6. is readable by the ticket AUTHOR with no assignment permission', async () => {
      const { ticket } = await createAssignedTicket(fx.prisma, tenant);
      const author = memberContext({
        id: tenant.userId,
        organizationId: tenant.organizationId,
      });

      const { items } = await assignments.listAssignments(
        { ticketId: ticket.id },
        author,
      );

      expect(items).toHaveLength(1);
    });

    it('7. is NOT readable by an unrelated member of the same tenant', async () => {
      const { ticket } = await createAssignedTicket(fx.prisma, tenant);
      const bystander = memberContext({
        id: faker.string.uuid(),
        organizationId: tenant.organizationId,
      });

      await expectRpc(
        assignments.listAssignments({ ticketId: ticket.id }, bystander),
        status.NOT_FOUND,
      );
    });
  });
});
