/**
 * @file `PlatformJobsApi` — `SuperAdminGuard`-only, no permission code. The
 * sharpest property: a job owned by an
 * UNREACHABLE service is excluded from the report, never reported
 * `never-ran` — reporting it would page somebody about a wiring bug that
 * does not exist.
 */

import { sign } from 'jsonwebtoken';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('platform-jobs', () => {
  let gateway: Gateway;
  let peers: Peers;

  const superAdminHeaders = () => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
      {
        sub: 'aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa',
        organizationId: null,
        isSuperAdmin: true,
        departmentIds: [],
        permissionCodes: [],
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    )}`,
  });

  const tenantAdminHeaders = () => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
      {
        sub: 'bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb',
        organizationId: 'cccccccc-0000-4000-8000-cccccccccccc',
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes: [],
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    )}`,
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
    peers.ticket.on('AnalyticsService/GetJobHealth').always({ items: [] });
    peers.ingestion.on('AiLedgerService/GetAiJobHealth').always({ items: [] });
    peers.auth.on('PlatformService/GetAuthJobHealth').always({ items: [] });
    peers.notification
      .on('NotificationService/GetNotificationJobHealth')
      .always({ items: [] });
  });

  rowFor('Platform Jobs')(
    '**a tenant admin is refused — this door has no permission code**',
    async () => {
      const response = await new Session(gateway.baseUrl).get(
        `${API}/platform/jobs`,
        tenantAdminHeaders(),
      );

      expect(response.status).toBe(403);
    },
  );

  rowFor('Platform Jobs')(
    '**a job that has never run reports `never-ran`, not silence**',
    async () => {
      const response = await new Session(gateway.baseUrl).get(
        `${API}/platform/jobs`,
        superAdminHeaders(),
      );

      expect(response.status).toBe(200);
      const analytics = (
        response.body as {
          data: { items: { jobName: string; health: string }[] };
        }
      ).data.items.find((item) => item.jobName === 'analytics-daily');
      expect(analytics).toMatchObject({ health: 'never-ran' });
    },
  );

  rowFor('Platform Jobs')(
    '**a job owned by an unreachable service is EXCLUDED, never reported `never-ran`**',
    async () => {
      peers.ingestion
        .on('AiLedgerService/GetAiJobHealth')
        .fail(GrpcStatus.UNAVAILABLE, 'ingestion-service is down');

      const response = await new Session(gateway.baseUrl).get(
        `${API}/platform/jobs`,
        superAdminHeaders(),
      );

      expect(response.status).toBe(200);
      const body = response.body as {
        data: {
          items: { jobName: string }[];
          unavailable: string[];
          degraded: boolean;
        };
      };
      expect(body.data.unavailable).toContain('ingestion-service');
      expect(body.data.items.map((item) => item.jobName)).not.toEqual(
        expect.arrayContaining([
          'ledger-hourly',
          'ledger-daily',
          'ingestion-reconcile',
          'scope-reconcile',
        ]),
      );
      expect(body.data.degraded).toBe(true);
    },
  );

  rowFor('Platform Jobs')(
    '**`run` dispatches `analytics-daily` and sums ticket and agent rows**',
    async () => {
      peers.ticket
        .on('AnalyticsService/RunRollup')
        .reply({ tenants: 2, ticketRows: 5, agentRows: 3 });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/platform/jobs/analytics-daily/run`,
        undefined,
        superAdminHeaders(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        message: 'Job run complete',
        data: {
          service: 'ticket-service',
          jobName: 'analytics-daily',
          tenants: 2,
          rows: 8,
        },
      });
    },
  );

  rowFor('Platform Jobs')(
    '**`run` refuses a job that cannot be triggered by hand — 400, not 404**',
    async () => {
      const response = await new Session(gateway.baseUrl).post(
        `${API}/platform/jobs/webhook-retention/run`,
        undefined,
        superAdminHeaders(),
      );

      expect(response.status).toBe(400);
    },
  );

  rowFor('Platform Jobs')(
    '**`backfill` refuses `from` after `to`**',
    async () => {
      const response = await new Session(gateway.baseUrl).post(
        `${API}/platform/jobs/analytics-daily/backfill`,
        { from: '2026-02-01', to: '2026-01-01', reason: 'correction' },
        superAdminHeaders(),
      );

      expect(response.status).toBe(400);
    },
  );

  rowFor('Platform Jobs')(
    '**`backfill` sends the explicit range to the peer**',
    async () => {
      peers.ingestion
        .on('AiLedgerService/RunAiRollup')
        .reply({ tenants: 1, rows: 42 });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/platform/jobs/ledger-daily/backfill`,
        { from: '2026-01-01', to: '2026-01-31', reason: 'correction' },
        superAdminHeaders(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        message: 'Backfill complete',
        data: {
          service: 'ingestion-service',
          jobName: 'ledger-daily',
          tenants: 1,
          rows: 42,
        },
      });
      const [call] = peers.ingestion.calls('AiLedgerService/RunAiRollup');
      expect(call.request).toMatchObject({
        from: '2026-01-01',
        to: '2026-01-31',
      });
    },
  );
});
