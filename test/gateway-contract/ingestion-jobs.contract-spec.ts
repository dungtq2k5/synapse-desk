/**
 * @file `IngestionJobsApi` — the ingestion pipeline worklist, 4 operations
 * against ingestion-service's `DocumentService`. The sharpest property:
 * `errorLog` is capped to 500 chars and empty-to-null, a piece of mapper
 * logic no DTO annotation can express — pinned at the item level, not just
 * a 200.
 */

import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/contracts';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('ingestion-jobs', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = 'cccccccc-0000-4000-8000-cccccccccccc';
  const AGENT = 'bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb';
  const JOB = '11111111-1111-4111-8111-111111111111';

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

  const wireJob = (overrides: Record<string, unknown> = {}) => ({
    id: JOB,
    documentId: '22222222-2222-4222-8222-222222222222',
    bullmqJobId: 'bullmq-1',
    status: 6, // INGESTION_JOB_STATUS_FAILED
    errorLog: '',
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

  rowFor('Ingestion Jobs')(
    '**`list` refuses a caller without `document.read`**',
    async () => {
      const response = await new Session(gateway.baseUrl).get(
        `${API}/ingestion-jobs`,
        headersWithCodes([]),
      );

      expect(response.status).toBe(403);
    },
  );

  rowFor('Ingestion Jobs')(
    '**`list` refuses an unrecognized `status` with 400, not 500**',
    async () => {
      const response = await new Session(gateway.baseUrl).get(
        `${API}/ingestion-jobs?status=NOT_A_REAL_STATUS`,
        headersWithCodes(['document.read']),
      );

      expect(response.status).toBe(400);
    },
  );

  rowFor('Ingestion Jobs')(
    '**`list` forwards a recognized `status` filter**',
    async () => {
      peers.ingestion
        .on('DocumentService/ListIngestionJobs')
        .reply({ items: [wireJob()], meta: { totalItems: 1 } });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/ingestion-jobs?status=FAILED`,
        headersWithCodes(['document.read']),
      );

      expect(response.status).toBe(200);
      const [call] = peers.ingestion.calls('DocumentService/ListIngestionJobs');
      expect(call.request).toMatchObject({ status: 6 });
    },
  );

  rowFor('Ingestion Jobs')(
    '**`list` maps an empty `errorLog` to `null` and truncates a long one at 500 chars**',
    async () => {
      const longLog = 'x'.repeat(600);
      peers.ingestion.on('DocumentService/ListIngestionJobs').reply({
        items: [
          wireJob({ id: '33333333-3333-4333-8333-333333333333', errorLog: '' }),
          wireJob({
            id: '44444444-4444-4444-8444-444444444444',
            errorLog: longLog,
          }),
        ],
        meta: { totalItems: 2 },
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/ingestion-jobs`,
        headersWithCodes(['document.read']),
      );

      expect(response.status).toBe(200);
      const body = response.body as {
        data: { items: { id: string; errorLog: string | null }[] };
      };
      expect(body.data.items[0].errorLog).toBeNull();
      expect(body.data.items[1].errorLog).toHaveLength(501);
      expect(body.data.items[1].errorLog).toMatch(/…$/u);
    },
  );

  rowFor('Ingestion Jobs')(
    '**`list` names why a job failed, where, and why one waits; unset is `null`**',
    async () => {
      peers.ingestion.on('DocumentService/ListIngestionJobs').reply({
        items: [
          // NO_READABLE_TEXT, at PARSING.
          wireJob({ errorCode: 2, failedStage: 1 }),
          // QUEUED, waiting for the AI allowance.
          wireJob({
            id: '33333333-3333-4333-8333-333333333333',
            status: 1,
            waitingReason: 1,
          }),
        ],
        meta: { totalItems: 2 },
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/ingestion-jobs`,
        headersWithCodes(['document.read']),
      );

      expect(response.status).toBe(200);
      const body = response.body as { data: { items: unknown[] } };
      expect(body.data.items[0]).toMatchObject({
        errorCode: 'NO_READABLE_TEXT',
        failedStage: 'PARSING',
        waitingReason: null,
      });
      expect(body.data.items[1]).toMatchObject({
        errorCode: null,
        failedStage: null,
        waitingReason: 'AI_ALLOWANCE',
      });
    },
  );

  rowFor('Ingestion Jobs')(
    '**`get` refuses a caller without `document.read`**',
    async () => {
      const response = await new Session(gateway.baseUrl).get(
        `${API}/ingestion-jobs/${JOB}`,
        headersWithCodes([]),
      );

      expect(response.status).toBe(403);
    },
  );

  rowFor('Ingestion Jobs')(
    '**`get` succeeds for a caller holding `document.read`**',
    async () => {
      peers.ingestion.on('DocumentService/GetIngestionJob').reply(wireJob());

      const response = await new Session(gateway.baseUrl).get(
        `${API}/ingestion-jobs/${JOB}`,
        headersWithCodes(['document.read']),
      );

      expect(response.status).toBe(200);
    },
  );

  rowFor('Ingestion Jobs')(
    '**`retry` requires `document.reindex`, not `document.read`**',
    async () => {
      const response = await new Session(gateway.baseUrl).post(
        `${API}/ingestion-jobs/${JOB}/retry`,
        undefined,
        headersWithCodes(['document.read']),
      );

      expect(response.status).toBe(403);
    },
  );

  rowFor('Ingestion Jobs')(
    '**`retry` succeeds and answers "Ingestion retry queued"**',
    async () => {
      peers.ingestion.on('DocumentService/RetryIngestionJob').reply(wireJob());

      const response = await new Session(gateway.baseUrl).post(
        `${API}/ingestion-jobs/${JOB}/retry`,
        undefined,
        headersWithCodes(['document.reindex']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        message: 'Ingestion retry queued',
      });
    },
  );

  rowFor('Ingestion Jobs')(
    '**`cancel` requires `document.reindex`, same door as `retry`**',
    async () => {
      const response = await new Session(gateway.baseUrl).request(
        'DELETE',
        `${API}/ingestion-jobs/${JOB}`,
        {
          headers: headersWithCodes(['document.read']),
        },
      );

      expect(response.status).toBe(403);
    },
  );

  rowFor('Ingestion Jobs')(
    "**`cancel` returns 204 regardless of the peer's `cancelled` flag**",
    async () => {
      peers.ingestion
        .on('DocumentService/CancelIngestionJob')
        .reply({ cancelled: false });

      const response = await new Session(gateway.baseUrl).request(
        'DELETE',
        `${API}/ingestion-jobs/${JOB}`,
        {
          headers: headersWithCodes(['document.reindex']),
        },
      );

      expect(response.status).toBe(204);
    },
  );

  rowFor('Ingestion Jobs')(
    "**a document's ingestion history answers a PAGE (`data.items` and `data.meta`), as the worklist does, not a bare list**",
    async () => {
      // The RPC returns `{ items, meta }`, and both are passed on; a gateway that kept
      // only the items answered `data: [...]`, a different body
      // shape for the same route, which no row exercised until this one.
      peers.ingestion
        .on('DocumentService/ListDocumentIngestionJobs')
        .reply({ items: [wireJob()], meta: { totalItems: 1, currentPage: 1 } });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/documents/22222222-2222-4222-8222-222222222222/ingestion-jobs`,
        headersWithCodes(['document.read']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: {
          items: [{ id: JOB, status: 'FAILED' }],
          meta: { totalItems: 1 },
        },
      });
    },
  );
});
