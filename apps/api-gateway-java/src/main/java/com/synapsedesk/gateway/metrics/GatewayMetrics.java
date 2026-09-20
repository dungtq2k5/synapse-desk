package com.synapsedesk.gateway.metrics;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.stereotype.Component;

/**
 * The eight series, and the only way this codebase records to them.
 *
 * <p>A class rather than {@code MeterRegistry} injected everywhere, for the
 * reason the Node registry gives: a metric created at a call site is a metric
 * whose name and labels nothing checks. Every series is declared here, so
 * {@code MetricsSeriesContractTest} can walk them and compare against the
 * Node registry.
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
  private final AtomicLong lastJobSuccess = new AtomicLong();

  public GatewayMetrics(MeterRegistry registry) {
    this.registry = registry;

    Gauge.builder(PublishedSeries.WEBSOCKET_CONNECTIONS, websocketConnections, AtomicInteger::get)
        .description("Currently connected WebSocket clients on this instance.")
        .register(registry);
  }

  /** One HTTP request, counted and timed under the same three labels. */
  public void httpRequest(String route, String method, int status, Duration took) {
    String[] tags = {"route", route, "method", method, "status", String.valueOf(status)};

    Counter.builder(PublishedSeries.HTTP_REQUESTS).tags(tags).register(registry).increment();
    Timer.builder(PublishedSeries.HTTP_DURATION).tags(tags).register(registry).record(took);
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

  /** One AI generation, by purpose. NO tenant label: cardinality. */
  public void aiGeneration(String purpose, Duration took) {
    Timer.builder(PublishedSeries.AI_DURATION)
        .tag("purpose", purpose)
        .register(registry)
        .record(took);
  }

  /**
   * The last successful run of a scheduled job, as a Unix timestamp.
   *
   * <p>The series an alert selects on, which is why the labels are
   * {@code scheduled_job} and {@code owner_service} rather than {@code job}
   * and {@code service}: a scraper attaches its OWN {@code job} label, and
   * Prometheus renames a colliding exported one to {@code exported_job} unless
   * the scrape config sets {@code honor_labels}. The alert then selects on a
   * label that is not there.
   */
  public void jobSucceeded(String scheduledJob, String ownerService, long unixSeconds) {
    lastJobSuccess.set(unixSeconds);

    Gauge.builder(PublishedSeries.JOB_LAST_SUCCESS, lastJobSuccess, AtomicLong::doubleValue)
        .tags("scheduled_job", scheduledJob, "owner_service", ownerService)
        .register(registry);
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
