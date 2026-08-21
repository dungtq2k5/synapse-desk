import { of, throwError } from 'rxjs';
import { faker } from '@faker-js/faker';
import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  MAX_STATUS_CHANGE_REASON_LENGTH,
  TicketPriority,
  TicketStatus,
} from '@synapsedesk/common';
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
            'Cannot move a ticket from NEW to PENDING_AGENT',
          ),
        ),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.update'],
      })
        .post(`${API}/tickets/${faker.string.uuid()}/status`)
        .send({ status: TicketStatus.PENDING_AGENT });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/cannot move/i);
    });

    it('**a terminal target on the generic route is 400, and names its route**', async () => {
      // The bypass, from the HTTP side. `POST /:id/status` is `ticket.update`
      // and `POST /:id/resolve` is `ticket.resolve`, so a caller holding only
      // the former reached RESOLVED and CLOSED through the generic route until
      // ticket-service started refusing them.
      //
      // 400 and not 403: the caller is not being told they lack a permission,
      // they are being told to use the route that carries it. FAILED_PRECONDITION
      // maps to 400 everywhere in this gateway.
      fx.stubs.ticket.changeTicketStatus.mockReturnValue(
        throwError(() =>
          grpcError(
            GrpcStatus.FAILED_PRECONDITION,
            'Use the resolve route to move a ticket to RESOLVED',
          ),
        ),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.update'],
      })
        .post(`${API}/tickets/${faker.string.uuid()}/status`)
        .send({ status: TicketStatus.RESOLVED });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/resolve route/i);
    });

    it('**and the generic route still cannot be given ticket.resolve as a shortcut**', async () => {
      // The decorator is the description: holding the STRONGER right does not
      // make the generic route a way to close a ticket either, because the
      // refusal is in the service and is not a permission check.
      fx.stubs.ticket.changeTicketStatus.mockReturnValue(
        throwError(() =>
          grpcError(
            GrpcStatus.FAILED_PRECONDITION,
            'Use the close route to move a ticket to CLOSED',
          ),
        ),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.update', 'ticket.resolve'],
      })
        .post(`${API}/tickets/${faker.string.uuid()}/status`)
        .send({ status: TicketStatus.CLOSED });

      expect(res.status).toBe(400);
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

  describe('POST /tickets/bulk/priority', () => {
    it('reaches its own handler, and no `:id` route can take it', async () => {
      // NOT the trap that bit `bulk/status` and `by-number`, and the difference
      // is worth stating because the obvious assumption is that it is.
      //
      // `bulk/status` collides because its second segment is literally
      // `status`, so `@Post(':id/status')` matches it with `id = 'bulk'`.
      // Nothing declares `@Post(':id/priority')` — doc 47 §3 struck that route
      // as a duplicate of `PATCH /tickets/:id` — so `bulk/priority` has no
      // parameterized route to be swallowed by, whatever the declaration order.
      //
      // Which makes declaring it early defensive rather than load-bearing, and
      // makes THIS the test that would start failing if `:id/priority` were
      // ever added back below it.
      fx.stubs.ticket.bulkChangeTicketPriority.mockReturnValue(
        of({ updated: [], failed: [] }),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.update'],
      })
        .post(`${API}/tickets/bulk/priority`)
        .send({
          ticketIds: [faker.string.uuid()],
          priority: TicketPriority.HIGH,
        });

      expect(res.status).toBe(200);
      expect(fx.stubs.ticket.bulkChangeTicketPriority).toHaveBeenCalledTimes(1);
      expect(fx.stubs.ticket.changeTicketStatus).not.toHaveBeenCalled();
      expect(fx.stubs.ticket.updateTicket).not.toHaveBeenCalled();
    });

    it('requires ticket.update, and returns the partial-success body', async () => {
      const updated = [faker.string.uuid()];
      const failedId = faker.string.uuid();
      fx.stubs.ticket.bulkChangeTicketPriority.mockReturnValue(
        of({ updated, failed: [{ id: failedId, reason: 'Ticket not found' }] }),
      );

      const refused = await authenticatedAgent(fx.app, {
        permissionCodes: [],
      })
        .post(`${API}/tickets/bulk/priority`)
        .send({
          ticketIds: [...updated, failedId],
          priority: TicketPriority.URGENT,
        });
      expect(refused.status).toBe(403);

      const allowed = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.update'],
      })
        .post(`${API}/tickets/bulk/priority`)
        .send({
          ticketIds: [...updated, failedId],
          priority: TicketPriority.URGENT,
        });

      expect(allowed.status).toBe(200);
      expect(allowed.body.data.updated).toEqual(updated);
      expect(allowed.body.data.failed[0].id).toBe(failedId);
    });

    it('caps the batch at the DTO edge, like bulk/status', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.update'],
      })
        .post(`${API}/tickets/bulk/priority`)
        .send({
          ticketIds: Array.from({ length: 51 }, () => faker.string.uuid()),
          priority: TicketPriority.LOW,
        });

      expect(res.status).toBe(400);
      expect(fx.stubs.ticket.bulkChangeTicketPriority).not.toHaveBeenCalled();
    });

    it('**does not accept a reason** — priority has nothing to justify', async () => {
      // `forbidNonWhitelisted`, and worth pinning: `BulkTicketStatusDto` next
      // door does take one, so copying that DTO is the obvious way to add a
      // field here that means nothing.
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.update'],
      })
        .post(`${API}/tickets/bulk/priority`)
        .send({
          ticketIds: [faker.string.uuid()],
          priority: TicketPriority.LOW,
          reason: 'because',
        });

      expect(res.status).toBe(400);
      expect(fx.stubs.ticket.bulkChangeTicketPriority).not.toHaveBeenCalled();
    });
  });

  describe('the status reason and history', () => {
    const ticketId = faker.string.uuid();

    it('**all four convenience routes forward a reason**', async () => {
      // The point of widening them. `POST /:id/status` is the only other route
      // that takes a reason, and it is forbidden from reaching RESOLVED and
      // CLOSED — so without these four, the transitions a history is most read
      // to explain could never carry an explanation.
      const cases: [string, keyof E2eFixture['stubs']['ticket'], string][] = [
        ['escalate', 'escalateTicket', 'ticket.escalate'],
        ['resolve', 'resolveTicket', 'ticket.resolve'],
        ['reopen', 'reopenTicket', 'ticket.update'],
        ['close', 'closeTicket', 'ticket.resolve'],
      ];

      for (const [path, method, permission] of cases) {
        const stub = fx.stubs.ticket[method] as jest.Mock;
        stub.mockClear();
        stub.mockReturnValue(of(wireTicket()));

        const id = faker.string.uuid();
        const res = await authenticatedAgent(fx.app, {
          permissionCodes: [permission as never],
        })
          .post(`${API}/tickets/${id}/${path}`)
          .send({ reason: `because of ${path}` });

        expect([path, res.status]).toEqual([path, 200]);
        expect([path, stub.mock.calls[0][0]]).toEqual([
          path,
          { ticketId: id, reason: `because of ${path}` },
        ]);
      }
    });

    it('the body stays OPTIONAL — none of the four required one before', async () => {
      fx.stubs.ticket.closeTicket.mockReturnValue(of(wireTicket()));

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.resolve'],
      }).post(`${API}/tickets/${faker.string.uuid()}/close`);

      expect(res.status).toBe(200);
      expect(
        fx.stubs.ticket.closeTicket.mock.calls[0][0].reason,
      ).toBeUndefined();
    });

    it('a reason over the bound is 400 and never reaches the service', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.resolve'],
      })
        .post(`${API}/tickets/${faker.string.uuid()}/resolve`)
        .send({ reason: 'x'.repeat(MAX_STATUS_CHANGE_REASON_LENGTH + 1) });

      expect(res.status).toBe(400);
      expect(fx.stubs.ticket.resolveTicket).not.toHaveBeenCalled();
    });

    it('**GET /tickets/:id/history needs no permission beyond reading the ticket**', async () => {
      // Same rule as `/assignments` beside it: "what happened to this ticket"
      // is part of the ticket as far as the person who raised it is concerned,
      // and the service applies the same visibility filter the ticket read
      // does. This is also why it is NOT served from `audit_logs`, which is
      // read behind an admin permission.
      fx.stubs.ticket.listTicketStatusChanges.mockReturnValue(
        of({
          items: [
            {
              id: faker.string.uuid(),
              ticketId,
              fromStatus: ProtoTicketStatus.TICKET_STATUS_OPEN,
              toStatus: ProtoTicketStatus.TICKET_STATUS_RESOLVED,
              changedById: faker.string.uuid(),
              reason: 'Customer confirmed the fix',
              changedAt: timestamp(),
            },
          ],
        }),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: [],
      }).get(`${API}/tickets/${ticketId}/history`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].fromStatus).toBe(TicketStatus.OPEN);
      expect(res.body.data[0].toStatus).toBe(TicketStatus.RESOLVED);
      expect(res.body.data[0].reason).toBe('Customer confirmed the fix');
    });

    it('renders a STRIPPED reason as null rather than dropping the row', async () => {
      // ticket-service nulls the reason for a caller without queue access, and
      // the transition itself stays. The gateway must render that as an
      // explicit `null` — a missing key reads as "no reason was given", which
      // is a different statement from "not yours to read".
      fx.stubs.ticket.listTicketStatusChanges.mockReturnValue(
        of({
          items: [
            {
              id: faker.string.uuid(),
              ticketId,
              fromStatus: ProtoTicketStatus.TICKET_STATUS_OPEN,
              toStatus: ProtoTicketStatus.TICKET_STATUS_RESOLVED,
              changedById: faker.string.uuid(),
              reason: undefined,
              changedAt: timestamp(),
            },
          ],
        }),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: [],
      }).get(`${API}/tickets/${ticketId}/history`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].toStatus).toBe(TicketStatus.RESOLVED);
      expect(res.body.data[0]).toHaveProperty('reason', null);
    });

    it('a first-status row renders fromStatus as NULL, not as a status', async () => {
      // `UNSPECIFIED` on the wire is "no prior status". Rendering it as a real
      // member would put a transition in the history that never happened.
      fx.stubs.ticket.listTicketStatusChanges.mockReturnValue(
        of({
          items: [
            {
              id: faker.string.uuid(),
              ticketId,
              fromStatus: ProtoTicketStatus.TICKET_STATUS_UNSPECIFIED,
              toStatus: ProtoTicketStatus.TICKET_STATUS_OPEN,
              changedById: faker.string.uuid(),
              reason: undefined,
              changedAt: timestamp(),
            },
          ],
        }),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: [],
      }).get(`${API}/tickets/${ticketId}/history`);

      expect(res.status).toBe(200);
      expect(res.body.data[0].fromStatus).toBeNull();
      expect(res.body.data[0].reason).toBeNull();
    });
  });

  describe('POST /tickets/:id/read', () => {
    const ticketId = faker.string.uuid();

    it("**forwards the client's readAt, and needs no permission**", async () => {
      // The body is the point: without it the server stamps its own clock and
      // marks read everything that arrived between the render and this request.
      const readAt = new Date('2026-08-21T10:00:00.000Z');
      fx.stubs.ticket.markTicketRead.mockReturnValue(
        of({ lastReadAt: timestamp() }),
      );

      const res = await authenticatedAgent(fx.app, { permissionCodes: [] })
        .post(`${API}/tickets/${ticketId}/read`)
        .send({ readAt: readAt.toISOString() });

      expect(res.status).toBe(200);
      const [request] = fx.stubs.ticket.markTicketRead.mock.calls[0];
      expect(request.ticketId).toBe(ticketId);
      expect(request.readAt?.seconds).toBe(Math.floor(readAt.getTime() / 1000));
    });

    it('accepts no body at all — a client with nothing rendered', async () => {
      fx.stubs.ticket.markTicketRead.mockReturnValue(
        of({ lastReadAt: timestamp() }),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: [],
      }).post(`${API}/tickets/${ticketId}/read`);

      expect(res.status).toBe(200);
      expect(
        fx.stubs.ticket.markTicketRead.mock.calls[0][0].readAt,
      ).toBeUndefined();
    });

    it('rejects a readAt that is not a date, rather than passing it on', async () => {
      const res = await authenticatedAgent(fx.app, { permissionCodes: [] })
        .post(`${API}/tickets/${ticketId}/read`)
        .send({ readAt: 'yesterday' });

      expect(res.status).toBe(400);
      expect(fx.stubs.ticket.markTicketRead).not.toHaveBeenCalled();
    });

    it('**the unread count reaches the list response**', async () => {
      // The field that makes this a feature rather than a table: a queue screen
      // reads the badge off the list it already fetched.
      fx.stubs.ticket.listTickets.mockReturnValue(
        of({
          items: [wireTicket({ unreadCount: 4 })],
          meta: wirePage([]).meta,
        }),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: [],
      }).get(`${API}/tickets`);

      expect(res.status).toBe(200);
      expect(res.body.data.items[0].unreadCount).toBe(4);
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
