import { Gauge, Registry } from 'prom-client';
import { MetricsRegistry } from './metrics.registry';

/**
 * No exported label may be one a scraper attaches to every series itself.
 *
 * A scraper's label wins: with the default `honor_labels: false`, Prometheus
 * keeps its own `job` (the scrape job) and renames the metric's to
 * `exported_job`. `job_last_success_timestamp_seconds` once carried `job`, and
 * every generated alert selected on it — so every alert matched nothing, and
 * the text-level tests over the rules stayed green throughout.
 *
 * **Walks the registry, not a list of metrics**, so a metric added later is
 * covered without anyone remembering to add it here.
 */
describe('MetricsRegistry — label names', () => {
  /**
   * Labels a scrape attaches to every series.
   *
   * `job` and `instance` from Prometheus itself; the other five are the target
   * labels a Prometheus Operator `ServiceMonitor` scrape adds (its documented
   * behaviour, not measured here), which is the production shape still to be
   * chosen.
   */
  const RESERVED: ReadonlySet<string> = new Set([
    'job',
    'instance',
    'namespace',
    'service',
    'pod',
    'container',
    'endpoint',
  ]);

  /** `metric: label` for every declared label a scraper would override. */
  const collisions = (registry: Registry): string[] =>
    registry
      .getMetricsAsArray()
      .flatMap((metric) =>
        ((metric as unknown as { labelNames?: string[] }).labelNames ?? [])
          .filter((label) => RESERVED.has(label))
          .map((label) => `${metric.name}: ${label}`),
      );

  let metrics: MetricsRegistry;

  beforeAll(() => {
    metrics = new MetricsRegistry();
  });

  afterAll(() => metrics.registry.clear());

  it('**declares no label a scraper attaches itself**', () => {
    expect(collisions(metrics.registry)).toEqual([]);
  });

  it('the walk finds the gateway’s own metrics and their labels — the corpus floor', () => {
    const names = metrics.registry.getMetricsAsArray().map(({ name }) => name);

    expect(names).toEqual(
      expect.arrayContaining([
        'http_requests_total',
        'grpc_client_duration_seconds',
        'job_last_success_timestamp_seconds',
      ]),
    );
    expect(
      (
        metrics.registry.getSingleMetric(
          'job_last_success_timestamp_seconds',
        ) as unknown as { labelNames: string[] }
      ).labelNames,
    ).toEqual(['scheduled_job', 'owner_service']);
  });

  it('the check fires on a colliding label — the pattern-fires row', () => {
    const probe = new Registry();
    new Gauge({
      name: 'probe_timestamp_seconds',
      help: 'probe',
      labelNames: ['job'],
      registers: [probe],
    });

    expect(collisions(probe)).toEqual(['probe_timestamp_seconds: job']);
  });
});
