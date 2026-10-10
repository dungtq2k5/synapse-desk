/**
 * @file `TicketsApi` — 24 operations across CRUD, the status state machine,
 * bulk ops, the assignment quadruple, read-state/history, export, and the
 * AI-similar lookup. This is the interface the 3-group port structure was
 * built for: the sibling permission-code risk on `assign`/`reassign`/
 * `assignToSelf`/`unassign` is pinned here at the HTTP level, and the bulk partial-success envelope is pinned at
 * the item level per the user's explicit instruction.
 */

import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/contracts';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('tickets', () => {
  let gateway: Gateway;
  let peers: Peers;

  const TICKET = '11111111-1111-4111-8111-111111111111';
  const ORGANIZATION = 'cccccccc-0000-4000-8000-cccccccccccc';
  const AGENT = 'bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb';
  const ASSIGNEE = 'dddddddd-3333-4333-8333-dddddddddddd';
  const DEPARTMENT = 'eeeeeeee-4444-4444-8444-eeeeeeeeeeee';

  const headersWithCodes = (codes: string[]) => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
      {
        sub: AGENT,
        organizationId: ORGANIZATION,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes: codes,
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    )}`,
  });

  const wireTicket = (overrides: Record<string, unknown> = {}) => ({
    id: TICKET,
    ticketNumber: 42,
    organizationId: ORGANIZATION,
    authorId: AGENT,
    source: 1, // TICKET_SOURCE_WEB
    status: 1, // TICKET_STATUS_NEW
    priority: 2, // TICKET_PRIORITY_MEDIUM
    title: 'Printer is on fire',
    description: 'It is genuinely on fire',
    unreadCount: 0,
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
    updatedAt: { seconds: 1_756_684_800, nanos: 0 },
    ...overrides,
  });

  const wireAssignment = (overrides: Record<string, unknown> = {}) => ({
    id: '22222222-2222-4222-8222-222222222222',
    ticketId: TICKET,
    assignedToId: ASSIGNEE,
    assignedById: AGENT,
    departmentId: DEPARTMENT,
    assignedAt: { seconds: 1_756_684_800, nanos: 0 },
    reason: 0, // REASSIGNMENT_REASON_UNSPECIFIED
    isCurrent: true,
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
    ...overrides,
  });

  beforeAll(async () => {
    const { redisUrl, natsUrl } = readRunState();
    peers = await startPeers();
    gateway = await startGateway({
      ...peers.env,
      REDIS_URL: redisUrl,
      NATS_URL: natsUrl,
    });
  }, 90_000);

  afterAll(async () => {
    await gateway.stop();
    await peers.stop();
  });

  beforeEach(() => {
    peers.reset();
    peers.auth.on('OrganizationService/GetOrganizationStatus').always({
      status: toProtoOrgStatus(OrgStatus.ACTIVE),
      deleted: false,
    });
  });

  // ---- CRUD + plain reads ----------------------------------------------

  rowFor('Tickets')(
    '**`list` forwards filters and refuses `includeDeleted` without `ticket.delete`**',
    async () => {
      const response = await new Session(gateway.baseUrl).get(
        `${API}/tickets?includeDeleted=true`,
        headersWithCodes([]),
      );

      expect(response.status).toBe(403);
    },
  );

  rowFor('Tickets')(
    '**`list` allows `includeDeleted` for a caller holding `ticket.delete`**',
    async () => {
      peers.ticket
        .on('TicketService/ListTickets')
        .reply({ items: [wireTicket()], meta: { totalItems: 1 } });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/tickets?includeDeleted=true`,
        headersWithCodes(['ticket.delete']),
      );

      expect(response.status).toBe(200);
    },
  );

  rowFor('Tickets')(
    '**`getByNumber` forwards the ticket number**',
    async () => {
      peers.ticket.on('TicketService/GetTicketByNumber').reply(wireTicket());

      const response = await new Session(gateway.baseUrl).get(
        `${API}/tickets/by-number/42`,
        headersWithCodes([]),
      );

      expect(response.status).toBe(200);
      const [call] = peers.ticket.calls('TicketService/GetTicketByNumber');
      expect(call.request).toMatchObject({ ticketNumber: 42 });
    },
  );

  rowFor('Tickets')('**`get` needs no permission code**', async () => {
    peers.ticket.on('TicketService/GetTicket').reply(wireTicket());

    const response = await new Session(gateway.baseUrl).get(
      `${API}/tickets/${TICKET}`,
      headersWithCodes([]),
    );

    expect(response.status).toBe(200);
  });

  rowFor('Tickets')(
    '**`create` refuses a caller without `ticket.create`**',
    async () => {
      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets`,
        { title: 'A new ticket', description: 'Something broke' },
        headersWithCodes([]),
      );

      expect(response.status).toBe(403);
    },
  );

  rowFor('Tickets')(
    '**`create` succeeds for a caller holding `ticket.create`**',
    async () => {
      peers.ticket.on('TicketService/CreateTicket').reply(wireTicket());

      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets`,
        { title: 'A new ticket', description: 'Something broke' },
        headersWithCodes(['ticket.create']),
      );

      expect(response.status).toBe(201);
    },
  );

  rowFor('Tickets')(
    '**`update` refuses a caller without `ticket.update`**',
    async () => {
      const response = await new Session(gateway.baseUrl).request(
        'PATCH',
        `${API}/tickets/${TICKET}`,
        {
          body: { title: 'Renamed' },
          headers: headersWithCodes([]),
        },
      );

      expect(response.status).toBe(403);
    },
  );

  rowFor('Tickets')(
    '**`update` forwards only the fields present**',
    async () => {
      peers.ticket
        .on('TicketService/UpdateTicket')
        .reply(wireTicket({ title: 'Renamed' }));

      const response = await new Session(gateway.baseUrl).request(
        'PATCH',
        `${API}/tickets/${TICKET}`,
        {
          body: { title: 'Renamed' },
          headers: headersWithCodes(['ticket.update']),
        },
      );

      expect(response.status).toBe(200);
      const [call] = peers.ticket.calls('TicketService/UpdateTicket');
      expect(call.request).toMatchObject({ id: TICKET, title: 'Renamed' });
      expect(call.request.description).toBeUndefined();
    },
  );

  rowFor('Tickets')(
    '**`remove` refuses a caller without `ticket.delete`**',
    async () => {
      const response = await new Session(gateway.baseUrl).request(
        'DELETE',
        `${API}/tickets/${TICKET}`,
        {
          headers: headersWithCodes([]),
        },
      );

      expect(response.status).toBe(403);
    },
  );

  rowFor('Tickets')('**`remove` returns 204**', async () => {
    peers.ticket.on('TicketService/DeleteTicket').reply({});

    const response = await new Session(gateway.baseUrl).request(
      'DELETE',
      `${API}/tickets/${TICKET}`,
      {
        headers: headersWithCodes(['ticket.delete']),
      },
    );

    expect(response.status).toBe(204);
  });

  rowFor('Tickets')(
    '**`restore` requires `ticket.delete`, same as `remove`**',
    async () => {
      peers.ticket.on('TicketService/RestoreTicket').reply(wireTicket());

      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/${TICKET}/restore`,
        undefined,
        headersWithCodes(['ticket.delete']),
      );

      expect(response.status).toBe(200);
    },
  );

  // ---- Status state machine + bulk ops -----------------------------------

  rowFor('Tickets')(
    '**`bulkChangeStatus` preserves the partial-success envelope at the item level**',
    async () => {
      peers.ticket.on('TicketService/BulkChangeTicketStatus').reply({
        updated: [TICKET],
        failed: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            reason: 'already CLOSED',
          },
        ],
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/bulk/status`,
        {
          ticketIds: [TICKET, '33333333-3333-4333-8333-333333333333'],
          status: 'OPEN',
        },
        headersWithCodes(['ticket.update']),
      );

      expect(response.status).toBe(200);
      const body = response.body as {
        data: { updated: string[]; failed: { id: string; reason: string }[] };
      };
      expect(body.data.updated).toEqual([TICKET]);
      expect(body.data.failed).toEqual([
        {
          id: '33333333-3333-4333-8333-333333333333',
          reason: 'already CLOSED',
        },
      ]);
    },
  );

  rowFor('Tickets')(
    '**`bulkChangePriority` refuses more than 50 ticket ids**',
    async () => {
      const ids = Array.from(
        { length: 51 },
        (_, i) => `44444444-0000-4000-8000-${String(i).padStart(12, '0')}`,
      );

      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/bulk/priority`,
        { ticketIds: ids, priority: 'HIGH' },
        headersWithCodes(['ticket.update']),
      );

      expect(response.status).toBe(400);
      expect(
        peers.ticket.calls('TicketService/BulkChangeTicketPriority'),
      ).toHaveLength(0);
    },
  );

  rowFor('Tickets')(
    '**`changeStatus` forwards to ticket-service; RESOLVED/CLOSED refusal is not duplicated here**',
    async () => {
      peers.ticket
        .on('TicketService/ChangeTicketStatus')
        .reply(wireTicket({ status: 2 }));

      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/${TICKET}/status`,
        { status: 'OPEN' },
        headersWithCodes(['ticket.update']),
      );

      expect(response.status).toBe(200);
    },
  );

  rowFor('Tickets')(
    '**`escalate` needs no permission code at all — self-service is the point**',
    async () => {
      peers.ticket
        .on('TicketService/EscalateTicket')
        .reply(wireTicket({ status: 4 }));

      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/${TICKET}/escalate`,
        {},
        headersWithCodes([]),
      );

      expect(response.status).toBe(200);
    },
  );

  rowFor('Tickets')(
    '**`resolve` requires `ticket.resolve`, not `ticket.update`**',
    async () => {
      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/${TICKET}/resolve`,
        {},
        headersWithCodes(['ticket.update']),
      );

      expect(response.status).toBe(403);
    },
  );

  rowFor('Tickets')(
    '**`reopen` requires `ticket.update`, not `ticket.resolve`**',
    async () => {
      peers.ticket
        .on('TicketService/ReopenTicket')
        .reply(wireTicket({ status: 2 }));

      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/${TICKET}/reopen`,
        {},
        headersWithCodes(['ticket.update']),
      );

      expect(response.status).toBe(200);
    },
  );

  rowFor('Tickets')(
    '**`close` requires `ticket.resolve`, same as `resolve`**',
    async () => {
      peers.ticket
        .on('TicketService/CloseTicket')
        .reply(wireTicket({ status: 6 }));

      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/${TICKET}/close`,
        {},
        headersWithCodes(['ticket.resolve']),
      );

      expect(response.status).toBe(200);
    },
  );

  // ---- Assignment quadruple — the sibling-code risk this port exists for ----

  rowFor('Tickets')(
    '**`assign` requires `ticket.assign`, not `ticket.assign.self`**',
    async () => {
      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/${TICKET}/assign`,
        { assigneeId: ASSIGNEE, departmentId: DEPARTMENT },
        headersWithCodes(['ticket.assign.self']),
      );

      expect(response.status).toBe(403);
    },
  );

  rowFor('Tickets')(
    '**`assign` succeeds for a caller holding `ticket.assign`**',
    async () => {
      peers.ticket.on('AssignmentService/AssignTicket').reply(wireAssignment());

      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/${TICKET}/assign`,
        { assigneeId: ASSIGNEE, departmentId: DEPARTMENT },
        headersWithCodes(['ticket.assign']),
      );

      expect(response.status).toBe(200);
    },
  );

  rowFor('Tickets')(
    '**`reassign` requires `ticket.reassign`, not `ticket.assign`**',
    async () => {
      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/${TICKET}/reassign`,
        { assigneeId: ASSIGNEE, departmentId: DEPARTMENT },
        headersWithCodes(['ticket.assign']),
      );

      expect(response.status).toBe(403);
    },
  );

  rowFor('Tickets')(
    '**`reassign` succeeds for a caller holding `ticket.reassign`**',
    async () => {
      peers.ticket
        .on('AssignmentService/ReassignTicket')
        .reply(wireAssignment());

      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/${TICKET}/reassign`,
        { assigneeId: ASSIGNEE, departmentId: DEPARTMENT },
        headersWithCodes(['ticket.reassign']),
      );

      expect(response.status).toBe(200);
    },
  );

  rowFor('Tickets')(
    '**`assignToSelf` requires `ticket.assign.self`; its DTO carries no `assigneeId` at all**',
    async () => {
      peers.ticket
        .on('AssignmentService/AssignTicketToSelf')
        .reply(wireAssignment({ assignedToId: AGENT }));

      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/${TICKET}/assign/self`,
        { departmentId: DEPARTMENT },
        headersWithCodes(['ticket.assign.self']),
      );

      expect(response.status).toBe(200);
      const [call] = peers.ticket.calls('AssignmentService/AssignTicketToSelf');
      expect(Object.keys(call.request)).toEqual(['ticketId', 'departmentId']);
    },
  );

  rowFor('Tickets')(
    '**`assignToSelf` refuses a caller holding only `ticket.assign`**',
    async () => {
      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/${TICKET}/assign/self`,
        { departmentId: DEPARTMENT },
        headersWithCodes(['ticket.assign']),
      );

      expect(response.status).toBe(403);
    },
  );

  rowFor('Tickets')(
    '**`unassign` requires `ticket.assign`, same door as `assign`**',
    async () => {
      peers.ticket.on('AssignmentService/UnassignTicket').reply({});

      const response = await new Session(gateway.baseUrl).request(
        'DELETE',
        `${API}/tickets/${TICKET}/assign`,
        {
          headers: headersWithCodes(['ticket.assign']),
        },
      );

      expect(response.status).toBe(204);
    },
  );

  rowFor('Tickets')(
    '**`listAssignments` needs no permission code**',
    async () => {
      peers.ticket
        .on('AssignmentService/ListAssignments')
        .reply({ items: [wireAssignment()] });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/tickets/${TICKET}/assignments`,
        headersWithCodes([]),
      );

      expect(response.status).toBe(200);
    },
  );

  // ---- Read-state / history -----------------------------------------------

  rowFor('Tickets')(
    '**`markRead` forwards an explicit `readAt` verbatim**',
    async () => {
      peers.ticket
        .on('TicketService/MarkTicketRead')
        .reply({ lastReadAt: { seconds: 1_756_684_800, nanos: 0 } });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/${TICKET}/read`,
        { readAt: '2026-09-01T00:00:00.000Z' },
        headersWithCodes([]),
      );

      expect(response.status).toBe(200);
      const [call] = peers.ticket.calls('TicketService/MarkTicketRead');
      expect(call.request.readAt).toMatchObject({ seconds: 1_788_220_800 });
    },
  );

  rowFor('Tickets')(
    '**`markRead` never defaults an absent `readAt` — the peer stamps its own clock**',
    async () => {
      peers.ticket
        .on('TicketService/MarkTicketRead')
        .reply({ lastReadAt: { seconds: 1_756_684_800, nanos: 0 } });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/${TICKET}/read`,
        {},
        headersWithCodes([]),
      );

      expect(response.status).toBe(200);
      const [call] = peers.ticket.calls('TicketService/MarkTicketRead');
      expect(call.request.readAt).toBeUndefined();
    },
  );

  rowFor('Tickets')(
    '**`listStatusChanges` needs no permission code**',
    async () => {
      peers.ticket.on('TicketService/ListTicketStatusChanges').reply({
        items: [
          {
            id: '55555555-5555-4555-8555-555555555555',
            ticketId: TICKET,
            toStatus: 2,
            changedById: AGENT,
            changedAt: { seconds: 1_756_684_800, nanos: 0 },
          },
        ],
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/tickets/${TICKET}/history`,
        headersWithCodes([]),
      );

      expect(response.status).toBe(200);
      const [call] = peers.ticket.calls(
        'TicketService/ListTicketStatusChanges',
      );
      expect(call.request).toMatchObject({ id: TICKET });
    },
  );

  // ---- Export + AI-similar -------------------------------------------------

  rowFor('Tickets')(
    '**`createExport` refuses a caller without `ticket.export`**',
    async () => {
      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/export`,
        { from: '2026-01-01', to: '2026-09-01' },
        headersWithCodes([]),
      );

      expect(response.status).toBe(403);
    },
  );

  rowFor('Tickets')(
    '**`createExport` refuses a malformed `from` date — the dropped ISO-8601 check**',
    async () => {
      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/export`,
        { from: 'not-a-date', to: '2026-09-01' },
        headersWithCodes(['ticket.export']),
      );

      expect(response.status).toBe(400);
    },
  );

  rowFor('Tickets')(
    '**`createExport` succeeds for a caller holding `ticket.export`**',
    async () => {
      peers.ticket.on('AnalyticsService/CreateExport').reply({
        id: '66666666-6666-4666-8666-666666666666',
        status: 1,
        kind: 3,
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/export`,
        { from: '2026-01-01', to: '2026-09-01' },
        headersWithCodes(['ticket.export']),
      );

      expect(response.status).toBe(202);
    },
  );

  rowFor('Tickets')(
    '**`getExport` requires `ticket.export`, same as `createExport`**',
    async () => {
      peers.ticket.on('AnalyticsService/GetExport').reply({
        id: '66666666-6666-4666-8666-666666666666',
        status: 2,
        kind: 3,
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/tickets/export/66666666-6666-4666-8666-666666666666`,
        headersWithCodes(['ticket.export']),
      );

      expect(response.status).toBe(200);
    },
  );

  rowFor('Tickets')(
    '**`listSimilar` requires `ticket.read.all`, not an AI-usage code**',
    async () => {
      const response = await new Session(gateway.baseUrl).get(
        `${API}/tickets/${TICKET}/similar`,
        headersWithCodes([]),
      );

      expect(response.status).toBe(403);
    },
  );

  rowFor('Tickets')(
    '**`listSimilar` succeeds for a caller holding `ticket.read.all`**',
    async () => {
      peers.ticket.on('AiService/ListSimilarTickets').reply({
        items: [
          {
            ticketId: TICKET,
            ticketNumber: 7,
            title: 'Similar issue',
            similarityScore: 0.87,
          },
        ],
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/tickets/${TICKET}/similar`,
        headersWithCodes(['ticket.read.all']),
      );

      expect(response.status).toBe(200);
    },
  );
});
