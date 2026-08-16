import { Injectable, Logger } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';

/**
 * Label names that must NEVER appear on a metric
 *
 * **Prometheus creates one time series per unique label combination**, and in a
 * multi-tenant system the tempting labels are the fatal ones:
 *
 * | Label | Series |
 * | :-- | :-- |
 * | `route`, `method`, `status` | tens — fine |
 * | `organizationId` | one per tenant, **per metric, forever** — including deleted tenants |
 * | `userId`, `ticketId`, `documentId` | unbounded |
 *
 * This is not a performance tuning note. It is the single most common way a
 * Prometheus install becomes unusable; it degrades GRADUALLY, so nobody
 * attributes the slowdown to the label somebody added six weeks ago; and the
 * series persist after the tenant is gone, so deleting the customer does not
 * reclaim them.
 *
 * **Per-tenant numbers already have a home.** `ai_generations` and the daily
 * rollups answer *"what did tenant X spend"*. Prometheus answers
 * *"is the system healthy"*. Keeping the question in the store built for it is
 * not a compromise — the rollups are better at it.
 */
export const FORBIDDEN_LABELS = [
  'organizationid',
  'organization_id',
  'orgid',
  'org_id',
  'tenant',
  'tenantid',
  'tenant_id',
  'userid',
  'user_id',
  'sub',
  'email',
  'ticketid',
  'ticket_id',
  'messageid',
  'message_id',
  'documentid',
  'document_id',
  'chunkid',
  'chunk_id',
  'sessionid',
  'session_id',
  'ip',
  'path',
] as const;

/**
 * Refuses a metric definition that carries an unbounded label.
 *
 * **Thrown at construction, so a bad metric fails at BOOT** rather than being
 * discovered when Prometheus falls over weeks later. That timing is the whole
 * value: the cost of a high-cardinality label is paid slowly and by somebody
 * else, which is why a review comment is not a sufficient control.
 */
export function assertLabelsAreBounded(
  metricName: string,
  labelNames: readonly string[],
): void {
  const offending = labelNames.filter((label) =>
    (FORBIDDEN_LABELS as readonly string[]).includes(label.toLowerCase()),
  );

  if (offending.length > 0) {
    throw new Error(
      `Metric '${metricName}' declares unbounded label(s): ${offending.join(', ')}. ` +
        'Prometheus creates one series per unique label combination, so a tenant ' +
        'or resource id makes the series count unbounded and permanent. Per-tenant ' +
        'figures belong in the rollups (19-doc §2), not here.',
    );
  }
}

/**
 * The gateway's metrics
 *
 * **Served on a SEPARATE listener** (see `metrics.server.ts`), never as a route
 * on the public app. The spec says "not via Nginx", and a distinct port bound to
 * the internal interface makes that structural rather than a config rule Nginx
 * has to keep enforcing correctly forever. A metrics endpoint reachable from the
 * internet is an inventory of your traffic, error rates and queue depths.
 */
@Injectable()
export class MetricsRegistry {
  private readonly logger = new Logger(MetricsRegistry.name);

  readonly registry = new Registry();

  /** RED metrics — the baseline. */
  readonly httpRequests: Counter<'route' | 'method' | 'status'>;
  readonly httpDuration: Histogram<'route' | 'method' | 'status'>;

  /** Where cross-service latency actually shows up. */
  readonly grpcDuration: Histogram<'peer' | 'code'>;

  /** Currently invisible without this */
  readonly websocketConnections: Gauge<string>;
  readonly websocketEvents: Counter<'event'>;

  /**
   * **The one worth building first**
   *
   * Specifies a staleness alert over the `job_runs` heartbeat, and
   * exporting that table as a gauge turns it into a two-line Prometheus rule:
   *
   * ```txt
   * time() - job_last_success_timestamp_seconds{job="ledger.daily"} > 172800
   * ```
   *
   * which fires for *"it broke"* and *"it was never wired"* alike — the two
   * cases that were indistinguishable, and equally bad, when seven jobs sat
   * uncalled.
   */
  readonly jobLastSuccess: Gauge<'job' | 'service'>;

