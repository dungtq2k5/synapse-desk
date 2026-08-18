import { of, throwError } from 'rxjs';
import { faker } from '@faker-js/faker';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { TicketPriority, TicketStatus } from '@synapsedesk/common';
import {
  TicketPriority as ProtoTicketPriority,
  TicketStatus as ProtoTicketStatus,
} from '@synapsedesk/grpc-proto';
import {
  API,
  E2eFixture,
  anonymousAgent,
  authenticatedAgent,
  bootstrapE2eTest,
  flushTestRedis,
} from '../utils';
import { grpcError, timestamp, wirePage, wireTicket } from '../fixtures/wire';

/**
 * The tickets surface at the HTTP boundary.
 *
 * ticket-service is stubbed: the state machine, the visibility filter and the
 * partial-success shape all have their own suite against a real database. What
 * is under test here is the boundary — routing, validation, the permission
 * gates, and the enum mapping in both directions.
 */
describe('Tickets at the HTTP boundary (e2e)', () => {
  let fx: E2eFixture;

  beforeAll(async () => {
    await flushTestRedis();
    fx = await bootstrapE2eTest();
  });

  beforeEach(async () => {
    await flushTestRedis();
    jest.clearAllMocks();
  });

  afterAll(() => fx.close());

  describe('GET /tickets', () => {
    it('an end user with NO permissions may list their own tickets', async () => {
      // The narrowing happens in ticket-service, which returns only what the
      // caller authored or is assigned. Requiring a grant HERE would make the
      // self-service flow unusable — raising a ticket is the product's entry
      // point, and you must be able to read the reply.
      fx.stubs.ticket.listTickets.mockReturnValue(of(wirePage([wireTicket()])));

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: [],
      }).get(`${API}/tickets`);

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
    });

    it('maps the numeric wire enums back to their DOMAIN strings', async () => {
      // The mapping is invisible when it fails: an unmapped value becomes null
      // and the UI shows a blank status rather than erroring.
      fx.stubs.ticket.listTickets.mockReturnValue(
        of(
          wirePage([
            wireTicket({
              status: ProtoTicketStatus.TICKET_STATUS_ESCALATED,
              priority: ProtoTicketPriority.TICKET_PRIORITY_URGENT,
            }),
          ]),
        ),
      );

      const res = await authenticatedAgent(fx.app).get(`${API}/tickets`);

      expect(res.body.data.items[0].status).toBe(TicketStatus.ESCALATED);
      expect(res.body.data.items[0].priority).toBe(TicketPriority.URGENT);
    });

    it('forwards the filters as proto enums, not as strings', async () => {
      fx.stubs.ticket.listTickets.mockReturnValue(of(wirePage([])));

      await authenticatedAgent(fx.app).get(
        `${API}/tickets?status=ESCALATED&priority=URGENT`,
      );

      const [request] = fx.stubs.ticket.listTickets.mock.calls[0];
      expect(request.status).toBe(ProtoTicketStatus.TICKET_STATUS_ESCALATED);
      expect(request.priority).toBe(ProtoTicketPriority.TICKET_PRIORITY_URGENT);
    });

    it('an ABSENT filter is sent as UNSPECIFIED, which the service reads as "no filter"', async () => {
      fx.stubs.ticket.listTickets.mockReturnValue(of(wirePage([])));

      await authenticatedAgent(fx.app).get(`${API}/tickets`);

      const [request] = fx.stubs.ticket.listTickets.mock.calls[0];
      expect(request.status).toBe(ProtoTicketStatus.TICKET_STATUS_UNSPECIFIED);
      // '' rather than undefined: proto3 scalars have no null.
      expect(request.assigneeId).toBe('');
    });

    it('rejects an unknown status filter with 400', async () => {
      const res = await authenticatedAgent(fx.app).get(
        `${API}/tickets?status=NONSENSE`,
      );

      expect(res.status).toBe(400);
      expect(fx.stubs.ticket.listTickets).not.toHaveBeenCalled();
    });

    it('rejects an unsortable column with 400 before the peer is called', async () => {
      const res = await authenticatedAgent(fx.app).get(
        `${API}/tickets?sortBy=description`,
      );

      expect(res.status).toBe(400);
      expect(fx.stubs.ticket.listTickets).not.toHaveBeenCalled();
    });

    it('includeDeleted REQUIRES ticket.delete', async () => {
      const refused = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.read.all'],
      }).get(`${API}/tickets?includeDeleted=true`);

      expect(refused.status).toBe(403);
      expect(fx.stubs.ticket.listTickets).not.toHaveBeenCalled();
    });

    it('includeDeleted is ALLOWED with ticket.delete', async () => {
      fx.stubs.ticket.listTickets.mockReturnValue(of(wirePage([])));

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.delete'],
      }).get(`${API}/tickets?includeDeleted=true`);

      expect(res.status).toBe(200);
    });

    it('an anonymous caller is 401', async () => {
      const res = await anonymousAgent(fx.app).get(`${API}/tickets`);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /tickets/by-number/:n', () => {
    it('resolves BEFORE the :id route — declaration order matters', async () => {
      // `@Get(':id')` would swallow `by-number/4211`, and `ParseUUIDPipe` would
      // turn it into a 400 that looks like a client bug. The same ordering
      // hazard `/users/invitations` hit in Domain A.
      fx.stubs.ticket.getTicketByNumber.mockReturnValue(
        of(wireTicket({ ticketNumber: 4211 })),
      );

      const res = await authenticatedAgent(fx.app).get(
        `${API}/tickets/by-number/4211`,
      );

      expect(res.status).toBe(200);
      expect(fx.stubs.ticket.getTicketByNumber).toHaveBeenCalled();
      expect(fx.stubs.ticket.getTicket).not.toHaveBeenCalled();
    });

    it('a non-numeric ticket number is 400', async () => {
      const res = await authenticatedAgent(fx.app).get(
        `${API}/tickets/by-number/not-a-number`,
      );

      expect(res.status).toBe(400);
    });
  });

  describe('GET /tickets/:id', () => {
    it('a NOT_FOUND from the peer becomes a 404', async () => {
      fx.stubs.ticket.getTicket.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.NOT_FOUND, 'No ticket')),
      );

      const res = await authenticatedAgent(fx.app).get(
        `${API}/tickets/${faker.string.uuid()}`,
      );

      expect(res.status).toBe(404);
    });

    it('a malformed id is 400 before the peer is called', async () => {
      const res = await authenticatedAgent(fx.app).get(
        `${API}/tickets/not-a-uuid`,
      );

      expect(res.status).toBe(400);
      expect(fx.stubs.ticket.getTicket).not.toHaveBeenCalled();
    });
  });

  describe('POST /tickets', () => {
    it('requires ticket.create', async () => {
      const res = await authenticatedAgent(fx.app, { permissionCodes: [] })
        .post(`${API}/tickets`)
        .send({ title: 'Printer on fire', description: 'It is' });

      expect(res.status).toBe(403);
    });

    it('creates and returns 201 with the mapped ticket', async () => {
      fx.stubs.ticket.createTicket.mockReturnValue(of(wireTicket()));

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.create'],
      })
        .post(`${API}/tickets`)
        .send({
          title: 'Printer on fire',
          description: 'It really is',
          priority: TicketPriority.HIGH,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBeDefined();

      const [request] = fx.stubs.ticket.createTicket.mock.calls[0];
      expect(request.priority).toBe(ProtoTicketPriority.TICKET_PRIORITY_HIGH);
    });

    it('rejects a body with NO title', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.create'],
      })
        .post(`${API}/tickets`)
        .send({ description: 'No title here' });

      expect(res.status).toBe(400);
      expect(fx.stubs.ticket.createTicket).not.toHaveBeenCalled();
    });

    it('rejects a STATUS in the create body — forbidNonWhitelisted', async () => {
      // There is no status field on the DTO at all, so a client cannot skip
      // triage. A 400 tells them that; a silent ignore would let them believe
      // it worked.
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.create'],
      })
        .post(`${API}/tickets`)
        .send({
          title: 'Printer on fire',
          description: 'It is',
          status: TicketStatus.RESOLVED,
        });

      expect(res.status).toBe(400);
    });

    it('rejects an over-long title', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.create'],
      })
        .post(`${API}/tickets`)
        .send({ title: 'x'.repeat(300), description: 'Body' });

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /tickets/:id', () => {
    it('rejects a status in the update body', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.update'],
      })
        .patch(`${API}/tickets/${faker.string.uuid()}`)
        .send({ status: TicketStatus.CLOSED });

      expect(res.status).toBe(400);
      expect(fx.stubs.ticket.updateTicket).not.toHaveBeenCalled();
    });

    it('an absent field is not sent as an empty string', async () => {
      // "Leave unchanged" and "clear it" must stay distinguishable across the
      // hop, which is why these are `optional` in the proto.
      fx.stubs.ticket.updateTicket.mockReturnValue(of(wireTicket()));

      await authenticatedAgent(fx.app, { permissionCodes: ['ticket.update'] })
        .patch(`${API}/tickets/${faker.string.uuid()}`)
        .send({ title: 'Renamed' });

      const [request] = fx.stubs.ticket.updateTicket.mock.calls[0];
      expect(request.title).toBe('Renamed');
      expect(request.description).toBeUndefined();
    });
  });

  describe('the state-machine routes', () => {
    // `escalate` is NOT here, deliberately — see the test below it.
    const ROUTES: [string, keyof E2eFixture['stubs']['ticket'], string][] = [
      ['resolve', 'resolveTicket', 'ticket.resolve'],
      ['reopen', 'reopenTicket', 'ticket.update'],
      ['close', 'closeTicket', 'ticket.resolve'],
    ];

    it.each(ROUTES)(
      'POST /tickets/:id/%s requires %s',
      async (path, method, permission) => {
        const stub = fx.stubs.ticket[method] as jest.Mock;
        stub.mockReturnValue(of(wireTicket()));

        const refused = await authenticatedAgent(fx.app, {
          permissionCodes: [],
        }).post(`${API}/tickets/${faker.string.uuid()}/${path}`);
        expect(refused.status).toBe(403);

        const allowed = await authenticatedAgent(fx.app, {
          permissionCodes: [permission as never],
        }).post(`${API}/tickets/${faker.string.uuid()}/${path}`);
        expect(allowed.status).toBe(200);
      },
    );

    it('POST /tickets/:id/escalate needs NO permission at all', async () => {
      // The one state-machine route that is open, and `api-endpoints-plan.md §2.1`
      // marks it `USER` for a reason: "one-click hand-off to a human" is the
      // self-service product's core affordance, and a customer who needs a
      // person cannot be made to wait for an administrator to grant them the
      // right to ask for one. Its `/chat` alias depends on this.
      //
      // The real bound is stronger than a permission would be: ticket-service's
      // visibility filter means you can only escalate a ticket you can already
      // see, which for an end user is their own.
      fx.stubs.ticket.escalateTicket.mockReturnValue(of(wireTicket()));

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: [],
      }).post(`${API}/tickets/${faker.string.uuid()}/escalate`);

      expect(res.status).toBe(200);
    });

    it('an ILLEGAL transition surfaces as 409, not 400', async () => {
      // ABORTED maps to 409 — a conflict with the current state, retryable once
      // the ticket moves. 400 would tell the client its request was malformed,
      // which it was not.
      fx.stubs.ticket.changeTicketStatus.mockReturnValue(
        throwError(() =>
          grpcError(
            GrpcStatus.ABORTED,
            'Cannot move a ticket from NEW to RESOLVED',
          ),
        ),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.update'],
      })
        .post(`${API}/tickets/${faker.string.uuid()}/status`)
        .send({ status: TicketStatus.RESOLVED });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/cannot move/i);
    });

    it('rejects an unknown target status with 400', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.update'],
      })
        .post(`${API}/tickets/${faker.string.uuid()}/status`)
        .send({ status: 'NONSENSE' });

      expect(res.status).toBe(400);
      expect(fx.stubs.ticket.changeTicketStatus).not.toHaveBeenCalled();
    });
  });

  describe('POST /tickets/bulk/status', () => {
    it('returns 200 with the partial-success body even when some fail', async () => {
      // Never a 207 or a 4xx: the operation succeeded — it processed every id
      // and is reporting what happened to each. A status code cannot express
      // "3 of 4", so the body does.
      const updated = [faker.string.uuid(), faker.string.uuid()];
      const failedId = faker.string.uuid();

      fx.stubs.ticket.bulkChangeTicketStatus.mockReturnValue(
        of({
          updated,
          failed: [{ id: failedId, reason: 'Cannot move a ticket from NEW' }],
        }),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.update'],
      })
        .post(`${API}/tickets/bulk/status`)
        .send({
          ticketIds: [...updated, failedId],
          status: TicketStatus.RESOLVED,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.updated).toEqual(updated);
      expect(res.body.data.failed[0].id).toBe(failedId);
      expect(res.body.data.failed[0].reason).toBeTruthy();
    });

    it('caps the batch at the DTO edge', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.update'],
      })
        .post(`${API}/tickets/bulk/status`)
        .send({
          ticketIds: Array.from({ length: 51 }, () => faker.string.uuid()),
          status: TicketStatus.CLOSED,
        });

      expect(res.status).toBe(400);
      expect(fx.stubs.ticket.bulkChangeTicketStatus).not.toHaveBeenCalled();
    });

    it('rejects an EMPTY batch', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.update'],
      })
        .post(`${API}/tickets/bulk/status`)
        .send({ ticketIds: [], status: TicketStatus.CLOSED });

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /tickets/:id', () => {
    it('requires ticket.delete and answers 204', async () => {
      fx.stubs.ticket.deleteTicket.mockReturnValue(of({}));

      const refused = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.update'],
      }).delete(`${API}/tickets/${faker.string.uuid()}`);
      expect(refused.status).toBe(403);

      const allowed = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.delete'],
      }).delete(`${API}/tickets/${faker.string.uuid()}`);
      expect(allowed.status).toBe(204);
    });

    it('restore requires the same permission', async () => {
      fx.stubs.ticket.restoreTicket.mockReturnValue(of(wireTicket()));

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.delete'],
      }).post(`${API}/tickets/${faker.string.uuid()}/restore`);

      expect(res.status).toBe(200);
    });
  });

  describe('the response envelope', () => {
    it('wraps a success', async () => {
      fx.stubs.ticket.getTicket.mockReturnValue(of(wireTicket()));

      const res = await authenticatedAgent(fx.app).get(
        `${API}/tickets/${faker.string.uuid()}`,
      );

      expect(res.body).toMatchObject({
        success: true,
        statusCode: 200,
        message: expect.any(String),
        data: expect.any(Object),
      });
    });

    it('wraps a failure', async () => {
      fx.stubs.ticket.getTicket.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.NOT_FOUND, 'gone')),
      );

      const res = await authenticatedAgent(fx.app).get(
        `${API}/tickets/${faker.string.uuid()}`,
      );

      expect(res.body).toMatchObject({
        success: false,
        statusCode: 404,
        path: expect.any(String),
        timestamp: expect.any(String),
        error: expect.any(String),
      });
    });

    it('a ticket with no assignee reports NULL, not a missing key', async () => {
      // protobuf has no null, so an unset field arrives as undefined. Passing
      // that through would give a client a key set that changes per row.
      fx.stubs.ticket.getTicket.mockReturnValue(
        of(wireTicket({ currentAssigneeId: undefined, resolvedAt: undefined })),
      );

      const res = await authenticatedAgent(fx.app).get(
        `${API}/tickets/${faker.string.uuid()}`,
      );

      expect(res.body.data).toHaveProperty('currentAssigneeId', null);
      expect(res.body.data).toHaveProperty('resolvedAt', null);
    });

    it('a resolved ticket carries its resolvedAt as an ISO instant', async () => {
      const resolvedAt = new Date('2026-02-01T10:00:00.000Z');
      fx.stubs.ticket.getTicket.mockReturnValue(
        of(
          wireTicket({
            status: ProtoTicketStatus.TICKET_STATUS_RESOLVED,
            resolvedAt: timestamp(resolvedAt),
          }),
        ),
      );

      const res = await authenticatedAgent(fx.app).get(
        `${API}/tickets/${faker.string.uuid()}`,
      );

      expect(new Date(res.body.data.resolvedAt as string).toISOString()).toBe(
        resolvedAt.toISOString(),
      );
    });
  });
});
