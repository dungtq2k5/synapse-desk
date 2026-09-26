/**
 * @file `DocumentsApi` — the knowledge base. Reads are open to any member,
 * writes are permissioned (6 distinct codes), and `GET /documents` is the
 * one cached route in this module: `@Cacheable({ varyBy: 'caller' })`, a
 * global interceptor keyed on the raw query string plus a visibility digest
 * of the caller's departments — the row below proves a second identical call
 * hits the cache rather than the peer again.
 *
 * The flag triad (`dismiss`/`fixed`/`replaced`) shares ONE RPC
 * (`ResolveDocumentFlag`); the resolution comes from the ROUTE, never the
 * body — the row below calls all three with an identical body and asserts
 * the peer received three different resolutions.
 */

import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('documents', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = '11111111-1111-4111-8111-111111111111';
  const USER = '22222222-2222-4222-8222-222222222222';
  const DOCUMENT = '33333333-3333-4333-8333-333333333333';
  const FLAG = '44444444-4444-4444-8444-444444444444';

  const accessToken = (permissionCodes: string[] = []) =>
    sign(
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
    );

  const cookie = (permissionCodes: string[] = []) => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${accessToken(permissionCodes)}`,
  });

  const wireDocument = (overrides: Record<string, unknown> = {}) => ({
    id: DOCUMENT,
    organizationId: ORGANIZATION,
    createdById: USER,
    title: 'Refund policy',
    fileUrl: 'documents/refund-policy.pdf',
    fileType: 1, // DOCUMENT_FILE_TYPE_PDF
    fileSizeBytes: 2048,
    isOrganizationWide: true,
    status: 3, // DOCUMENT_STATUS_INDEXED
    departmentIds: [],
    chunkCount: 4,
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
    updatedAt: { seconds: 1_756_684_800, nanos: 0 },
    ocrLanguages: [],
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

  rowFor('Documents')(
    '**listing is open to any member** and the second identical call is a cache hit, not a second peer call',
    async () => {
      peers.ingestion.on('DocumentService/ListDocuments').reply({
        items: [wireDocument()],
        meta: { totalItems: 1, itemCount: 1, itemsPerPage: 10, totalPages: 1, currentPage: 1 },
      });

      const first = await new Session(gateway.baseUrl).get(`${API}/documents`, cookie([]));
      const second = await new Session(gateway.baseUrl).get(`${API}/documents`, cookie([]));

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body).toEqual(first.body);
      expect(peers.ingestion.calls('DocumentService/ListDocuments')).toHaveLength(1);
    },
  );

  rowFor('Documents')('**presign refuses a caller without `document.create`**', async () => {
    const response = await new Session(gateway.baseUrl).post(
      `${API}/documents/presign`,
      { contentType: 'application/pdf', sizeBytes: 1024, fileName: 'refund.pdf' },
      cookie([]),
    );

    expect(response.status).toBe(403);
    expect(peers.ingestion.calls('DocumentService/PresignDocument')).toHaveLength(0);
  });

  rowFor('Documents')('presign forwards the content type and size, nothing is created yet (200)', async () => {
    peers.ingestion.on('DocumentService/PresignDocument').reply({
      uploadUrl: 'https://storage.test/upload',
      objectPath: 'pending/documents/abc123',
      expiresAt: { seconds: 1_756_684_800, nanos: 0 },
    });

    const response = await new Session(gateway.baseUrl).post(
      `${API}/documents/presign`,
      { contentType: 'application/pdf', sizeBytes: 1024, fileName: 'refund.pdf' },
      cookie(['document.create']),
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ data: { objectPath: 'pending/documents/abc123' } });
  });

  rowFor('Documents')(
    '**confirm is where the row is created (201)**, and OCR languages round-trip',
    async () => {
      peers.ingestion.on('DocumentService/ConfirmDocument').reply(
        wireDocument({ ocrLanguages: ['vi', 'en'] }),
      );

      const response = await new Session(gateway.baseUrl).post(
        `${API}/documents/confirm`,
        {
          objectPath: 'pending/documents/abc123',
          title: 'Refund policy',
          ocrLanguages: ['vi', 'en'],
        },
        cookie(['document.create']),
      );

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ data: { ocrLanguages: ['vi', 'en'] } });

      const [call] = peers.ingestion.calls('DocumentService/ConfirmDocument');
      expect(call.request).toMatchObject({ ocrLanguages: ['vi', 'en'], isOrganizationWide: true });
    },
  );

  rowFor('Documents')('**get is open** — no permission required to read one document', async () => {
    peers.ingestion.on('DocumentService/GetDocument').reply(wireDocument());

    const response = await new Session(gateway.baseUrl).get(`${API}/documents/${DOCUMENT}`, cookie([]));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ data: { id: DOCUMENT, status: 'INDEXED', fileType: 'pdf' } });
  });

  rowFor('Documents')('**update refuses a caller without `document.update`**', async () => {
    const response = await new Session(gateway.baseUrl).request(
      'PATCH',
      `${API}/documents/${DOCUMENT}`,
      { body: { title: 'Renamed' }, headers: cookie([]) },
    );

    expect(response.status).toBe(403);
    expect(peers.ingestion.calls('DocumentService/UpdateDocument')).toHaveLength(0);
  });

  rowFor('Documents')(
    '**the resolution comes from the ROUTE, not the body** — one RPC, three distinct wire values',
    async () => {
      peers.ingestion.on('DocumentService/ResolveDocumentFlag').reply({
        id: FLAG,
        documentId: DOCUMENT,
        documentTitle: 'Refund policy',
        flagType: 1,
        severity: 2,
        detail: 'Not retrieved in 90 days',
        detectedAt: { seconds: 1_756_684_800, nanos: 0 },
        resolution: 2,
      });

      const body = { comment: 'Reviewed, keeping it' };
      await new Session(gateway.baseUrl).post(`${API}/documents/flags/${FLAG}/dismiss`, body, cookie(['document.update']));
      await new Session(gateway.baseUrl).post(`${API}/documents/flags/${FLAG}/fixed`, body, cookie(['document.update']));
      await new Session(gateway.baseUrl).post(`${API}/documents/flags/${FLAG}/replaced`, body, cookie(['document.update']));

      const calls = peers.ingestion.calls('DocumentService/ResolveDocumentFlag');
      expect(calls.map((call) => call.request.resolution)).toEqual([2, 1, 3]);
    },
  );

  rowFor('Documents')('**deleting a flag requires `document.delete`, a distinct code from `document.update`**', async () => {
    const response = await new Session(gateway.baseUrl).request(
      'DELETE',
      `${API}/documents/flags/${FLAG}`,
      { headers: cookie(['document.update']) },
    );

    expect(response.status).toBe(403);
    expect(peers.ingestion.calls('DocumentService/DeleteDocumentFlag')).toHaveLength(0);
  });

  rowFor('Documents')(
    '**`setDepartments` needs `document.share`, distinct from `document.update`** — the sibling-code-pair case',
    async () => {
      const response = await new Session(gateway.baseUrl).request(
        'PUT',
        `${API}/documents/${DOCUMENT}/departments`,
        {
          body: { departmentIds: ['55555555-5555-4555-8555-555555555555'] },
          headers: cookie(['document.update']),
        },
      );

      expect(response.status).toBe(403);
      expect(peers.ingestion.calls('DocumentService/SetDocumentDepartments')).toHaveLength(0);
    },
  );

  rowFor('Documents')(
    'a caller WITH `document.share` sets departments, the 409-while-org-wide rule stays server-side',
    async () => {
      peers.ingestion.on('DocumentService/SetDocumentDepartments').reply(
        wireDocument({ isOrganizationWide: false, departmentIds: ['55555555-5555-4555-8555-555555555555'] }),
      );

      const response = await new Session(gateway.baseUrl).request(
        'PUT',
        `${API}/documents/${DOCUMENT}/departments`,
        {
          body: { departmentIds: ['55555555-5555-4555-8555-555555555555'] },
          headers: cookie(['document.share']),
        },
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: { departmentIds: ['55555555-5555-4555-8555-555555555555'] } });
    },
  );

  rowFor('Documents')('**`restore` shares `remove`\'s code (`document.delete`)**', async () => {
    const response = await new Session(gateway.baseUrl).post(
      `${API}/documents/${DOCUMENT}/restore`,
      {},
      cookie(['document.update']),
    );

    expect(response.status).toBe(403);
    expect(peers.ingestion.calls('DocumentService/RestoreDocument')).toHaveLength(0);
  });

  rowFor('Documents')(
    '**`reindex` needs its own distinct code (`document.reindex`)**, returns the JOB with 202',
    async () => {
      peers.ingestion.on('DocumentService/ReindexDocument').reply({
        id: '66666666-6666-4666-8666-666666666666',
        documentId: DOCUMENT,
        bullmqJobId: '',
        status: 1, // QUEUED
        errorLog: '',
        createdAt: { seconds: 1_756_684_800, nanos: 0 },
      });

      const refused = await new Session(gateway.baseUrl).post(
        `${API}/documents/${DOCUMENT}/reindex`,
        {},
        cookie(['document.update']),
      );
      expect(refused.status).toBe(403);

      const response = await new Session(gateway.baseUrl).post(
        `${API}/documents/${DOCUMENT}/reindex`,
        {},
        cookie(['document.reindex']),
      );

      expect(response.status).toBe(202);
      expect(response.body).toMatchObject({ data: { status: 'QUEUED' } });
    },
  );

  rowFor('Documents')('replace forwards the object path and OCR languages (202)', async () => {
    peers.ingestion.on('DocumentService/ReplaceDocument').reply(wireDocument({ ocrLanguages: ['ja'] }));

    const response = await new Session(gateway.baseUrl).post(
      `${API}/documents/${DOCUMENT}/replace`,
      { objectPath: 'pending/documents/def456', ocrLanguages: ['ja'] },
      cookie(['document.update']),
    );

    expect(response.status).toBe(202);
    const [call] = peers.ingestion.calls('DocumentService/ReplaceDocument');
    expect(call.request).toMatchObject({ objectPath: 'pending/documents/def456', ocrLanguages: ['ja'] });
  });

  rowFor('Documents')('**download is open**, returns a short-lived signed URL', async () => {
    peers.ingestion.on('DocumentService/DownloadDocument').reply({
      downloadUrl: 'https://storage.test/read/abc123',
      expiresAt: { seconds: 1_756_684_800, nanos: 0 },
    });

    const response = await new Session(gateway.baseUrl).get(`${API}/documents/${DOCUMENT}/download`, cookie([]));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ data: { downloadUrl: 'https://storage.test/read/abc123' } });
  });

  rowFor('Documents')('storage usage refuses a caller without `document.read`', async () => {
    const response = await new Session(gateway.baseUrl).get(`${API}/documents/storage`, cookie([]));

    expect(response.status).toBe(403);
    expect(peers.ingestion.calls('DocumentService/GetStorageUsage')).toHaveLength(0);
  });

  rowFor('Documents')('storage usage is a workspace total — the id sent to the peer is blank', async () => {
    peers.ingestion.on('DocumentService/GetStorageUsage').reply({
      usedBytes: 1024,
      limitBytes: 1_073_741_824,
      documentCount: 3,
    });

    const response = await new Session(gateway.baseUrl).get(`${API}/documents/storage`, cookie(['document.read']));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ data: { documentCount: 3 } });

    const [call] = peers.ingestion.calls('DocumentService/GetStorageUsage');
    expect(call.request.id).toBe('');
  });

  rowFor('Documents')(
    '**a chunk is open to any member who can see the parent document** — the citation deep-link target',
    async () => {
      peers.ingestion.on('DocumentService/GetDocumentChunk').reply({
        id: '77777777-7777-4777-8777-777777777777',
        documentId: DOCUMENT,
        chunkIndex: 2,
        contentText: 'Refunds are processed within 5 business days.',
        tokenCount: 12,
        createdAt: { seconds: 1_756_684_800, nanos: 0 },
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/documents/${DOCUMENT}/chunks/77777777-7777-4777-8777-777777777777`,
        cookie([]),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: { contentText: 'Refunds are processed within 5 business days.' } });
    },
  );

  rowFor('Documents')(
    'a wire OCR code this build does not recognise is dropped, not surfaced as a crash',
    async () => {
      peers.ingestion.on('DocumentService/GetDocument').reply(wireDocument({ ocrLanguages: ['vi', 'xx'] }));

      const response = await new Session(gateway.baseUrl).get(`${API}/documents/${DOCUMENT}`, cookie([]));

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: { ocrLanguages: ['vi'] } });
    },
  );
});
