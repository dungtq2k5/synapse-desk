/**
 * @file **An enum field the peer always fills refuses the zero value**: one row per
 * enum type the document publishes as never null.
 *
 * Each peer writes these from the contracts enum, so `UNSPECIFIED` (or a number the
 * gateway doesn't know) on the wire is the peer's bug. The gateway answers 502 naming
 * the field rather than mapping it to `null`, which would publish a value the document
 * says can't happen and hide the bug in a list that looks fine.
 *
 * Every row reads as a fresh tenant, so no cached read answers in place of the peer.
 */

import { randomUUID } from 'node:crypto';
import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/contracts';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

const USER = 'dddddddd-2222-4222-8222-dddddddddddd';
const ID = 'dddddddd-5555-4555-8555-dddddddddddd';
const AT = { seconds: 1_756_684_800, nanos: 0 };

const CODES = [
  'analytics.read',
  'audit.read',
  'document.read',
  'document.update',
  'organization.read',
];

const cookie = () => ({
  cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
    {
      sub: USER,
      organizationId: randomUUID(),
      isSuperAdmin: false,
      departmentIds: [],
      permissionCodes: CODES,
      isEmailVerified: true,
    },
    TEST_KEYS.access(),
    { algorithm: 'RS256', expiresIn: '15m' },
  )}`,
});

const ticket = (overrides: Record<string, unknown>) => ({
  id: ID,
  ticketNumber: 42,
  organizationId: ID,
  authorId: USER,
  source: 1,
  status: 1,
  priority: 2,
  title: 'Printer is on fire',
  description: 'It is genuinely on fire',
  unreadCount: 0,
  createdAt: AT,
  updatedAt: AT,
  ...overrides,
});

const preference = (overrides: Record<string, unknown>) => ({
  type: '*',
  channel: 2,
  isEnabled: true,
  digest: 1,
  source: 3,
  ...overrides,
});

type Case = {
  /** The enum type, and the field the row zeroes. */
  name: string;
  field: string;
  program: (peers: Peers) => void;
  call: (session: Session) => Promise<{ status: number; body: unknown }>;
};

const get = (path: string) => (session: Session) =>
  session.get(`${API}${path}`, cookie());

const CASES: Case[] = [
  {
    name: 'TicketSource',
    field: 'source',
    program: (peers) =>
      peers.ticket.on('TicketService/GetTicket').reply(ticket({ source: 0 })),
    call: get(`/chat/conversations/${ID}`),
  },
  {
    name: 'TicketStatus',
    field: 'status',
    program: (peers) =>
      peers.ticket.on('TicketService/GetTicket').reply(ticket({ status: 0 })),
    call: get(`/chat/conversations/${ID}`),
  },
  {
    name: 'TicketPriority',
    field: 'priority',
    program: (peers) =>
      peers.ticket.on('TicketService/GetTicket').reply(ticket({ priority: 0 })),
    call: get(`/chat/conversations/${ID}`),
  },
  {
    name: 'ReassignmentReason',
    field: 'reason',
    program: (peers) =>
      peers.ticket.on('AssignmentService/ListAssignments').reply({
        items: [
          {
            id: ID,
            ticketId: ID,
            assignedToId: USER,
            assignedById: USER,
            departmentId: ID,
            assignedAt: AT,
            reason: 0,
            isCurrent: true,
            createdAt: AT,
          },
        ],
      }),
    call: get(`/tickets/${ID}/assignments`),
  },
  {
    name: 'DevicePlatform',
    field: 'platform',
    program: (peers) =>
      peers.notification
        .on('NotificationService/RegisterDevice')
        .reply({ id: ID, platform: 0, createdAt: AT }),
    call: (session) =>
      session.post(
        `${API}/notifications/devices`,
        { token: 'fcm-token-abc123', platform: 'IOS' },
        cookie(),
      ),
  },
  ...(['flagType', 'severity'] as const).map((field): Case => ({
    name: field === 'flagType' ? 'DocumentFlagType' : 'DocumentFlagSeverity',
    field,
    program: (peers) =>
      peers.ingestion.on('DocumentService/ResolveDocumentFlag').reply({
        id: ID,
        documentId: ID,
        documentTitle: 'Refund policy',
        flagType: 1,
        severity: 2,
        [field]: 0,
        detail: 'Not retrieved in 90 days',
        detectedAt: AT,
        resolution: 2,
      }),
    call: (session) =>
      session.post(
        `${API}/documents/flags/${ID}/dismiss`,
        { comment: 'Reviewed' },
        cookie(),
      ),
  })),
  {
    name: 'DocumentStatus',
    field: 'status',
    program: (peers) =>
      peers.ingestion
        .on('DocumentService/GetDocument')
        .reply({ id: ID, title: 'Refund policy', status: 0 }),
    call: get(`/documents/${ID}`),
  },
  {
    name: 'IngestionJobStatus',
    field: 'status',
    program: (peers) =>
      peers.ingestion
        .on('DocumentService/GetIngestionJob')
        .reply({ id: ID, documentId: ID, status: 0, createdAt: AT }),
    call: get(`/ingestion-jobs/${ID}`),
  },
  ...(['status', 'kind'] as const).map((field): Case => ({
    name: field === 'status' ? 'ExportStatus' : 'ExportKind',
    field,
    program: (peers) =>
      peers.ticket.on('AnalyticsService/GetExport').reply({
        id: ID,
        status: 2,
        kind: 1,
        [field]: 0,
        createdAt: AT,
      }),
    call: get(`/analytics/export/${ID}`),
  })),
  {
    name: 'AnswerStatus',
    field: 'status',
    program: (peers) =>
      peers.rag.on('RagService/Ask').reply({
        content: 'The refund window is 30 days.',
        status: 0,
        citations: [],
        generationId: 'gen-1',
      }),
    call: (session) =>
      session.post(
        `${API}/knowledge/ask`,
        { message: 'what is the refund policy?' },
        cookie(),
      ),
  },
  {
    name: 'OrgStatus',
    field: 'status',
    program: (peers) =>
      peers.auth
        .on('OrganizationService/GetCurrentOrganization')
        .reply({ id: ID, name: 'Acme', slug: 'acme', status: 0 }),
    call: get('/organizations/current'),
  },
  {
    name: 'AiModelTier',
    field: 'aiModelTier',
    program: (peers) => {
      peers.auth.on('OrganizationService/GetOrganizationUsage').reply({
        seats: { available: true, used: 3, limit: 10 },
        aiTokens: { available: false },
        billingCycleStart: AT,
        aiModelTier: 0,
        planName: 'Pro',
      });
      peers.ingestion.on('DocumentService/GetStorageUsage').reply({
        usedBytes: '500',
        limitBytes: '1000000000',
        documentCount: 4,
      });
    },
    call: get('/organizations/current/usage'),
  },
  ...(
    [
      ['PreferenceType', 'type', ''],
      ['NotificationChannel', 'channel', 0],
      ['DigestMode', 'digest', 0],
      ['PreferenceSource', 'source', 0],
    ] as const
  ).map(([name, field, zero]): Case => ({
    name,
    field,
    program: (peers) =>
      peers.notification
        .on('NotificationService/ListPreferences')
        .reply({ items: [preference({ [field]: zero })] }),
    call: get('/notifications/preferences'),
  })),
  {
    name: 'AuditAction',
    field: 'action',
    program: (peers) =>
      peers.ticket.on('AuditService/ListAuditLogs').reply({
        items: [
          {
            id: 'log-1',
            organizationId: ID,
            userId: USER,
            action: 0,
            resourceType: 'AUDIT_RESOURCE_TYPE_USER',
            metadata: '{}',
            createdAt: AT,
          },
        ],
        meta: {
          totalItems: 1,
          itemCount: 1,
          itemsPerPage: 10,
          totalPages: 1,
          currentPage: 1,
        },
      }),
    call: get('/audit-logs'),
  },
  ...(['type', 'priority'] as const).map((field): Case => ({
    name: field === 'type' ? 'NotificationType' : 'NotificationPriority',
    field,
    program: (peers) =>
      peers.notification.on('NotificationService/ListNotifications').reply({
        items: [
          {
            id: ID,
            organizationId: ID,
            type: 1,
            priority: 2,
            [field]: 0,
            title: 'Ticket #42 assigned to you',
            data: '{}',
            resourceType: 1,
            groupCount: 1,
            createdAt: AT,
          },
        ],
        hasMore: false,
      }),
    call: get('/notifications'),
  })),
  {
    name: 'WebhookDeliveryStatus',
    field: 'status',
    program: (peers) =>
      peers.notification.on('NotificationService/ListWebhookDeliveries').reply({
        items: [
          {
            id: 'del-1',
            eventId: 'evt-1',
            eventType: 'ticket.assigned',
            status: 0,
            attempts: 1,
            occurredAt: AT,
          },
        ],
      }),
    call: get(`/webhook-endpoints/${ID}/deliveries?limit=25`),
  },
];

describe('an enum field the peer always fills', () => {
  let gateway: Gateway;
  let peers: Peers;

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

  rowFor('Ops').each(CASES.map((c) => [c.name, c.field] as const))(
    '**%s: the zero value for `%s` is a 502 naming the field, not a null**',
    async (name) => {
      const testCase = CASES.find((c) => c.name === name)!;
      testCase.program(peers);

      const response = await testCase.call(new Session(gateway.baseUrl));

      expect(response.status).toBe(502);
      expect((response.body as { error: string }).error).toContain(
        ` for ${testCase.field},`,
      );
    },
  );
});
