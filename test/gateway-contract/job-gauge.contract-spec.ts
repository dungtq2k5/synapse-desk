/**
 * @file `job_last_success_timestamp_seconds` on `/metrics`.
 *
 * The series a staleness alert selects on, and the one place a gateway can look
 * correct and be inert. Gap 37 was the LABELS colliding with Prometheus's own; the
 * failure this file guards is the VALUES colliding behind correct labels: if every
 * series reads one shared number, two jobs reporting both show the later
 * timestamp, and the alert on the one that stopped never fires because an
 * unrelated job keeps refreshing it. One job cannot tell a per-job gauge from a
 * shared one, so these rows report TWO and assert two distinct values.
 *
 * The gauge is read from the owning services' heartbeats ON SCRAPE (there is no
 * consumer behind it), so every row programs the peers and scrapes; a peer's call
 * log shows who asked and as whom.
 */

import { status as GrpcStatus } from '@grpc/grpc-js';
import { type Gateway, startGateway } from './gateway';
import { type Peers, startPeers } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('the job gauge on /metrics', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ANALYTICS = 'analytics-daily';
  const LEDGER = 'ledger-daily';
  const AUTH = 'auth-hourly';
  const RETENTION = 'webhook-retention';

  const TICKET_AT = 1_756_684_800; // 2025-09-01T00:00:00Z
  const LEDGER_AT = 1_756_771_200; // one day later
  const AUTH_AT = 1_756_774_800; // an hour after that

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

  beforeEach(() => peers.reset());

  /** What each owning service reports; `null` is "reachable, nothing recorded". */
  const heartbeats = (reports: {
    ticket?: [string, number | null][];
    ingestion?: [string, number | null][];
    auth?: [string, number | null][];
    notification?: [string, number | null][];
  }) => {
    const items = (rows: [string, number | null][] = []) => ({
      items: rows.map(([jobName, seconds]) => ({
        jobName,
        ...(seconds === null ? {} : { lastSucceededAt: { seconds, nanos: 0 } }),
        consecutiveFailures: 0,
      })),
    });

    peers.ticket
      .on('AnalyticsService/GetJobHealth')
      .always(items(reports.ticket));
    peers.ingestion
      .on('AiLedgerService/GetAiJobHealth')
      .always(items(reports.ingestion));
    peers.auth
      .on('PlatformService/GetAuthJobHealth')
      .always(items(reports.auth));
    peers.notification
      .on('NotificationService/GetNotificationJobHealth')
      .always(items(reports.notification));
  };

  type Series = { labels: Record<string, string>; value: number };

  /** Every `job_last_success_timestamp_seconds` sample on one scrape, and the raw body. */
  const scrape = async (): Promise<{ series: Series[]; body: string }> => {
    const response = await fetch(`${gateway.metricsUrl}/metrics`);
    expect(response.status).toBe(200);
    const body = await response.text();
    const series: Series[] = [];

    for (const line of body.split('\n')) {
      const match =
        /^job_last_success_timestamp_seconds\{([^}]*)\}\s+(\S+)$/u.exec(line);
      if (!match) continue;
      series.push({
        labels: Object.fromEntries(
          [...match[1].matchAll(/(\w+)="([^"]*)"/gu)].map(([, k, v]) => [k, v]),
        ),
        value: Number(match[2]),
      });
    }

    return { series, body };
  };

  const byJob = (series: Series[]) =>
    Object.fromEntries(
      series.map(({ labels, value }) => [
        labels.scheduled_job,
        { owner: labels.owner_service, value },
      ]),
    );

  rowFor('Ops')(
    '**two jobs are two series with two DIFFERENT values — a shared cell would read one number for both, and the alert on the stopped job would never fire**',
    async () => {
      heartbeats({
        ticket: [[ANALYTICS, TICKET_AT]],
        ingestion: [[LEDGER, LEDGER_AT]],
        auth: [[AUTH, AUTH_AT]],
      });

      const { series } = await scrape();

      expect(byJob(series)).toEqual({
        [ANALYTICS]: { owner: 'ticket-service', value: TICKET_AT },
        [LEDGER]: { owner: 'ingestion-service', value: LEDGER_AT },
        [AUTH]: { owner: 'auth-service', value: AUTH_AT },
      });
      expect(new Set(series.map((s) => s.value)).size).toBe(3);
    },
  );

  rowFor('Ops')(
    '**each job keeps its own value when one of them moves — the others do not follow it**',
    async () => {
      heartbeats({
        ticket: [[ANALYTICS, TICKET_AT]],
        ingestion: [[LEDGER, LEDGER_AT]],
      });
      await scrape();

      heartbeats({
        ticket: [[ANALYTICS, TICKET_AT + 7_200]],
        ingestion: [[LEDGER, LEDGER_AT]],
      });
      const { series } = await scrape();

      expect(byJob(series)[ANALYTICS].value).toBe(TICKET_AT + 7_200);
      expect(byJob(series)[LEDGER].value).toBe(LEDGER_AT);
    },
  );

  rowFor('Ops')(
    '**the series is named exactly, typed gauge, and carries `scheduled_job` and `owner_service` — never `job`**',
    async () => {
      heartbeats({ ticket: [[ANALYTICS, TICKET_AT]] });

      const { series, body } = await scrape();

      // The name an alert rule selects on. A client library that renames or
      // suffixes it leaves every rule matching nothing.
      expect(body).toContain('# TYPE job_last_success_timestamp_seconds gauge');
      expect(Object.keys(series[0].labels).sort()).toEqual([
        'owner_service',
        'scheduled_job',
      ]);
      // The label Prometheus attaches itself must not be declared by the metric.
      expect(body).not.toMatch(/job_last_success_timestamp_seconds\{job=/u);
      expect(body).not.toContain('exported_job');
    },
  );

  rowFor('Ops')(
    '**a job that has never succeeded is ABSENT, not zero — zero is 1970, which reads as catastrophically stale rather than as unknown**',
    async () => {
      heartbeats({
        ticket: [[ANALYTICS, null]],
        ingestion: [[LEDGER, LEDGER_AT]],
      });

      const { series } = await scrape();

      expect(Object.keys(byJob(series))).toEqual([LEDGER]);
      expect(series.every((s) => s.value > 0)).toBe(true);
    },
  );

  rowFor('Ops')(
    '**a job that disappears is gone on the next scrape — a gauge for a job that no longer exists is permanently green, in the metric that exists to notice absence**',
    async () => {
      heartbeats({
        ticket: [[ANALYTICS, TICKET_AT]],
        ingestion: [[LEDGER, LEDGER_AT]],
      });
      expect(Object.keys(byJob((await scrape()).series)).sort()).toEqual(
        [ANALYTICS, LEDGER].sort(),
      );

      heartbeats({ ticket: [[ANALYTICS, TICKET_AT]], ingestion: [] });
      const { series } = await scrape();

      expect(Object.keys(byJob(series))).toEqual([ANALYTICS]);
    },
  );

  rowFor('Ops')(
    '**a service that does not answer leaves its jobs absent and does NOT fail the scrape**',
    async () => {
      heartbeats({
        ticket: [[ANALYTICS, TICKET_AT]],
        ingestion: [[LEDGER, LEDGER_AT]],
        notification: [[RETENTION, LEDGER_AT]],
      });
      peers.ingestion
        .on('AiLedgerService/GetAiJobHealth')
        .fail(GrpcStatus.UNAVAILABLE, 'ingestion is down');

      const { series, body } = await scrape();

      // The scrape answered (`scrape()` asserts 200) and still carries the gauge.
      expect(body).toContain('# TYPE job_last_success_timestamp_seconds gauge');
      expect(Object.keys(byJob(series)).sort()).toEqual(
        [ANALYTICS, RETENTION].sort(),
      );
    },
  );

  rowFor('Ops')(
    '**the heartbeats are read as the SCRAPE — no user, no tenant — from every owning service**',
    async () => {
      heartbeats({ ticket: [[ANALYTICS, TICKET_AT]] });

      await scrape();

      for (const [peer, method] of [
        [peers.ticket, 'AnalyticsService/GetJobHealth'],
        [peers.ingestion, 'AiLedgerService/GetAiJobHealth'],
        [peers.auth, 'PlatformService/GetAuthJobHealth'],
        [peers.notification, 'NotificationService/GetNotificationJobHealth'],
      ] as const) {
        const scraped = peer
          .calls(method)
          .filter((call) => call.metadata.user_agent === 'prometheus-scrape');

        expect(scraped.length).toBeGreaterThanOrEqual(1);
        expect(scraped[0].metadata.ip_address).toBe('127.0.0.1');
        // A scrape has no user, and inventing one would put a fake actor in the
        // audit trail of a read nobody performed.
        expect(scraped[0].metadata.user_id).toBeUndefined();
      }
    },
  );
});
