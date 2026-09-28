/**
 * @file `ticket`, `tickets`, the `Ticket` edges, its three mutations, and
 * the four analytics queries with their loader-backed findings.
 *
 * `Ticket.messages` is the one edge on this type with NO loader,
 * deliberately: there is no `ListMessagesByIds` to batch into, so a row
 * here proves it calls the peer directly rather than silently gaining a
 * loader nobody asked for. `analyticsAgents` is where the
 * `hydrateNames: false` property gets its row: the users leg must never
 * fire, and `AgentStat.agent` must still resolve, through the loader alone.
 */

import { status as GrpcStatus } from '@grpc/grpc-js';
import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowForField } from './pending';

describe('tickets and analytics', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = '11111111-1111-4111-8111-111111111111';
  const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  const headers = (permissionCodes: string[] = []) => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
      {
        sub: USER,
        organizationId: ORGANIZATION,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes,
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    )}`,
  });

  const wireTicket = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    ticketNumber: 42,
    organizationId: ORGANIZATION,
    authorId: USER,
    source: 1, // TICKET_SOURCE_WEB
    status: 2, // TICKET_STATUS_OPEN
    priority: 2, // TICKET_PRIORITY_MEDIUM
    title: 'Broken widget',
    description: 'It broke',
    unreadCount: 0,
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
    updatedAt: { seconds: 1_756_684_800, nanos: 0 },
    ...overrides,
  });

  const page = (itemCount: number) => ({
    totalItems: itemCount,
    itemCount,
    itemsPerPage: itemCount,
    totalPages: 1,
    currentPage: 1,
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

  describe('Tickets', () => {
    rowForField('Query.ticket')(
      '**`Query.ticket` resolves one ticket**',
      async () => {
        const id = '55555555-5555-4555-8555-555555555555';
        peers.ticket.on('TicketService/GetTicket').reply(wireTicket(id));

        const response = await new Session(gateway.baseUrl).post<{
          data: { ticket: { id: string; title: string; status: string } };
        }>(
          '/graphql',
          { query: `{ ticket(id: "${id}") { id title status } }` },
          headers(),
        );

        expect(response.status).toBe(200);
        expect(response.body).not.toHaveProperty('errors');
        expect(response.body.data.ticket).toEqual({
          id,
          title: 'Broken widget',
          status: 'OPEN',
        });
      },
    );

    rowForField('Query.ticket')(
      '**`Query.ticket` answers null, never an error, when the peer refuses**',
      async () => {
        peers.ticket
          .on('TicketService/GetTicket')
          .fail(GrpcStatus.NOT_FOUND, 'no such ticket');

        const response = await new Session(gateway.baseUrl).post<{
          data: { ticket: null };
        }>(
          '/graphql',
          {
            query:
              '{ ticket(id: "66666666-6666-4666-8666-666666666666") { id } }',
          },
          headers(),
        );

        expect(response.status).toBe(200);
        expect(response.body).not.toHaveProperty('errors');
        expect(response.body.data.ticket).toBeNull();
      },
    );

    rowForField('Query.tickets')(
      '**`Query.tickets` never asks for deleted tickets, and `assignee`/`author`/`department` batch through their loaders**',
      async () => {
        const id = '77777777-7777-4777-8777-777777777777';
        // A user id touched by NO other row, not the shared `USER` constant —
        // `loaders.users` is backed by its own Redis entity cache
        // (`entityScope('user', id)`, 5-minute TTL) shared across every file
        // in this suite. Warming `USER`'s entry here would leave a later
        // test elsewhere — one that asserts an EXACT peer-call count for
        // `USER`, expecting a cold cache — reading this row's leftover
        // instead, with zero calls of its own to show for it.
        const TICKET_USER = 'ffffffff-3333-4333-8333-ffffffffffff';
        peers.ticket.on('TicketService/ListTickets').reply({
          items: [
            wireTicket(id, {
              authorId: TICKET_USER,
              currentAssigneeId: TICKET_USER,
              currentDepartmentId: 'dept-1',
            }),
          ],
          meta: page(1),
        });
        peers.auth.on('UserService/ListUsersByIds').reply({
          items: [],
          summaries: [
            { userId: TICKET_USER, fullName: 'Ada Lovelace', isLocked: false },
          ],
        });
        peers.auth.on('DepartmentService/ListDepartmentsByIds').reply({
          items: [{ id: 'dept-1', name: 'Support' }],
        });

        const response = await new Session(gateway.baseUrl).post<{
          data: {
            tickets: {
              items: {
                id: string;
                assignee: { fullName: string };
                author: { fullName: string };
                department: { name: string };
              }[];
            };
          };
        }>(
          '/graphql',
          {
            query:
              '{ tickets(first: 10, page: 1) { items { id assignee { fullName } author { fullName } department { name } } } }',
          },
          headers(),
        );

        expect(response.status).toBe(200);
        expect(response.body).not.toHaveProperty('errors');
        expect(response.body.data.tickets.items[0].assignee).toEqual({
          fullName: 'Ada Lovelace',
        });
        expect(response.body.data.tickets.items[0].author).toEqual({
          fullName: 'Ada Lovelace',
        });
        expect(response.body.data.tickets.items[0].department).toEqual({
          name: 'Support',
        });

        const [call] = peers.ticket.calls('TicketService/ListTickets');
        expect(
          (call.request as { includeDeleted: boolean }).includeDeleted,
        ).toBe(false);
      },
    );

    rowForField('Query.ticket')(
      '**`Ticket.messages` calls the peer directly — no loader, one call per ticket**',
      async () => {
        const id = '88888888-8888-4888-8888-888888888888';
        peers.ticket.on('TicketService/GetTicket').reply(wireTicket(id));
        peers.ticket.on('MessageService/ListMessages').reply({
          items: [
            {
              id: 'm1',
              ticketId: id,
              senderId: USER,
              content: 'Hello',
              isAiGenerated: false,
              isInternalNote: false,
              excludedFromAiContext: false,
              answerStatus: 0,
              createdAt: { seconds: 1_756_684_800, nanos: 0 },
            },
          ],
          meta: page(1),
        });

        const response = await new Session(gateway.baseUrl).post<{
          data: { ticket: { messages: { id: string; content: string }[] } };
        }>(
          '/graphql',
          { query: `{ ticket(id: "${id}") { messages { id content } } }` },
          headers(),
        );

        expect(response.status).toBe(200);
        expect(response.body).not.toHaveProperty('errors');
        expect(response.body.data.ticket.messages).toEqual([
          { id: 'm1', content: 'Hello' },
        ]);

        const [call] = peers.ticket.calls('MessageService/ListMessages');
        expect((call.request as { ticketId: string }).ticketId).toBe(id);
      },
    );

    rowForField('Mutation.assignTicket')(
      '**`Mutation.assignTicket` assigns, then re-reads the ticket**',
      async () => {
        const id = '99999999-9999-4999-8999-999999999999';
        peers.ticket.on('AssignmentService/AssignTicket').reply({
          id: 'assignment-1',
          ticketId: id,
          assignedToId: USER,
          assignedById: USER,
          departmentId: 'dept-1',
          assignedAt: { seconds: 1_756_684_800, nanos: 0 },
          reason: 1,
          isCurrent: true,
          createdAt: { seconds: 1_756_684_800, nanos: 0 },
        });
        peers.ticket
          .on('TicketService/GetTicket')
          .reply(wireTicket(id, { currentAssigneeId: USER }));

        const response = await new Session(gateway.baseUrl).post<{
          data: {
            assignTicket: {
              message: string;
              ticket: { id: string; currentAssigneeId: string };
            };
          };
        }>(
          '/graphql',
          {
            query: `mutation { assignTicket(id: "${id}", assigneeId: "${USER}", departmentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc") { message ticket { id currentAssigneeId } } }`,
          },
          headers(['ticket.assign']),
        );

        expect(response.status).toBe(200);
        expect(response.body).not.toHaveProperty('errors');
        expect(response.body.data.assignTicket).toEqual({
          message: 'Ticket assigned',
          ticket: { id, currentAssigneeId: USER },
        });
      },
    );

    rowForField('Mutation.escalateTicket')(
      '**`Mutation.escalateTicket` carries no `@RequirePermission`, matching the REST route**',
      async () => {
        const id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
        peers.ticket
          .on('TicketService/EscalateTicket')
          .reply(wireTicket(id, { status: 4 }));

        const response = await new Session(gateway.baseUrl).post<{
          data: { escalateTicket: { message: string } };
        }>(
          '/graphql',
          { query: `mutation { escalateTicket(id: "${id}") { message } }` },
          headers(),
        );

        expect(response.status).toBe(200);
        expect(response.body).not.toHaveProperty('errors');
        expect(response.body.data.escalateTicket.message).toBe(
          'Handed off to an agent',
        );
      },
    );

    rowForField('Mutation.transitionTicketStatus')(
      '**`Mutation.transitionTicketStatus` sends the status and reason**',
      async () => {
        const id = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';
        peers.ticket
          .on('TicketService/ChangeTicketStatus')
          .reply(wireTicket(id, { status: 5 }));

        const response = await new Session(gateway.baseUrl).post<{
          data: { transitionTicketStatus: { ticket: { status: string } } };
        }>(
          '/graphql',
          {
            query: `mutation { transitionTicketStatus(id: "${id}", status: RESOLVED, reason: "fixed") { ticket { status } } }`,
          },
          headers(['ticket.update']),
        );

        expect(response.status).toBe(200);
        expect(response.body).not.toHaveProperty('errors');
        expect(response.body.data.transitionTicketStatus.ticket.status).toBe(
          'RESOLVED',
        );

        const [call] = peers.ticket.calls('TicketService/ChangeTicketStatus');
        expect((call.request as { reason: string }).reason).toBe('fixed');
      },
    );
  });

  describe('Analytics', () => {
    rowForField('Query.analyticsOverview')(
      '**`Query.analyticsOverview` maps the wire response**',
      async () => {
        peers.ticket.on('AnalyticsService/GetOverview').reply({
          ticketsCreated: 10,
          ticketsResolved: 8,
          ticketsEscalated: 1,
          openTickets: 2,
          deflection: { rate: 0.5, numerator: 5, denominator: 10 },
          csat: { rate: 0.9, numerator: 9, denominator: 10 },
          humanFirstResponseSeconds: { mean: 120, count: 8 },
          aiFirstResponseSeconds: { mean: 30, count: 2 },
          resolutionSeconds: { mean: 3600, count: 8 },
          dataThrough: '2024-01-01',
        });

        const response = await new Session(gateway.baseUrl).post<{
          data: {
            analyticsOverview: {
              ticketsCreated: number;
              csat: { rate: number };
            };
          };
        }>(
          '/graphql',
          {
            query:
              '{ analyticsOverview(from: "2027-01-01", to: "2027-01-01") { ticketsCreated csat { rate } } }',
          },
          headers(['analytics.read']),
        );

        expect(response.status).toBe(200);
        expect(response.body).not.toHaveProperty('errors');
        expect(response.body.data.analyticsOverview).toEqual({
          ticketsCreated: 10,
          csat: { rate: 0.9 },
        });
      },
    );

    rowForField('Query.analyticsAgents')(
      '**`Query.analyticsAgents` never calls auth-service; `AgentStat.agent` resolves through the users loader**',
      async () => {
        // A user id touched by NO other row: `loaders.users` is backed by its
        // own Redis entity cache (`entityScope('user', id)`, 5-minute TTL,
        // shared across every edge that resolves a `UserSummary` — Ticket's
        // `assignee`/`author` above included), so reusing `USER` here would
        // read a warm cache entry left by an earlier test and record ZERO
        // peer calls for reasons that have nothing to do with this field.
        const AGENT = 'eeeeeeee-2222-4222-8222-eeeeeeeeeeee';
        peers.ticket.on('AnalyticsService/GetAgentStats').reply({
          items: [
            {
              agentId: AGENT,
              assigned: 5,
              resolved: 3,
              messagesSent: 20,
              resolutionSeconds: { mean: 1800, count: 3 },
            },
          ],
          dataThrough: '2024-01-01',
        });
        peers.ingestion.on('AiLedgerService/GetAiUsage').reply({ points: [] });
        peers.auth.on('UserService/ListUsersByIds').reply({
          items: [],
          summaries: [
            { userId: AGENT, fullName: 'Ada Lovelace', isLocked: false },
          ],
        });

        const response = await new Session(gateway.baseUrl).post<{
          data: {
            analyticsAgents: {
              items: { agentId: string; agent: { fullName: string } }[];
            };
          };
        }>(
          '/graphql',
          {
            query:
              '{ analyticsAgents(from: "2027-02-01", to: "2027-02-02") { items { agentId agent { fullName } } } }',
          },
          headers(['analytics.read']),
        );

        expect(response.status).toBe(200);
        expect(response.body).not.toHaveProperty('errors');
        expect(response.body.data.analyticsAgents.items[0].agent).toEqual({
          fullName: 'Ada Lovelace',
        });
        // The whole point of `hydrateNames: false`'s Java equivalent: this
        // query never hit auth-service on its OWN leg — only the loader
        // call the `agent` edge above just made.
        expect(peers.auth.calls('UserService/ListUsersByIds')).toHaveLength(1);
      },
    );

    rowForField('Query.analyticsAgents')(
      '**a failed leg does not fail the request** — the block is marked unavailable, not an error',
      async () => {
        peers.ticket.on('AnalyticsService/GetAgentStats').reply({
          items: [
            {
              agentId: USER,
              assigned: 1,
              resolved: 1,
              messagesSent: 1,
              resolutionSeconds: { count: 0 },
            },
          ],
          dataThrough: '2024-01-01',
        });
        // `ingestion-service`'s leg is left unprogrammed — the fake peer
        // answers UNIMPLEMENTED for it alone, the shape a real single-service
        // outage takes.

        const response = await new Session(gateway.baseUrl).post<{
          data: {
            analyticsAgents: {
              items: { draftAcceptance: unknown }[];
              unavailable: { source: string }[];
            };
          };
        }>(
          '/graphql',
          {
            query:
              '{ analyticsAgents(from: "2027-02-03", to: "2027-02-04") { items { draftAcceptance { rate } } unavailable { source } } }',
          },
          headers(['analytics.read']),
        );

        expect(response.status).toBe(200);
        expect(response.body).not.toHaveProperty('errors');
        expect(
          response.body.data.analyticsAgents.items[0].draftAcceptance,
        ).toBeNull();
        expect(response.body.data.analyticsAgents.unavailable).toEqual([
          { source: 'ingestion-service' },
        ]);
      },
    );

    rowForField('Query.analyticsDocuments')(
      '**`Query.analyticsDocuments` merges citation accuracy from the satisfaction leg, and `DocumentUsage.document` batches through the documents loader**',
      async () => {
        peers.ingestion.on('AiLedgerService/GetDocumentAnalytics').reply({
          mostCited: [
            {
              documentId: 'd1',
              title: 'Onboarding',
              retrievalCount: 10,
              citationCount: 8,
              chunkCount: 4,
            },
          ],
          neverRetrieved: [],
          retrievedNeverCited: [],
          dataThrough: '2024-01-01',
        });
        peers.ticket.on('AnalyticsService/GetSatisfaction').reply({
          points: [],
          csatTotal: { numerator: 0, denominator: 0 },
          citationAccuracyTotal: { rate: 0.75, numerator: 3, denominator: 4 },
          dataThrough: '2024-01-01',
        });
        peers.ingestion.on('DocumentService/ListDocumentsByIds').reply({
          items: [
            {
              id: 'd1',
              organizationId: ORGANIZATION,
              createdById: USER,
              title: 'Onboarding',
              fileUrl: 'documents/org/onboarding.pdf',
              fileType: 1,
              fileSizeBytes: 1024,
              isOrganizationWide: true,
              status: 3,
              departmentIds: [],
              chunkCount: 4,
              ocrLanguages: [],
              createdAt: { seconds: 1_756_684_800, nanos: 0 },
              updatedAt: { seconds: 1_756_684_800, nanos: 0 },
            },
          ],
        });

        const response = await new Session(gateway.baseUrl).post<{
          data: {
            analyticsDocuments: {
              citationAccuracy: { rate: number };
              mostCited: { documentId: string; document: { title: string } }[];
            };
          };
        }>(
          '/graphql',
          {
            query:
              '{ analyticsDocuments(limit: 10) { citationAccuracy { rate } mostCited { documentId document { title } } } }',
          },
          headers(['analytics.read']),
        );

        expect(response.status).toBe(200);
        expect(response.body).not.toHaveProperty('errors');
        expect(response.body.data.analyticsDocuments.citationAccuracy).toEqual({
          rate: 0.75,
        });
        expect(
          response.body.data.analyticsDocuments.mostCited[0].document,
        ).toEqual({ title: 'Onboarding' });
      },
    );

    rowForField('Query.analyticsKnowledgeGaps')(
      '**`Query.analyticsKnowledgeGaps` maps the document flag type off the wire, and `KnowledgeGapFlag.document` batches through the documents loader**',
      async () => {
        peers.ingestion.on('AiLedgerService/GetKnowledgeGaps').reply({
          emptyRetrievals: 3,
          answeringGenerations: 10,
          emptyRetrievalRate: { rate: 0.3, numerator: 3, denominator: 10 },
          attachmentGroundedRate: { numerator: 0, denominator: 0 },
          attachmentEmptyRetrievals: 0,
          flags: [
            {
              documentId: 'd2',
              documentTitle: 'Refund policy',
              flagType: 3, // DOCUMENT_FLAG_TYPE_UNCITED
              detail: 'Retrieved 12 times, cited 0',
            },
          ],
          dataThrough: '2024-01-01',
        });
        peers.ingestion.on('DocumentService/ListDocumentsByIds').reply({
          items: [
            {
              id: 'd2',
              organizationId: ORGANIZATION,
              createdById: USER,
              title: 'Refund policy',
              fileUrl: 'documents/org/refund.pdf',
              fileType: 1,
              fileSizeBytes: 1024,
              isOrganizationWide: true,
              status: 3,
              departmentIds: [],
              chunkCount: 2,
              ocrLanguages: [],
              createdAt: { seconds: 1_756_684_800, nanos: 0 },
              updatedAt: { seconds: 1_756_684_800, nanos: 0 },
            },
          ],
        });

        const response = await new Session(gateway.baseUrl).post<{
          data: {
            analyticsKnowledgeGaps: {
              flags: {
                flagType: string;
                detail: string;
                document: { title: string };
              }[];
            };
          };
        }>(
          '/graphql',
          {
            query:
              '{ analyticsKnowledgeGaps(from: "2027-03-01", to: "2027-03-02", limit: 10) { flags { flagType detail document { title } } } }',
          },
          headers(['analytics.read']),
        );

        expect(response.status).toBe(200);
        expect(response.body).not.toHaveProperty('errors');
        expect(response.body.data.analyticsKnowledgeGaps.flags[0]).toEqual({
          flagType: 'UNCITED',
          detail: 'Retrieved 12 times, cited 0',
          document: { title: 'Refund policy' },
        });
      },
    );
  });
});
