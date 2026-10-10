import { of, throwError } from 'rxjs';
import { faker } from '@faker-js/faker';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { ReassignmentReason } from '@synapsedesk/common';
import { ReassignmentReason as ProtoReassignmentReason } from '@synapsedesk/grpc-proto';
import {
  API,
  E2eFixture,
  anonymousAgent,
  authenticatedAgent,
  bootstrapE2eTest,
  flushTestRedis,
} from '../utils';
import { grpcError, timestamp, wireAssignment } from '../fixtures/wire';

/**
 * Assignment at the HTTP boundary.
 *
 * ticket-service is stubbed: the one-transaction invariant, the partial unique
 * index and the ledger/cache agreement all have their own suite against a real
 * database. What is under test here is what only exists at this layer — the two
 * DIFFERENT permissions, the route shapes, and the reason enum in both
 * directions.
 */
describe('Assignment at the HTTP boundary (e2e)', () => {
  let fx: E2eFixture;

  const ticketId = faker.string.uuid();
  const assigneeId = faker.string.uuid();
  const departmentId = faker.string.uuid();

  beforeAll(async () => {
    await flushTestRedis();
    fx = await bootstrapE2eTest();
  });

  beforeEach(async () => {
    await flushTestRedis();
    jest.clearAllMocks();
  });

  afterAll(() => fx.close());

  const body = { assigneeId, departmentId };

  describe('POST /tickets/:id/assign', () => {
    it('1. assigns and returns the mapped entry', async () => {
      fx.stubs.assignment.assignTicket.mockReturnValue(
        of(wireAssignment({ ticketId, assignedToId: assigneeId })),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.assign'],
      })
        .post(`${API}/tickets/${ticketId}/assign`)
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body.data.assignedToId).toBe(assigneeId);
      expect(res.body.data.isCurrent).toBe(true);
    });

    it('2. requires ticket.assign — read access is not enough', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.read.all', 'ticket.update'],
      })
        .post(`${API}/tickets/${ticketId}/assign`)
        .send(body);

      expect(res.status).toBe(403);
      expect(fx.stubs.assignment.assignTicket).not.toHaveBeenCalled();
    });

    it('3. rejects a NON-UUID assigneeId before calling the service', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.assign'],
      })
        .post(`${API}/tickets/${ticketId}/assign`)
        .send({ assigneeId: 'not-a-uuid', departmentId });

      expect(res.status).toBe(400);
      expect(fx.stubs.assignment.assignTicket).not.toHaveBeenCalled();
    });

    it('4. requires a departmentId — it is NOT inferred from the assignee', async () => {
      // Inferring it would put the ticket wherever that agent happens to sit,
      // which is wrong the moment somebody belongs to two teams.
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.assign'],
      })
        .post(`${API}/tickets/${ticketId}/assign`)
        .send({ assigneeId });

      expect(res.status).toBe(400);
    });

    it('5. forwards the reason as a proto ENUM, not as its string', async () => {
      fx.stubs.assignment.assignTicket.mockReturnValue(of(wireAssignment()));

      await authenticatedAgent(fx.app, { permissionCodes: ['ticket.assign'] })
        .post(`${API}/tickets/${ticketId}/assign`)
        .send({ ...body, reason: ReassignmentReason.ESCALATION });

      const [request] = fx.stubs.assignment.assignTicket.mock.calls[0];
      expect(request.reason).toBe(
        ProtoReassignmentReason.REASSIGNMENT_REASON_ESCALATION,
      );
    });

    it('6. sends UNSPECIFIED when no reason is given, letting the SERVICE decide', async () => {
      // The default depends on state the gateway does not have: `INITIAL` for a
      // first assignment, `MANUAL` for a later one. Guessing here would make
      // one of the two wrong.
      fx.stubs.assignment.assignTicket.mockReturnValue(of(wireAssignment()));

      await authenticatedAgent(fx.app, { permissionCodes: ['ticket.assign'] })
        .post(`${API}/tickets/${ticketId}/assign`)
        .send(body);

      const [request] = fx.stubs.assignment.assignTicket.mock.calls[0];
      expect(request.reason).toBe(
        ProtoReassignmentReason.REASSIGNMENT_REASON_UNSPECIFIED,
      );
    });

    it('7. rejects a reason outside the enum', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.assign'],
      })
        .post(`${API}/tickets/${ticketId}/assign`)
        .send({ ...body, reason: 'BECAUSE_I_SAID_SO' });

      expect(res.status).toBe(400);
    });

    it('8. maps a concurrent-write ABORTED to 409, not 500', async () => {
      // The caller's request was well formed and permitted; somebody else got
      // there first. 409 says "retry", which is true — 500 would say "we broke",
      // which is not.
      fx.stubs.assignment.assignTicket.mockReturnValue(
        throwError(() =>
          grpcError(GrpcStatus.ABORTED, 'Reassigned by someone else'),
        ),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.assign'],
      })
        .post(`${API}/tickets/${ticketId}/assign`)
        .send(body);

      expect(res.status).toBe(409);
    });

    it('9. maps an unresolvable department to 400, not 404', async () => {
      // The TICKET is not what is missing — a field in the body names something
      // that does not exist, so the fix is the body rather than the URL.
      fx.stubs.assignment.assignTicket.mockReturnValue(
        throwError(() =>
          grpcError(GrpcStatus.INVALID_ARGUMENT, 'No department with that id'),
        ),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.assign'],
      })
        .post(`${API}/tickets/${ticketId}/assign`)
        .send(body);

      expect(res.status).toBe(400);
    });

    it('10. refuses an ANONYMOUS caller', async () => {
      const res = await anonymousAgent(fx.app)
        .post(`${API}/tickets/${ticketId}/assign`)
        .send(body);

      expect(res.status).toBe(401);
    });
  });

  describe('POST /tickets/:id/reassign', () => {
    it('1. is gated on ticket.reassign, NOT on ticket.assign', async () => {
      // Taking work OFF an agent is a different call from handing out unclaimed
      // work, and api-endpoints-plan §2.3b gives it its own grant.
      fx.stubs.assignment.reassignTicket.mockReturnValue(of(wireAssignment()));

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.reassign'],
      })
        .post(`${API}/tickets/${ticketId}/reassign`)
        .send(body);

      expect(res.status).toBe(200);
    });

    it('2. is REFUSED to a caller holding only ticket.assign', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.assign'],
      })
        .post(`${API}/tickets/${ticketId}/reassign`)
        .send(body);

      expect(res.status).toBe(403);
      expect(fx.stubs.assignment.reassignTicket).not.toHaveBeenCalled();
    });

    it('3. sends the SAME request shape as assign', async () => {
      // The two routes differ only in who may call them. If their payloads ever
      // diverge, one of them stops honouring the ledger invariant.
      fx.stubs.assignment.reassignTicket.mockReturnValue(of(wireAssignment()));
      fx.stubs.assignment.assignTicket.mockReturnValue(of(wireAssignment()));

      await authenticatedAgent(fx.app, { permissionCodes: ['ticket.reassign'] })
        .post(`${API}/tickets/${ticketId}/reassign`)
        .send(body);
      await authenticatedAgent(fx.app, { permissionCodes: ['ticket.assign'] })
        .post(`${API}/tickets/${ticketId}/assign`)
        .send(body);

      expect(fx.stubs.assignment.reassignTicket.mock.calls[0][0]).toEqual(
        fx.stubs.assignment.assignTicket.mock.calls[0][0],
      );
    });
  });

  describe('POST /tickets/:id/assign/self', () => {
    it('1. is gated on ticket.assign.self, NOT on ticket.assign', async () => {
      // The entire reason this is a separate route. Claiming work is something
      // every agent does; handing work to somebody else is a supervisor's
      // right, and one permission covering both would grant the second to
      // everyone who needed the first.
      fx.stubs.assignment.assignTicketToSelf.mockReturnValue(
        of(
          wireAssignment({
            reason: ProtoReassignmentReason.REASSIGNMENT_REASON_SELF_ASSIGNED,
          }),
        ),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.assign.self'],
      })
        .post(`${API}/tickets/${ticketId}/assign/self`)
        .send({ departmentId });

      expect(res.status).toBe(200);
      expect(res.body.data.reason).toBe(ReassignmentReason.SELF_ASSIGNED);
    });

    it('2. is REFUSED to a caller holding only ticket.assign', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.assign'],
      })
        .post(`${API}/tickets/${ticketId}/assign/self`)
        .send({ departmentId });

      expect(res.status).toBe(403);
    });

    it('3. does NOT accept an assigneeId — the caller is the assignee', async () => {
      // `forbidNonWhitelisted` is what makes this a 400 rather than a silently
      // ignored field: a client that thought it was assigning somebody else
      // should be told it was wrong, not have the ticket land on itself.
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.assign.self'],
      })
        .post(`${API}/tickets/${ticketId}/assign/self`)
        .send({ departmentId, assigneeId });

      expect(res.status).toBe(400);
      expect(fx.stubs.assignment.assignTicketToSelf).not.toHaveBeenCalled();
    });

    it('4. does not collide with POST /tickets/:id/assign', async () => {
      // `assign/self` is three segments and `assign` is two, so the router
      // separates them — but a regression here would send every self-claim to
      // the supervisor route, which has a different permission and a required
      // assigneeId.
      fx.stubs.assignment.assignTicketToSelf.mockReturnValue(
        of(wireAssignment()),
      );

      await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.assign.self'],
      })
        .post(`${API}/tickets/${ticketId}/assign/self`)
        .send({ departmentId });

      expect(fx.stubs.assignment.assignTicketToSelf).toHaveBeenCalledTimes(1);
      expect(fx.stubs.assignment.assignTicket).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /tickets/:id/assign', () => {
    it('1. answers 204 with no body', async () => {
      fx.stubs.assignment.unassignTicket.mockReturnValue(of({}));

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.assign'],
      }).delete(`${API}/tickets/${ticketId}/assign`);

      expect(res.status).toBe(204);
      expect(res.body).toEqual({});
    });

    it('2. requires ticket.assign', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.assign.self'],
      }).delete(`${API}/tickets/${ticketId}/assign`);

      expect(res.status).toBe(403);
    });

    it('3. maps FAILED_PRECONDITION to 400 for an already-unassigned ticket', async () => {
      // 400, not 409, and that is the repo-wide table from Domain A rather than
      // a choice made here: FAILED_PRECONDITION -> BAD_REQUEST. Assignment's
      // one genuine CONFLICT — assigning to whoever already holds the ticket —
      // is raised as ALREADY_EXISTS precisely so it lands on 409 instead.
      fx.stubs.assignment.unassignTicket.mockReturnValue(
        throwError(() =>
          grpcError(GrpcStatus.FAILED_PRECONDITION, 'Not currently assigned'),
        ),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.assign'],
      }).delete(`${API}/tickets/${ticketId}/assign`);

      expect(res.status).toBe(400);
    });

    it('4. does not collide with DELETE /tickets/:id', async () => {
      fx.stubs.assignment.unassignTicket.mockReturnValue(of({}));

      await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.assign', 'ticket.delete'],
      }).delete(`${API}/tickets/${ticketId}/assign`);

      expect(fx.stubs.assignment.unassignTicket).toHaveBeenCalledTimes(1);
      expect(fx.stubs.ticket.deleteTicket).not.toHaveBeenCalled();
    });
  });

  describe('GET /tickets/:id/assignments', () => {
    it('1. is readable with NO assignment permission at all', async () => {
      // "Who is handling this" is part of the ticket as far as the person who
      // raised it is concerned. The service applies the same author-or-assignee
      // filter it applies to the ticket itself.
      fx.stubs.assignment.listAssignments.mockReturnValue(
        of({ items: [wireAssignment({ ticketId })] }),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: [],
      }).get(`${API}/tickets/${ticketId}/assignments`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it('2. maps a CLOSED entry with its unassignedAt', async () => {
      fx.stubs.assignment.listAssignments.mockReturnValue(
        of({
          items: [
            wireAssignment({
              isCurrent: false,
              unassignedAt: timestamp(),
              reason: ProtoReassignmentReason.REASSIGNMENT_REASON_ESCALATION,
            }),
          ],
        }),
      );

      const res = await authenticatedAgent(fx.app).get(
        `${API}/tickets/${ticketId}/assignments`,
      );

      expect(res.body.data[0].isCurrent).toBe(false);
      expect(res.body.data[0].unassignedAt).not.toBeNull();
      expect(res.body.data[0].reason).toBe(ReassignmentReason.ESCALATION);
    });

    it('3. renders an absent unassignedAt as NULL, never missing', async () => {
      // protobuf has no null, so an unset field arrives as `undefined` and
      // would vanish from the JSON — giving a client a key set that changes per
      // row. The REST contract commits to a stable shape instead.
      //
      // **`assignedById` used to be asserted here too, and is not any more.**
      // It was `string | null` for a system assignment that no writer produces,
      // and it is now `string` (known-gaps #12). `unassignedAt` is the
      // legitimately nullable field on this shape — an assignment that is still
      // live has no end — so it is the one that carries the test.
      fx.stubs.assignment.listAssignments.mockReturnValue(
        of({ items: [wireAssignment({ unassignedAt: undefined })] }),
      );

      const res = await authenticatedAgent(fx.app).get(
        `${API}/tickets/${ticketId}/assignments`,
      );

      expect(res.body.data[0]).toHaveProperty('unassignedAt', null);
      // Still a string, and still present: the narrowing did not turn it into
      // an optional key.
      expect(typeof res.body.data[0].assignedById).toBe('string');
    });

    it('4. returns an EMPTY array for a ticket never assigned', async () => {
      fx.stubs.assignment.listAssignments.mockReturnValue(of({ items: [] }));

      const res = await authenticatedAgent(fx.app).get(
        `${API}/tickets/${ticketId}/assignments`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('5. maps NOT_FOUND to 404 for another tenant’s ticket', async () => {
      fx.stubs.assignment.listAssignments.mockReturnValue(
        throwError(() =>
          grpcError(GrpcStatus.NOT_FOUND, 'No ticket with that id'),
        ),
      );

      const res = await authenticatedAgent(fx.app).get(
        `${API}/tickets/${ticketId}/assignments`,
      );

      expect(res.status).toBe(404);
    });

    it('6. does not collide with GET /tickets/:id', async () => {
      fx.stubs.assignment.listAssignments.mockReturnValue(of({ items: [] }));

      await authenticatedAgent(fx.app).get(
        `${API}/tickets/${ticketId}/assignments`,
      );

      expect(fx.stubs.assignment.listAssignments).toHaveBeenCalledTimes(1);
      expect(fx.stubs.ticket.getTicket).not.toHaveBeenCalled();
    });

    it('7. rejects a NON-UUID ticket id', async () => {
      const res = await authenticatedAgent(fx.app).get(
        `${API}/tickets/not-a-uuid/assignments`,
      );

      expect(res.status).toBe(400);
    });
  });
});
