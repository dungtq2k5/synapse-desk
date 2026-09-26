/**
 * @file `AnalyticsApi` — `CacheService`'s first real production caller, and
 * the three cross-service compositions that must degrade rather than 500
 * when one leg is down.
 */

import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('analytics', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = '11111111-1111-4111-8111-111111111111';
  const USER = '22222222-2222-4222-8222-222222222222';

  const accessToken = () =>
    sign(
      {
        sub: USER,
        organizationId: ORGANIZATION,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes: ['analytics.read'],
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    );

  const cookie = () => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${accessToken()}`,
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

  rowFor('Analytics')(
    '**a closed range is cached** — the second call within the TTL never reaches the peer',
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

      const session = new Session(gateway.baseUrl);
      // A range strictly in the past — CLOSED, per `ttlSecondsFor`, so the
      // 24h TTL applies and a second call within the test's lifetime hits
      // the cache rather than the peer.
      const query = `from=2024-01-01&to=2024-01-01`;

      const first = await session.get(
        `${API}/analytics/overview?${query}`,
        cookie(),
      );
      const second = await session.get(
        `${API}/analytics/overview?${query}`,
        cookie(),
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body).toEqual(first.body);
      expect(peers.ticket.calls('AnalyticsService/GetOverview')).toHaveLength(
        1,
      );
    },
  );

  rowFor('Analytics')(
    '**agents composes ticket-service, ingestion-service and auth-service**, names hydrated',
    async () => {
      peers.ticket.on('AnalyticsService/GetAgentStats').reply({
        items: [
          {
            agentId: USER,
            assigned: 5,
            resolved: 3,
            messagesSent: 20,
            resolutionSeconds: { mean: 1800, count: 3 },
          },
        ],
        dataThrough: '2024-01-01',
      });
      peers.ingestion.on('AiLedgerService/GetAiUsage').reply({
        points: [],
        byPurpose: [],
        byModel: [],
        totalCostMicros: 0,
        totalGenerations: 0,
        monthlyBudgetMicros: 0,
        draftAcceptance: { rate: 0.8, numerator: 4, denominator: 5 },
        emptyRetrievalRate: { numerator: 0, denominator: 0 },
        dataThrough: '2023-12-31',
      });
      peers.auth.on('UserService/ListUsersByIds').reply({
        items: [],
        summaries: [
          { userId: USER, fullName: 'Ada Lovelace', isLocked: false },
        ],
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/analytics/agents?from=2024-01-01&to=2024-01-02`,
        cookie(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: {
          items: [
            {
              agentId: USER,
              fullName: 'Ada Lovelace',
              draftAcceptance: { numerator: 4 },
            },
          ],
          // The STALER of the two legs' dates.
          dataThrough: '2023-12-31',
          unavailable: [],
        },
      });
    },
  );

  rowFor('Analytics')(
    '**a failed leg does not fail the request** — the block is marked unavailable, not a 500',
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
      peers.auth.on('UserService/ListUsersByIds').reply({
        items: [],
        summaries: [
          { userId: USER, fullName: 'Ada Lovelace', isLocked: false },
        ],
      });
      // `ingestion-service`'s leg is the ONE left unprogrammed, so the fake
      // peer answers UNIMPLEMENTED for it alone — the shape a real single-
      // service outage takes, isolated from the other two legs succeeding.

      // A DIFFERENT range from the row above — same params would be a cache
      // hit on that row's fully-succeeded (and now-stale) answer, which
      // would make this row pass without exercising the failure path at all.
      const response = await new Session(gateway.baseUrl).get(
        `${API}/analytics/agents?from=2024-02-01&to=2024-02-02`,
        cookie(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: {
          items: [
            { agentId: USER, fullName: 'Ada Lovelace', draftAcceptance: null },
          ],
          unavailable: [{ source: 'ingestion-service' }],
        },
      });
    },
  );

  rowFor('Analytics')(
    'knowledge gaps maps the document flag type off the wire',
    async () => {
      peers.ingestion.on('AiLedgerService/GetKnowledgeGaps').reply({
        emptyRetrievals: 3,
        answeringGenerations: 10,
        emptyRetrievalRate: { rate: 0.3, numerator: 3, denominator: 10 },
        attachmentGroundedRate: { numerator: 0, denominator: 0 },
        attachmentEmptyRetrievals: 0,
        flags: [
          {
            documentId: '33333333-3333-4333-8333-333333333333',
            documentTitle: 'Refund policy',
            flagType: 3, // DOCUMENT_FLAG_TYPE_UNCITED
            detail: 'Retrieved 12 times, cited 0',
          },
        ],
        dataThrough: '2024-01-01',
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/analytics/knowledge-gaps?from=2024-01-01&to=2024-01-02`,
        cookie(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: {
          flags: [
            { flagType: 'UNCITED', detail: 'Retrieved 12 times, cited 0' },
          ],
        },
      });
    },
  );

  rowFor('Analytics')(
    'documents merges citation accuracy from the satisfaction leg',
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

      const response = await new Session(gateway.baseUrl).get(
        `${API}/analytics/documents`,
        cookie(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: {
          mostCited: [{ documentId: 'd1' }],
          citationAccuracy: { rate: 0.75 },
        },
      });
    },
  );

  rowFor('Analytics')(
    'creating an export answers 202 and forwards the kind and range',
    async () => {
      peers.ticket.on('AnalyticsService/CreateExport').reply({
        id: '44444444-4444-4444-8444-444444444444',
        status: 1, // EXPORT_STATUS_PENDING
        kind: 1, // EXPORT_KIND_TICKET_DAILY
        createdAt: { seconds: 1_756_684_800, nanos: 0 },
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/analytics/export`,
        { kind: 'TICKET_DAILY', from: '2024-01-01', to: '2024-01-31' },
        cookie(),
      );

      expect(response.status).toBe(202);
      expect(response.body).toMatchObject({
        data: { status: 'PENDING', kind: 'TICKET_DAILY' },
      });

      const [call] = peers.ticket.calls('AnalyticsService/CreateExport');
      expect(call.request).toMatchObject({
        kind: 1,
        from: '2024-01-01',
        to: '2024-01-31',
      });
    },
  );

  rowFor('Analytics')(
    'getting an export by id is not cached — every poll reaches the peer',
    async () => {
      peers.ticket.on('AnalyticsService/GetExport').reply({
        id: '44444444-4444-4444-8444-444444444444',
        status: 2, // EXPORT_STATUS_READY
        kind: 1,
        downloadUrl: 'https://storage.example/export.csv',
        createdAt: { seconds: 1_756_684_800, nanos: 0 },
      });

      const session = new Session(gateway.baseUrl);
      await session.get(
        `${API}/analytics/export/44444444-4444-4444-8444-444444444444`,
        cookie(),
      );
      await session.get(
        `${API}/analytics/export/44444444-4444-4444-8444-444444444444`,
        cookie(),
      );

      expect(peers.ticket.calls('AnalyticsService/GetExport')).toHaveLength(2);
    },
  );
});
