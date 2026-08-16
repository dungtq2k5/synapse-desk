import { of, throwError } from 'rxjs';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { SCHEDULED_JOBS } from '@synapsedesk/common';
import {
  API,
  E2eFixture,
  authenticatedAgent,
  bootstrapE2eTest,
} from '../utils';
import { grpcError, timestamp } from '../fixtures/wire';

/**
 * `/platform/jobs`
 *
 * **The endpoint whose absence cost two domains.** Seven scheduled jobs were
 * written correctly and invoked by nothing; every analytics endpoint answered
 * zero, correctly, from empty tables. Nothing failed and nothing alerted,
 * because a job that never runs logs nothing at all.
 *
 * So the property under test here is the one that is easy to get wrong: the
 * health verdict is computed against the jobs this build **expects**, not
 * against the heartbeat rows that happen to come back. A reader that iterates
 * over rows reports a clean bill of health for a scheduler that was never
 * wired.
 */
describe('§4.4 Platform job health (e2e)', () => {
  let fx: E2eFixture;

  const hoursAgo = (hours: number) =>
    timestamp(new Date(Date.now() - hours * 60 * 60 * 1000));

  const superAdmin = () =>
    authenticatedAgent(fx.app, { isSuperAdmin: true, organizationId: null });

  const healthyTicketRow = () => ({
    jobName: SCHEDULED_JOBS.ANALYTICS_DAILY,
    lastStartedAt: hoursAgo(2),
    lastSucceededAt: hoursAgo(2),
    lastDurationMs: 4_200,
    lastError: undefined,
    consecutiveFailures: 0,
  });

  const healthyIngestionRows = () => [
    {
      jobName: SCHEDULED_JOBS.LEDGER_DAILY,
      lastStartedAt: hoursAgo(2),
      lastSucceededAt: hoursAgo(2),
      lastDurationMs: 9_000,
      lastError: undefined,
      consecutiveFailures: 0,
    },
    {
      jobName: SCHEDULED_JOBS.LEDGER_HOURLY,
      lastStartedAt: hoursAgo(1),
      lastSucceededAt: hoursAgo(1),
      lastDurationMs: 120,
      lastError: undefined,
      consecutiveFailures: 0,
    },
  ];

  const healthyAuthRows = () =>
    [SCHEDULED_JOBS.AUTH_HOURLY, SCHEDULED_JOBS.AUTH_DAILY].map((jobName) => ({
      jobName,
      lastStartedAt: hoursAgo(1),
      lastSucceededAt: hoursAgo(1),
      lastDurationMs: 30,
      lastError: undefined,
      consecutiveFailures: 0,
    }));

  const stubHealthy = () => {
    fx.stubs.analytics.getJobHealth.mockReturnValue(
      of({ items: [healthyTicketRow()] }),
    );
    fx.stubs.ledger.getAiJobHealth.mockReturnValue(
      of({ items: healthyIngestionRows() }),
    );
    fx.stubs.platform.getAuthJobHealth.mockReturnValue(
      of({ items: healthyAuthRows() }),
    );
  };

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  });

  beforeEach(() => jest.clearAllMocks());

  afterAll(() => fx.close());

  describe('access', () => {
    it('1. is SUPER ADMIN only', async () => {
      stubHealthy();

      const tenantAdmin = authenticatedAgent(fx.app, {
        permissionCodes: ['organization.read'],
      });

      await tenantAdmin.get(`${API}/platform/jobs`).expect(403);
    });
  });

  describe('health', () => {
    it('2. reports every expected job as healthy when all have run', async () => {
      stubHealthy();

      const response = await superAdmin()
        .get(`${API}/platform/jobs`)
        .expect(200);

      const items = response.body.data.items;
      expect(items.map((item: { jobName: string }) => item.jobName)).toEqual(
        expect.arrayContaining(Object.values(SCHEDULED_JOBS)),
      );
      expect(
        items.every((item: { health: string }) => item.health === 'healthy'),
      ).toBe(true);
      expect(response.body.data.degraded).toBe(false);
    });

    it('3. **a job with NO heartbeat row reports never-ran** — the actual bug', async () => {
      // ticket-service answers with an EMPTY list: the service is up, the table
      // is there, and the scheduler was never wired. This is the precise state
      // this system was in for two domains, and the one an implementation that
      // iterates over returned rows reports as "nothing wrong".
      fx.stubs.analytics.getJobHealth.mockReturnValue(of({ items: [] }));
      fx.stubs.ledger.getAiJobHealth.mockReturnValue(
        of({ items: healthyIngestionRows() }),
      );
      fx.stubs.platform.getAuthJobHealth.mockReturnValue(
        of({ items: healthyAuthRows() }),
      );

      const response = await superAdmin()
        .get(`${API}/platform/jobs`)
        .expect(200);

      const daily = response.body.data.items.find(
        (item: { jobName: string }) =>
          item.jobName === SCHEDULED_JOBS.ANALYTICS_DAILY,
      );

      expect(daily.health).toBe('never-ran');
      expect(daily.lastSucceededAt).toBeNull();
      expect(response.body.data.degraded).toBe(true);
    });

    it('4. a job whose last success is old reports stale', async () => {
      fx.stubs.analytics.getJobHealth.mockReturnValue(
        of({
          items: [{ ...healthyTicketRow(), lastSucceededAt: hoursAgo(24 * 5) }],
        }),
      );
      fx.stubs.ledger.getAiJobHealth.mockReturnValue(
        of({ items: healthyIngestionRows() }),
      );
      fx.stubs.platform.getAuthJobHealth.mockReturnValue(
        of({ items: healthyAuthRows() }),
      );

      const response = await superAdmin()
        .get(`${API}/platform/jobs`)
        .expect(200);

      const daily = response.body.data.items.find(
        (item: { jobName: string }) =>
          item.jobName === SCHEDULED_JOBS.ANALYTICS_DAILY,
      );
      expect(daily.health).toBe('stale');
      expect(response.body.data.degraded).toBe(true);
    });

    it('5. a job that is failing reports WHY, and keeps its last success', async () => {
      // `failing` rather than `stale` when we know the reason: same urgency,
      // different place to look. And the previous success survives, because
      // "broken since Tuesday" is the information worth having.
      const lastGood = hoursAgo(24 * 4);

      fx.stubs.analytics.getJobHealth.mockReturnValue(
        of({
          items: [
            {
              ...healthyTicketRow(),
              lastSucceededAt: lastGood,
              lastError: 'relation "ticket_daily_stats" does not exist',
              consecutiveFailures: 4,
            },
          ],
        }),
      );
      fx.stubs.ledger.getAiJobHealth.mockReturnValue(
        of({ items: healthyIngestionRows() }),
      );
      fx.stubs.platform.getAuthJobHealth.mockReturnValue(
        of({ items: healthyAuthRows() }),
      );

      const response = await superAdmin()
        .get(`${API}/platform/jobs`)
        .expect(200);

      const daily = response.body.data.items.find(
        (item: { jobName: string }) =>
          item.jobName === SCHEDULED_JOBS.ANALYTICS_DAILY,
      );
      expect(daily.health).toBe('failing');
      expect(daily.consecutiveFailures).toBe(4);
      expect(daily.lastError).toContain('ticket_daily_stats');
      expect(daily.lastSucceededAt).not.toBeNull();
    });

    it('6. **an unreachable service is UNAVAILABLE, not never-ran**', async () => {
      // The distinction matters: "never ran" is a wiring bug somebody should
      // fix now, and "cannot ask" is an outage that says nothing about the
      // schedule. Conflating them pages the wrong person about the wrong thing.
      fx.stubs.analytics.getJobHealth.mockReturnValue(
        of({ items: [healthyTicketRow()] }),
      );
      fx.stubs.ledger.getAiJobHealth.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.UNAVAILABLE, 'down')),
      );
      fx.stubs.platform.getAuthJobHealth.mockReturnValue(
        of({ items: healthyAuthRows() }),
      );

      const response = await superAdmin()
        .get(`${API}/platform/jobs`)
        .expect(200);

      expect(response.body.data.unavailable).toEqual(['ingestion-service']);
      expect(response.body.data.degraded).toBe(true);
      // And the ingestion jobs are absent rather than libelled as never-ran.
      const names = response.body.data.items.map(
        (item: { jobName: string }) => item.jobName,
      );
      expect(names).toContain(SCHEDULED_JOBS.ANALYTICS_DAILY);
      expect(names).not.toContain(SCHEDULED_JOBS.LEDGER_DAILY);
    });
  });

  describe('manual run and backfill — 20-doc §5', () => {
    it('7. **run is a POST, and it reaches the owning service**', async () => {
      // Not a GET. It creates work; a GET is something a browser prefetch or an
      // automatic retry can trigger with nobody asking.
      fx.stubs.analytics.runRollup.mockReturnValue(
        of({ tenants: 3, ticketRows: 40, agentRows: 12 }),
      );

      const response = await superAdmin()
        .post(`${API}/platform/jobs/${SCHEDULED_JOBS.ANALYTICS_DAILY}/run`)
        .expect(200);

      expect(fx.stubs.analytics.runRollup).toHaveBeenCalledTimes(1);
      expect(response.body.data).toMatchObject({
        service: 'ticket-service',
        tenants: 3,
        rows: 52,
      });
    });

    it('8. the ledger job routes to INGESTION, not to ticket-service', async () => {
      fx.stubs.ledger.runAiRollup.mockReturnValue(of({ tenants: 2, rows: 9 }));

      await superAdmin()
        .post(`${API}/platform/jobs/${SCHEDULED_JOBS.LEDGER_DAILY}/run`)
        .expect(200);

      expect(fx.stubs.ledger.runAiRollup).toHaveBeenCalledTimes(1);
      expect(fx.stubs.analytics.runRollup).not.toHaveBeenCalled();
    });

    it('9. an unknown job name is a 400, not a silent 200 with zeros', async () => {
      // A typo that returned 200 with zeros is indistinguishable from a job
      // that ran and found nothing — the confusion this whole surface exists to
      // remove.
      await superAdmin().post(`${API}/platform/jobs/not-a-job/run`).expect(400);
    });

    it('10. **a backfill REQUIRES a reason**', async () => {
      // It rewrites numbers somebody may already have acted on, and "why" is
      // the only part a reader cannot reconstruct from the rows afterwards.
      await superAdmin()
        .post(`${API}/platform/jobs/${SCHEDULED_JOBS.ANALYTICS_DAILY}/backfill`)
        .send({ from: '2026-01-01', to: '2026-01-31' })
        .expect(400);
    });

    it('11. a backfill passes the RANGE through to the owning service', async () => {
      // The range is what makes this safe to expose: the jobs are idempotent
      // over an explicit window, which is the property that makes correcting a
      // rollup bug possible at all.
      fx.stubs.analytics.runRollup.mockReturnValue(
        of({ tenants: 1, ticketRows: 30, agentRows: 0 }),
      );

      await superAdmin()
        .post(`${API}/platform/jobs/${SCHEDULED_JOBS.ANALYTICS_DAILY}/backfill`)
        .send({
          from: '2026-01-01',
          to: '2026-01-31',
          reason: 'deflection denominator fix, doc 20',
        })
        .expect(200);

      expect(fx.stubs.analytics.runRollup).toHaveBeenCalledWith(
        expect.objectContaining({ from: '2026-01-01', to: '2026-01-31' }),
        expect.anything(),
      );
    });

    it('12. a reversed range is rejected before it reaches a service', async () => {
      await superAdmin()
        .post(`${API}/platform/jobs/${SCHEDULED_JOBS.ANALYTICS_DAILY}/backfill`)
        .send({ from: '2026-03-31', to: '2026-01-01', reason: 'oops' })
        .expect(400);

      expect(fx.stubs.analytics.runRollup).not.toHaveBeenCalled();
    });

    it('13. a tenant admin cannot trigger a cross-tenant sweep', async () => {
      const tenantAdmin = authenticatedAgent(fx.app, {
        permissionCodes: ['organization.update'],
      });

      await tenantAdmin
        .post(`${API}/platform/jobs/${SCHEDULED_JOBS.ANALYTICS_DAILY}/run`)
        .expect(403);
    });
  });
});