  /** Latency, NOT spend. The tenant dimension lives in the ledger. */
  readonly aiGenerationDuration: Histogram<'purpose'>;

  constructor() {
    // Process-level metrics: heap, event-loop lag, GC. Cheap, fixed
    // cardinality, and the first thing anyone wants when a pod is misbehaving.
    collectDefaultMetrics({ register: this.registry });

    this.httpRequests = this.counter({
      name: 'http_requests_total',
      help: 'HTTP requests, by route template, method and status.',
      labelNames: ['route', 'method', 'status'],
    });

    this.httpDuration = this.histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration, by route template, method and status.',
      labelNames: ['route', 'method', 'status'],
      // Tuned to this API rather than left at the default: most calls are a
      // gRPC hop plus a query, so the interesting resolution is 10ms-1s and
      // the default buckets spend half their range above 5s.
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    });

    this.grpcDuration = this.histogram({
      name: 'grpc_client_duration_seconds',
      help: 'Outbound gRPC call duration, by peer and status code.',
      // No `method` label — see `GrpcDurationMetric` in `base-grpc.client.ts`.
      // It is not reachable from the one place every call passes through, and a
      // label that reads `unknown` for most calls is worse than an absent one.
      labelNames: ['peer', 'code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    });

    this.websocketConnections = this.gauge({
      name: 'websocket_connections',
      help: 'Currently connected WebSocket clients on this instance.',
      labelNames: [],
    });

    this.websocketEvents = this.counter({
      name: 'websocket_events_total',
      help: 'WebSocket events relayed, by event name.',
      // `event` and NOT `ticket` — the event names are a fixed enum
      // (`REALTIME_EVENTS`), so the cardinality is the size of that object.
      labelNames: ['event'],
    });

    this.jobLastSuccess = this.gauge({
      name: 'job_last_success_timestamp_seconds',
      help: 'Unix timestamp of the last successful run of a scheduled job.',
      labelNames: ['job', 'service'],
    });

    this.aiGenerationDuration = this.histogram({
      name: 'ai_generation_duration_seconds',
      help: 'AI generation latency, by purpose. NO tenant label — see 23-doc §4.',
      labelNames: ['purpose'],
      buckets: [0.5, 1, 2, 3, 5, 8, 13, 21, 34],
    });

    // **The one static wiring in the gateway**, here rather than threaded
    // through twenty gRPC client constructors — see `BaseGrpcClient.durations`
    // for why. Last in the constructor because it hands out a metric the lines
    // above create.
    BaseGrpcClient.useMetrics(this.grpcDuration);
  }

  scrape(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  // Every constructor goes through one of these three, so there is no way to
  // register a metric that skipped the cardinality check.

  private counter<T extends string>(config: {
    name: string;
    help: string;
    labelNames: readonly T[];
  }): Counter<T> {
    assertLabelsAreBounded(config.name, config.labelNames);

    return new Counter({
      ...config,
      labelNames: [...config.labelNames],
      registers: [this.registry],
    });
  }

  private gauge<T extends string>(config: {
    name: string;
    help: string;
    labelNames: readonly T[];
  }): Gauge<T> {
    assertLabelsAreBounded(config.name, config.labelNames);

    return new Gauge({
      ...config,
      labelNames: [...config.labelNames],
      registers: [this.registry],
    });
  }

  private histogram<T extends string>(config: {
    name: string;
    help: string;
    labelNames: readonly T[];
    buckets?: number[];
  }): Histogram<T> {
    assertLabelsAreBounded(config.name, config.labelNames);

    return new Histogram({
      ...config,
      labelNames: [...config.labelNames],
      registers: [this.registry],
    });
  }
}
