/**
 * @file `documents`, `ingestion-jobs` and `notifications` — the first
 * loaders beyond `ticket-messages`'s users loader.
 *
 * Two properties get their first real row here: `Document.departments` is
 * where `MAX_EDGE_LIST` gets its truncation row (ported earlier with nothing
 * reading it), and `IngestionJob.document` is the documents loader's own
 * batching proof.
 */

import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';

describe('documents, ingestion jobs and notifications', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = '99999999-9999-4999-8999-999999999999';
  const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const MAX_EDGE_LIST = 50;

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

  const wireDocument = (
    id: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    id,
    organizationId: ORGANIZATION,
    createdById: USER,
    title: 'Employee Handbook',
    fileUrl: 'documents/org/handbook.pdf',
    fileType: 1, // DOCUMENT_FILE_TYPE_PDF
    fileSizeBytes: 1024,
    isOrganizationWide: true,
    status: 3, // DOCUMENT_STATUS_INDEXED
    departmentIds: [],
    chunkCount: 4,
    ocrLanguages: [],
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

  describe('Documents', () => {
    it('**`Query.document` resolves one document**', async () => {
      const id = '55555555-5555-4555-8555-555555555555';
      peers.ingestion.on('DocumentService/GetDocument').reply(wireDocument(id));

      const response = await new Session(gateway.baseUrl).post<{
        data: { document: { id: string; title: string; fileType: string } };
      }>(
        '/graphql',
        { query: `{ document(id: "${id}") { id title fileType } }` },
        headers(['document.read']),
      );

      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('errors');
      expect(response.body.data.document).toEqual({
        id,
        title: 'Employee Handbook',
        fileType: 'pdf',
      });
    });

    it('**`Query.documents` resolves a page, and `createdBy` batches through the users loader**', async () => {
      const id = '66666666-6666-4666-8666-666666666666';
      peers.ingestion.on('DocumentService/ListDocuments').reply({
        items: [wireDocument(id)],
        meta: page(1),
      });
      peers.auth.on('UserService/ListUsersByIds').reply({
        items: [],
        summaries: [
          { userId: USER, fullName: 'Ada Lovelace', isLocked: false },
        ],
      });

      const response = await new Session(gateway.baseUrl).post<{
        data: {
          documents: {
            items: { id: string; createdBy: { fullName: string } }[];
          };
        };
      }>(
        '/graphql',
        {
          query:
            '{ documents(first: 10, page: 1) { items { id createdBy { fullName } } } }',
        },
        headers(['document.read']),
      );

      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('errors');
      expect(response.body.data.documents.items[0].createdBy).toEqual({
        fullName: 'Ada Lovelace',
      });
    });

    it('**`Document.departments` truncates at MAX_EDGE_LIST, `departmentCount` reports the true total**', async () => {
      const id = '77777777-7777-4777-8777-777777777777';
      const departmentIds = Array.from(
        { length: 251 },
        (_, index) =>
          `88888888-8888-4888-8888-${String(index).padStart(12, '0')}`,
      );
      peers.ingestion
        .on('DocumentService/GetDocument')
        .reply(wireDocument(id, { departmentIds }));
      // Sliced BEFORE the batch, so the peer receives exactly the first 50.
      peers.auth.on('DepartmentService/ListDepartmentsByIds').reply({
        items: departmentIds.slice(0, MAX_EDGE_LIST).map((deptId) => ({
          id: deptId,
          name: `Department ${deptId.slice(0, 8)}`,
          description: undefined,
        })),
      });

      const response = await new Session(gateway.baseUrl).post<{
        data: {
          document: {
            departments: { id: string }[];
            departmentCount: number;
          };
        };
      }>(
        '/graphql',
        {
          query: `{ document(id: "${id}") { departments { id } departmentCount } }`,
        },
        headers(['document.read']),
      );

      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('errors');
      expect(response.body.data.document.departments).toHaveLength(
        MAX_EDGE_LIST,
      );
      expect(response.body.data.document.departmentCount).toBe(251);

      const [call] = peers.auth.calls('DepartmentService/ListDepartmentsByIds');
      expect(
        (call.request as { departmentIds: string[] }).departmentIds,
      ).toHaveLength(MAX_EDGE_LIST);
    });
  });

  describe('Ingestion jobs', () => {
    it('**`Query.ingestionJob` resolves one attempt**', async () => {
      const id = '99999999-9999-4999-8999-999999999999';
      const documentId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
      peers.ingestion.on('DocumentService/GetIngestionJob').reply({
        id,
        documentId,
        bullmqJobId: 'bull-1',
        status: 5, // INGESTION_JOB_STATUS_COMPLETED
        errorLog: '',
        processedAt: { seconds: 1_756_684_800, nanos: 0 },
        createdAt: { seconds: 1_756_684_800, nanos: 0 },
      });

      const response = await new Session(gateway.baseUrl).post<{
        data: { ingestionJob: { id: string; status: string } };
      }>(
        '/graphql',
        { query: `{ ingestionJob(id: "${id}") { id status } }` },
        headers(['document.read']),
      );

      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('errors');
      expect(response.body.data.ingestionJob).toEqual({
        id,
        status: 'COMPLETED',
      });
    });

    it('**25 jobs resolving `document` make exactly ONE batched call**', async () => {
      const documentIds = Array.from(
        { length: 25 },
        (_, index) =>
          `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, '0')}`,
      );
      peers.ingestion.on('DocumentService/ListIngestionJobs').reply({
        items: documentIds.map((documentId, index) => ({
          id: `job-${index}`,
          documentId,
          bullmqJobId: `bull-${index}`,
          status: 3,
          errorLog: '',
          processedAt: { seconds: 1_756_684_800, nanos: 0 },
          createdAt: { seconds: 1_756_684_800, nanos: 0 },
        })),
        meta: page(25),
      });
      peers.ingestion.on('DocumentService/ListDocumentsByIds').reply({
        items: documentIds.map((id) =>
          wireDocument(id, { title: `Doc ${id.slice(0, 8)}` }),
        ),
      });

      const response = await new Session(gateway.baseUrl).post<{
        data: {
          ingestionJobs: {
            items: { id: string; document: { title: string } }[];
          };
        };
      }>(
        '/graphql',
        {
          query:
            '{ ingestionJobs(first: 25) { items { id documentId document { title } } } }',
        },
        headers(['document.read']),
      );

      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('errors');
      expect(response.body.data.ingestionJobs.items).toHaveLength(25);
      expect(
        peers.ingestion.calls('DocumentService/ListDocumentsByIds'),
      ).toHaveLength(1);
    });
  });

  describe('Notifications', () => {
    it('**`Query.notifications` resolves the feed, and `actor` batches through the users loader**', async () => {
      peers.notification.on('NotificationService/ListNotifications').reply({
        items: [
          {
            id: 'cccccccc-1111-4111-8111-cccccccccccc',
            organizationId: ORGANIZATION,
            type: 1,
            priority: 1,
            title: 'Ticket assigned',
            body: undefined,
            data: '',
            actionUrl: undefined,
            actorId: USER,
            resourceType: 1,
            resourceId: undefined,
            groupKey: undefined,
            groupCount: 1,
            readAt: undefined,
            archivedAt: undefined,
            createdAt: { seconds: 1_756_684_800, nanos: 0 },
          },
        ],
        nextCursor: undefined,
        hasMore: false,
      });
      peers.auth.on('UserService/ListUsersByIds').reply({
        items: [],
        summaries: [
          { userId: USER, fullName: 'Ada Lovelace', isLocked: false },
        ],
      });

      const response = await new Session(gateway.baseUrl).post<{
        data: {
          notifications: {
            items: {
              id: string;
              title: string;
              actor: { fullName: string };
            }[];
            hasMore: boolean;
          };
        };
      }>(
        '/graphql',
        {
          query:
            '{ notifications(first: 20) { items { id title actor { fullName } } hasMore } }',
        },
        headers(),
      );

      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('errors');
      expect(response.body.data.notifications.items[0].actor).toEqual({
        fullName: 'Ada Lovelace',
      });
    });

    it('**`Query.unreadNotificationCount` resolves a number, not a list**', async () => {
      peers.notification
        .on('NotificationService/GetUnreadCount')
        .reply({ count: 4 });

      const response = await new Session(gateway.baseUrl).post<{
        data: { unreadNotificationCount: number };
      }>('/graphql', { query: '{ unreadNotificationCount }' }, headers());

      expect(response.status).toBe(200);
      expect(response.body.data.unreadNotificationCount).toBe(4);
    });

    it('**`Mutation.markNotificationRead` returns the new badge, idempotently**', async () => {
      peers.notification.on('NotificationService/MarkRead').reply({
        updated: 1,
        unreadCount: 3,
      });

      const response = await new Session(gateway.baseUrl).post<{
        data: { markNotificationRead: { id: string; unreadCount: number } };
      }>(
        '/graphql',
        {
          query:
            'mutation { markNotificationRead(id: "cccccccc-1111-4111-8111-cccccccccccc") { id unreadCount } }',
        },
        headers(),
      );

      expect(response.status).toBe(200);
      expect(response.body.data.markNotificationRead).toEqual({
        id: 'cccccccc-1111-4111-8111-cccccccccccc',
        unreadCount: 3,
      });
    });
  });
});
