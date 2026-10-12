/**
 * @file **REST responses name the people and the department a ticket or message
 * refers to**, beside the ids: a ticket's `author`, `assignee` and `department`, a
 * message's `sender`.
 *
 * The names come from auth-service, one `ListUsersByIds` and one
 * `ListDepartmentsByIds` per response, and a lookup that fails leaves them `null`
 * rather than failing the response. An AI message has no `sender`: no user wrote it.
 */
import { status as GrpcStatus } from '@grpc/grpc-js';
import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/contracts';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('REST responses carry names', () => {
  let gateway: Gateway;
  let peers: Peers;

  const TICKET = '11111111-1111-4111-8111-111111111111';
  const ORGANIZATION = 'cccccccc-0000-4000-8000-cccccccccccc';
  const AUTHOR = 'bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb';
  const DEPARTMENT = 'eeeeeeee-4444-4444-8444-eeeeeeeeeeee';

  const headers = () => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
      {
        sub: AUTHOR,
        organizationId: ORGANIZATION,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes: [],
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
    authorId: AUTHOR,
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

  const wireMessage = (
    id: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    id,
    ticketId: TICKET,
    content: 'Hello, I need a refund.',
    isAiGenerated: false,
    isInternalNote: false,
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
    attachments: [],
    excludedFromAiContext: false,
    answerStatus: 'MESSAGE_ANSWER_STATUS_UNSPECIFIED',
    ...overrides,
  });

  const names = () => {
    peers.auth.on('UserService/ListUsersByIds').reply({
      summaries: [{ userId: AUTHOR, fullName: 'Ada Lovelace' }],
    });
    peers.auth.on('DepartmentService/ListDepartmentsByIds').reply({
      items: [{ id: DEPARTMENT, name: 'Support' }],
    });
  };

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

  rowFor('Tickets')(
    '**a listed ticket names its author and department**; an unassigned one has `assignee: null`',
    async () => {
      peers.ticket.on('TicketService/ListTickets').reply({
        items: [wireTicket({ currentDepartmentId: DEPARTMENT })],
        meta: { totalItems: 1 },
      });
      names();

      const response = await new Session(gateway.baseUrl).get(
        `${API}/tickets`,
        headers(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: {
          items: [
            {
              authorId: AUTHOR,
              author: { id: AUTHOR, fullName: 'Ada Lovelace', avatarUrl: null },
              assignee: null,
              department: { id: DEPARTMENT, name: 'Support' },
            },
          ],
        },
      });
      // One lookup of each kind, in the caller's tenant.
      const [lookup] = peers.auth.calls('UserService/ListUsersByIds');
      expect(lookup.request).toMatchObject({
        organizationId: ORGANIZATION,
        userIds: [AUTHOR],
        includeInactive: true,
      });
      expect(
        peers.auth.calls('DepartmentService/ListDepartmentsByIds'),
      ).toHaveLength(1);
    },
  );

  rowFor('Tickets')(
    '**auth-service failing the lookup still answers 200**, with the names `null`',
    async () => {
      peers.ticket.on('TicketService/ListTickets').reply({
        items: [wireTicket({ currentDepartmentId: DEPARTMENT })],
        meta: { totalItems: 1 },
      });
      peers.auth
        .on('UserService/ListUsersByIds')
        .fail(GrpcStatus.UNAVAILABLE, 'auth-service is down');
      peers.auth
        .on('DepartmentService/ListDepartmentsByIds')
        .fail(GrpcStatus.UNAVAILABLE, 'auth-service is down');

      const response = await new Session(gateway.baseUrl).get(
        `${API}/tickets`,
        headers(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: {
          items: [
            {
              authorId: AUTHOR,
              author: null,
              assignee: null,
              department: null,
            },
          ],
        },
      });
    },
  );

  rowFor('Messages')(
    '**a human message names its sender; an AI message has `sender: null`**',
    async () => {
      peers.ticket.on('MessageService/ListMessages').reply({
        items: [
          wireMessage('m-1', { senderId: AUTHOR }),
          wireMessage('m-2', { isAiGenerated: true, modelName: 'gemini' }),
        ],
        meta: { totalItems: 2 },
      });
      names();

      const response = await new Session(gateway.baseUrl).get(
        `${API}/tickets/${TICKET}/messages`,
        headers(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: {
          items: [
            { id: 'm-1', sender: { id: AUTHOR, fullName: 'Ada Lovelace' } },
            { id: 'm-2', sender: null },
          ],
        },
      });
    },
  );

  rowFor('Chat')(
    '**a conversation names its author**, as a ticket does',
    async () => {
      peers.ticket.on('TicketService/ListTickets').reply({
        items: [wireTicket({ source: 2 })], // TICKET_SOURCE_CHAT
        meta: { totalItems: 1 },
      });
      names();

      const response = await new Session(gateway.baseUrl).get(
        `${API}/chat/conversations`,
        headers(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: {
          items: [{ author: { id: AUTHOR, fullName: 'Ada Lovelace' } }],
        },
      });
    },
  );
});
