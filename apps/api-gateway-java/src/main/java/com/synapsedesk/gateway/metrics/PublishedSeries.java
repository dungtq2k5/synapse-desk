package com.synapsedesk.gateway.metrics;

import java.util.List;
import java.util.Map;

/**
 * The series this gateway publishes, and the labels each carries.
 *
 * <p><b>The names are Node's, exactly.</b> Both implementations answer on one
 * Service under one scrape job, so a switch must not move a series: a renamed
 * one makes every alert that selects it match nothing, and a dashboard of
 * empty panels reads as "quiet" rather than as "broken". That is plan 78's
 * gap 37 one layer up.
 *
 * <p>Three settings make Micrometer emit these verbatim, all measured (J5):
 * meters are NAMED with the full Prometheus name including its unit suffix,
 * so the naming convention has nothing to append; histograms declare Node's
 * boundaries as service-level objectives, so the {@code le} buckets match;
 * and {@link MetricsConfiguration} denies everything not listed here, which
 * removes the JVM, executor, disk and Tomcat families Actuator would
 * otherwise add.
 */
public final class PublishedSeries {

  private PublishedSeries() {}

  public static final String HTTP_REQUESTS = "http_requests_total";
  public static final String HTTP_DURATION = "http_request_duration_seconds";
  public static final String GRPC_DURATION = "grpc_client_duration_seconds";
  public static final String WEBSOCKET_CONNECTIONS = "websocket_connections";
  public static final String WEBSOCKET_EVENTS = "websocket_events_total";
  public static final String INBOUND_EMAIL = "inbound_email_webhook_total";
  public static final String JOB_LAST_SUCCESS = "job_last_success_timestamp_seconds";
  public static final String AI_DURATION = "ai_generation_duration_seconds";

  /** series name -> its label names, in the order the Node registry declares. */
  public static final Map<String, List<String>> LABELS =
      Map.of(
          HTTP_REQUESTS, List.of("route", "method", "status"),
          HTTP_DURATION, List.of("route", "method", "status"),
          GRPC_DURATION, List.of("peer", "code"),
          WEBSOCKET_CONNECTIONS, List.of(),
          WEBSOCKET_EVENTS, List.of("event"),
          INBOUND_EMAIL, List.of("outcome"),
          JOB_LAST_SUCCESS, List.of("scheduled_job", "owner_service"),
          AI_DURATION, List.of("purpose"));

  /** Node's bucket boundaries, in SECONDS, per histogram. */
  public static final Map<String, double[]> BUCKETS =
      Map.of(
          HTTP_DURATION, new double[] {0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10},
          GRPC_DURATION, new double[] {0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5},
          AI_DURATION, new double[] {0.5, 1, 2, 3, 5, 8, 13, 21, 34});
}
