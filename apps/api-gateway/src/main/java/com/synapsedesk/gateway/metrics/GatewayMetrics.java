package com.synapsedesk.gateway.metrics;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.MultiGauge;
import io.micrometer.core.instrument.Tags;
import io.micrometer.core.instrument.Timer;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.stereotype.Component;

/**
 * The seven series, and the only way this codebase records to them.
 *
 * <p>A class rather than {@code MeterRegistry} injected everywhere: a metric
 * created at a call site is a metric whose name and labels nothing checks. Every
 * series is declared here, so {@code MetricsSeriesContractTest} can walk them and
 * compare against the series registry ({@code test/fixtures/metrics/series.json}).
 *
 * <p><b>Label VALUES stay bounded.</b> None of these takes a tenant id, a user
 * id or a raw path: a label with unbounded values multiplies the series count
 * by its cardinality, and the first symptom is the scrape timing out rather
 * than a dashboard looking wrong.
 */
@Component
public class GatewayMetrics {

  private final MeterRegistry registry;
  private final AtomicInteger websocketConnections = new AtomicInteger();
  private final MultiGauge jobLastSuccess;

  public GatewayMetrics(MeterRegistry registry) {
    this.registry = registry;

    Gauge.builder(
      PublishedSeries.WEBSOCKET_CONNECTIONS,
      websocketConnections,
      AtomicInteger::get
    )
      .description("Currently connected WebSocket clients on this instance.")
      .register(registry);

    this.jobLastSuccess = MultiGauge.builder(PublishedSeries.JOB_LAST_SUCCESS)
      .description(
        "Unix timestamp of the last successful run of a scheduled job."
      )
      .register(registry);
  }

  /** One HTTP request, counted and timed under the same three labels. */
  public void httpRequest(
    String route,
    String method,
    int status,
    Duration took
  ) {
    String[] tags = {
      "route",
      route,
      "method",
      method,
      "status",
      String.valueOf(status),
    };

    Counter.builder(PublishedSeries.HTTP_REQUESTS)
      .tags(tags)
      .register(registry)
      .increment();
    Timer.builder(PublishedSeries.HTTP_DURATION)
      .tags(tags)
      .register(registry)
      .record(took);
  }

  /** One outbound gRPC call, by peer and status code. */
  public void grpcCall(String peer, String code, Duration took) {
    Timer.builder(PublishedSeries.GRPC_DURATION)
      .tags("peer", peer, "code", code)
      .register(registry)
      .record(took);
  }

  /** One relayed WebSocket event, by event name. */
  public void websocketEvent(String event) {
    Counter.builder(PublishedSeries.WEBSOCKET_EVENTS)
      .tag("event", event)
      .register(registry)
      .increment();
  }

  /** One inbound-email webhook request, by outcome. */
  public void inboundEmail(String outcome) {
    Counter.builder(PublishedSeries.INBOUND_EMAIL)
      .tag("outcome", outcome)
      .register(registry)
      .increment();
  }

  /** One scheduled job's last success: who owns it, and when, as a Unix timestamp. */
  public record JobSuccess(
    String scheduledJob,
    String ownerService,
    double unixSeconds
  ) {}

  /**
   * The last successful run of every scheduled job, as Unix timestamps — the series
   * an alert selects on. Replaces the WHOLE set on every scrape.
   *
   * <p><b>One value per series.</b> Each job is its own row with its own number: a
   * single shared cell would give every tag combination the same value, so two jobs
   * reporting would both read the later timestamp, and a staleness alert on the one
   * that stopped would never fire because an unrelated job kept refreshing it. The
   * labels were right and the values collided behind them.
   *
   * <p><b>Replacing, not accumulating.</b> A job removed from the schedule would
   * otherwise keep exporting its last value forever: a gauge for a job that no
   * longer exists, permanently green, in the metric whose purpose is to notice
   * absence. And a job that has never succeeded is simply not passed here: absent,
   * not zero, because zero is 1970 and satisfies any {@code time() - x > threshold}
   * rule as "catastrophically stale" rather than "unknown".
   *
   * <p>The labels are {@code scheduled_job} and {@code owner_service}, never
   * {@code job}: a scraper attaches its OWN {@code job} label, and Prometheus
   * renames a colliding exported one to {@code exported_job} unless the scrape
   * config sets {@code honor_labels}, leaving the alert selecting on a label that
   * is not there.
   */
  public void replaceJobSuccesses(List<JobSuccess> successes) {
    // Later wins for a repeated pair, as setting a gauge twice does.
    Map<List<String>, JobSuccess> byPair = new LinkedHashMap<>();
    for (JobSuccess success : successes) {
      byPair.put(
        List.of(success.scheduledJob(), success.ownerService()),
        success
      );
    }

    jobLastSuccess.register(
      byPair
        .values()
        .stream()
        .map(success ->
          MultiGauge.Row.of(
            Tags.of(
              "scheduled_job",
              success.scheduledJob(),
              "owner_service",
              success.ownerService()
            ),
            success.unixSeconds()
          )
        )
        .toList(),
      true
    );
  }

  /** Tracks the live socket count this instance is serving. */
  public void socketOpened() {
    websocketConnections.incrementAndGet();
  }

  /** @see #socketOpened() */
  public void socketClosed() {
    websocketConnections.decrementAndGet();
  }
}
