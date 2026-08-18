import request from 'supertest';
import { of } from 'rxjs';
import { faker } from '@faker-js/faker';
import { SCHEDULED_JOBS } from '@synapsedesk/common';
import {
  API,
  E2eFixture,
  authenticatedAgent,
  bootstrapE2eTest,
} from '../utils';
import { timestamp } from '../fixtures/wire';
import {
  assertLabelsAreBounded,
  FORBIDDEN_LABELS,
  MetricsRegistry,
} from '../../src/modules/metrics/metrics.registry';
import { MetricsServer } from '../../src/modules/metrics/metrics.server';

/**
 * `/metrics`.
 *
 * Three of these four tests are about things NOT happening: the endpoint not
 * being public, the labels not being unbounded, and a never-run job not
 * exporting a zero. That is the shape of this section — the metrics themselves
 * are the easy part, and every way it goes wrong is silent.
 */
describe('Metrics', () => {
  let fx: E2eFixture;

  /**
   * Drives the metrics listener WITHOUT binding its port.
   *
   * `MetricsServer.listen()` is called from `main.ts`, deliberately not from a
   * lifecycle hook: two e2e suites running at once would collide on the port and
   * fail with `EADDRINUSE` in whichever suite happened to start second. So the
   * handler is exercised directly, which is also the only part with any logic in
   * it.
   */
  const scrape = async (url = '/metrics') => {
    const chunks: string[] = [];
    let status = 0;

    await fx.app.get(MetricsServer).handle(url, {
      writeHead: (code: number) => {
        status = code;
      },
      end: (body?: string) => {
        if (body) chunks.push(body);
      },
    });

    return { status, body: chunks.join('') };
  };

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  }, 30_000);

  afterAll(() => fx.close());

  it('1. **`/metrics` is NOT reachable on the public listener**', async () => {
    // The isolation, ASSERTED rather than configured. The alternative design is
    // a route on the public app plus an Nginx rule denying it, and that rule is
    // one misordered `location` block away from publishing an inventory of your
    // traffic volumes, error rates and queue depths.
    //
    // Both spellings, because the route could plausibly have been mounted
    // either inside or outside the API prefix.
    await request(fx.app.getHttpServer()).get('/metrics').expect(404);
    await request(fx.app.getHttpServer()).get(`${API}/metrics`).expect(404);
  });

  it('and it IS reachable on the internal listener', async () => {
    // The other half — otherwise test 1 would pass against a build where
    // metrics do not exist at all.
    const { status, body } = await scrape();

    expect(status).toBe(200);
    expect(body).toContain('http_requests_total');
  });

  it('2. **no exported metric carries a tenant, user or resource id label**', async () => {
    // **Static, over the registered definitions**. A runtime
    // check would only cover labels something happened to emit during the test,
    // and the metric that kills a Prometheus install is usually the one on a
    // path the test suite never took.
    //
    // Prometheus creates one time series per unique label combination, so
    // `organizationId` is one series per tenant per metric, forever, including
    // for tenants that have been deleted. It degrades gradually, which is why
    // nobody attributes it to the label added six weeks earlier.
    const registry = fx.app.get(MetricsRegistry);
    const metrics = await registry.registry.getMetricsAsJSON();

    expect(metrics.length).toBeGreaterThan(0);

    const offenders = metrics.flatMap((metric) =>
      ((metric as { labelNames?: string[] }).labelNames ?? [])
        .filter((label) =>
          (FORBIDDEN_LABELS as readonly string[]).includes(label.toLowerCase()),
        )
        .map((label) => `${metric.name}{${label}}`),
    );

    expect(offenders).toEqual([]);
  });

  it('and a metric declaring one FAILS AT BOOT rather than at scrape time', () => {
    // The guard behind test 2. Thrown at construction, because the cost of a
    // high-cardinality label is paid slowly and by somebody else — which is
    // exactly why a review comment is not a sufficient control.
    expect(() =>
      assertLabelsAreBounded('ai_spend_total', ['purpose', 'organizationId']),
    ).toThrow(/unbounded label/);

    // And the bounded ones are still allowed, so the guard is not simply
    // refusing everything.
    expect(() =>
      assertLabelsAreBounded('ai_spend_total', ['purpose', 'model']),
    ).not.toThrow();
  });

  it('3. **route labels use the PATH TEMPLATE, not the resolved path**', async () => {
    // `/tickets/<uuid>` is per-ticket cardinality wearing a different name: a
    // busy tenant would mint one time series per ticket it ever opened.
    const ticketId = faker.string.uuid();
    fx.stubs.ticket.getTicket.mockReturnValue(
      of({
        id: ticketId,
        ticketNumber: 1,
        organizationId: faker.string.uuid(),
        authorId: faker.string.uuid(),
        source: 1,
        status: 2,
        priority: 2,
        title: 'Printer is on fire',
        description: 'It really is',
        currentDepartmentId: faker.string.uuid(),
        createdAt: timestamp(),
        updatedAt: timestamp(),
      }),
    );

    const agent = authenticatedAgent(fx.app, {
      permissionCodes: ['ticket.read.all'],
    });
    await agent.get(`${API}/tickets/${ticketId}`);

    const { body } = await scrape();

    expect(body).toContain(`route="${API}/tickets/:id"`);
    expect(body).not.toContain(ticketId);
  });

  it('4. **`job_last_success_timestamp_seconds` is ABSENT for a job that never ran**', async () => {
    // **Absent, not zero**. Zero is 1970, which satisfies any
    // `time() - x > threshold` rule and reads as catastrophically stale rather
    // than as unknown. Those need different responses: "the rollup broke last
    // night" is a page, "the rollup was never wired" is a deploy — and the
    // second is what actually happened to seven jobs.
    const succeededAt = new Date('2026-08-01T03:00:00.000Z');

    fx.stubs.analytics.getJobHealth.mockReturnValue(
      of({
        items: [
          {
            jobName: SCHEDULED_JOBS.ANALYTICS_DAILY,
            lastStartedAt: timestamp(succeededAt),
            lastSucceededAt: timestamp(succeededAt),
            lastDurationMs: 4_200,
            lastError: undefined,
            consecutiveFailures: 0,
          },
        ],
      }),
    );
    // ingestion and auth answer with NOTHING — their jobs have never run.
    fx.stubs.ledger.getAiJobHealth.mockReturnValue(of({ items: [] }));
    fx.stubs.platform.getAuthJobHealth.mockReturnValue(of({ items: [] }));

    const { body } = await scrape();

    const series = body
      .split('\n')
      .filter((line) => line.startsWith('job_last_success_timestamp_seconds{'));

    // The one that ran is exported, in SECONDS — Prometheus timestamps are
    // seconds, and exporting milliseconds would put every job 55 000 years in
    // the future and silence the alert entirely.
    expect(series).toHaveLength(1);
    expect(series[0]).toContain(`job="${SCHEDULED_JOBS.ANALYTICS_DAILY}"`);
    expect(series[0]).toContain(String(succeededAt.getTime() / 1000));

    // And the ones that never ran export no series at all.
    expect(body).not.toContain(SCHEDULED_JOBS.LEDGER_DAILY);
    expect(body).not.toContain(SCHEDULED_JOBS.AUTH_HOURLY);
  });

  it('and a job REMOVED from the schedule stops being exported', async () => {
    // The reset that makes test 4 stay true. Without it a job deleted from
    // `SCHEDULED_JOBS` keeps exporting its final value forever — permanently
    // green, in the metric whose entire purpose is to notice absence.
    fx.stubs.analytics.getJobHealth.mockReturnValue(of({ items: [] }));
    fx.stubs.ledger.getAiJobHealth.mockReturnValue(of({ items: [] }));
    fx.stubs.platform.getAuthJobHealth.mockReturnValue(of({ items: [] }));

    const { body } = await scrape();

    expect(body).not.toContain(SCHEDULED_JOBS.ANALYTICS_DAILY);
  });
});
