/**
 * @file `ChatApi` — a thin wrapper over the SAME `TicketService`/`MessageService`
 * RPCs `TicketsApi`/`MessagesApi` would use, plus the two values a port passes
 * through silently unless a row reads what the peer actually received:
 * `source = CHAT` forced on every write here, and `isInternalNote` forced
 * false on `sendMessage` regardless of what the body claims.
 */

import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('chat', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = '11111111-1111-4111-8111-111111111111';
  const USER = '22222222-2222-4222-8222-222222222222';
  const TICKET = '55555555-5555-4555-8555-555555555555';

  const accessToken = () =>
    sign(
      {
        sub: USER,
        organizationId: ORGANIZATION,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes: [],
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    );

  const cookie = () => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${accessToken()}`,
  });

  const wireTicket = (overrides: Record<string, unknown> = {}) => ({
    id: TICKET,
    ticketNumber: 42,
    organizationId: ORGANIZATION,
    authorId: USER,
    source: 2, // TICKET_SOURCE_CHAT
    status: 1, // TICKET_STATUS_NEW
    priority: 2, // TICKET_PRIORITY_MEDIUM
    title: 'Printer is on fire',
    description: 'It is genuinely on fire',
    unreadCount: 0,
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
    updatedAt: { seconds: 1_756_684_800, nanos: 0 },
    ...overrides,
  });

  const wireMessage = (overrides: Record<string, unknown> = {}) => ({
    id: '66666666-6666-4666-8666-666666666666',
    ticketId: TICKET,
    senderId: USER,
    content: 'Any update?',
    isAiGenerated: false,
    isInternalNote: false,
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
    attachments: [],
    excludedFromAiContext: false,
    answerStatus: 0, // MESSAGE_ANSWER_STATUS_UNSPECIFIED
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

  rowFor('Chat')(
    '**starting a conversation forces `source = CHAT`**, not a value the client sent',
    async () => {
      peers.ticket.on('TicketService/CreateTicket').reply(wireTicket());

      const response = await new Session(gateway.baseUrl).post(
        `${API}/chat/conversations`,
        { title: 'Printer is on fire', message: 'It is genuinely on fire' },
        cookie(),
      );

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ data: { source: 'CHAT' } });

      const [call] = peers.ticket.calls('TicketService/CreateTicket');
      // 2 = TICKET_SOURCE_CHAT on the wire — the field the client cannot see
      // or set, forced at the controller rather than accepted from the body.
      expect(call.request).toMatchObject({
        source: 2,
        title: 'Printer is on fire',
      });
    },
  );

  rowFor('Chat')(
    '**list is pinned to the caller’s OWN conversations** — `authorId` cannot be overridden',
    async () => {
      peers.ticket.on('TicketService/ListTickets').reply({
        items: [wireTicket()],
        meta: {
          totalItems: 1,
          itemCount: 1,
          itemsPerPage: 10,
          totalPages: 1,
          currentPage: 1,
        },
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/chat/conversations`,
        cookie(),
      );

      expect(response.status).toBe(200);

      const [call] = peers.ticket.calls('TicketService/ListTickets');
      expect(call.request).toMatchObject({
        source: 2,
        authorId: USER,
        includeDeleted: false,
      });
    },
  );

  rowFor('Chat')('get returns one own conversation', async () => {
    peers.ticket.on('TicketService/GetTicket').reply(wireTicket());

    const response = await new Session(gateway.baseUrl).get(
      `${API}/chat/conversations/${TICKET}`,
      cookie(),
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: { id: TICKET, title: 'Printer is on fire' },
    });
  });

  rowFor('Chat')(
    'the thread lists messages, citations absent for a human message',
    async () => {
      peers.ticket.on('MessageService/ListMessages').reply({
        items: [wireMessage()],
        meta: {
          totalItems: 1,
          itemCount: 1,
          itemsPerPage: 10,
          totalPages: 1,
          currentPage: 1,
        },
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/chat/conversations/${TICKET}/messages`,
        cookie(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { items: [{ content: 'Any update?', isAiGenerated: false }] },
      });
      // Absent, not `[]`: a human message never had citations to begin with —
      // the distinction `message.mapper.ts` draws between the wrapper being
      // absent and being present-but-empty.
      expect(
        (response.body as { data: { items: Array<{ citations: unknown }> } })
          .data.items[0].citations,
      ).toBeNull();
    },
  );

  rowFor('Chat')(
    '**`isInternalNote` is forced false**, regardless of what the body sent',
    async () => {
      peers.ticket.on('MessageService/CreateMessage').reply({
        message: wireMessage({ content: 'Trying to sneak a note in' }),
        skippedAttachments: [],
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/chat/conversations/${TICKET}/messages`,
        // A chat client's own shape carries no `isInternalNote` field at all —
        // it is sent here only to prove the server does not trust one if it
        // arrived, since `CreateMessageDto` would happily parse it.
        { content: 'Trying to sneak a note in', isInternalNote: true },
        cookie(),
      );

      expect(response.status).toBe(201);

      const [call] = peers.ticket.calls('MessageService/CreateMessage');
      expect(call.request).toMatchObject({ isInternalNote: false });
    },
  );

  rowFor('Chat')(
    '**escalate is a literal alias**, answering 200 — not 201 like a create',
    async () => {
      peers.ticket.on('TicketService/EscalateTicket').reply(
        wireTicket({
          status: 4,
          escalatedAt: { seconds: 1_756_684_900, nanos: 0 },
        }),
      );

      const response = await new Session(gateway.baseUrl).post(
        `${API}/chat/conversations/${TICKET}/escalate`,
        {},
        cookie(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: { status: 'ESCALATED' } });

      const [call] = peers.ticket.calls('TicketService/EscalateTicket');
      // `{}`, no chat-specific reason — a literal alias of
      // `POST /tickets/:id/escalate`, asserted as one.
      expect(call.request).toMatchObject({ ticketId: TICKET });
      expect(call.request.reason).toBeUndefined();
    },
  );
});
