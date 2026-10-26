package com.synapsedesk.gateway.common.metrics;

import java.util.List;
import java.util.Map;

/**
 * The series this gateway publishes, and the labels each carries.
 *
 * <p><b>The names are the registry's, exactly</b>
 * ({@code test/fixtures/metrics/series.json}). Alerts and dashboards select
 * them: a renamed series makes every alert that selects it match nothing, and
 * a dashboard of empty panels reads as "quiet" rather than as "broken".
 *
 * <p>Three settings make Micrometer emit these verbatim, all measured (J5):
 * meters are NAMED with the full Prometheus name including its unit suffix,
 * so the naming convention has nothing to append; histograms declare the
 * boundaries below as service-level objectives, so the {@code le} buckets match;
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
  public static final String CLIENT_ERRORS = "client_errors_total";
  public static final String JOB_LAST_SUCCESS =
    "job_last_success_timestamp_seconds";

  /** series name -> its label names, in the order each meter is tagged. */
  public static final Map<String, List<String>> LABELS = Map.of(
    HTTP_REQUESTS,
    List.of("route", "method", "status"),
    HTTP_DURATION,
    List.of("route", "method", "status"),
    GRPC_DURATION,
    List.of("peer", "code"),
    WEBSOCKET_CONNECTIONS,
    List.of(),
    WEBSOCKET_EVENTS,
    List.of("event"),
    INBOUND_EMAIL,
    List.of("outcome"),
    CLIENT_ERRORS,
    List.of("kind"),
    JOB_LAST_SUCCESS,
    List.of("scheduled_job", "owner_service")
  );

  /** The bucket boundaries the dashboards read, in SECONDS, per histogram. */
  public static final Map<String, double[]> BUCKETS = Map.of(
    HTTP_DURATION,
    new double[] { 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10 },
    GRPC_DURATION,
    new double[] { 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5 }
  );
}
