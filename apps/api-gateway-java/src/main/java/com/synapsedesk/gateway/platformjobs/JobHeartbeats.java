package com.synapsedesk.gateway.platformjobs;

import com.synapsedesk.gateway.grpc.CallerMetadata;
import io.grpc.Metadata;
import io.grpc.stub.MetadataUtils;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import synapsedesk.auth.Platform.AuthJobHealthRequest;
import synapsedesk.auth.Platform.AuthJobHealthResponse;
import synapsedesk.auth.PlatformServiceGrpc;
import synapsedesk.ingestion.AiLedgerServiceGrpc;
import synapsedesk.ingestion.Ledger.AiJobHealthRequest;
import synapsedesk.ingestion.Ledger.AiJobHealthResponse;
import synapsedesk.notification.Notification.NotificationJobHealthRequest;
import synapsedesk.notification.Notification.NotificationJobHealthResponse;
import synapsedesk.notification.NotificationServiceGrpc;
import synapsedesk.ticket.Analytics.JobHealthRequest;
import synapsedesk.ticket.Analytics.JobHealthResponse;
import synapsedesk.ticket.AnalyticsServiceGrpc;

/**
 * What every scheduled job last did, read from the four services that own the
 * heartbeat tables — {@code PlatformJobsService.health}, reproduced.
 *
 * <p>Shared by {@code GET /platform/jobs} and by the Prometheus scrape: the scrape
 * reads the same heartbeats and has no user, so it passes a bare origin, and
 * inventing a user would put a fake actor in the audit trail of a read nobody
 * performed.
 *
 * <p><b>Four legs, in parallel.</b> The heartbeat table lives in each service's
 * own database. A leg that fails names its service in {@code unavailable} and
 * contributes nothing: a job on a service that did not answer is UNKNOWN, not
 * "never ran", and reporting it as never-ran would page somebody about a wiring
 * bug that does not exist. In parallel because the scrape waits on the slowest:
 * four sequential deadlines could outlast Prometheus's own scrape timeout.
 */
@Service
public class JobHeartbeats {

  private static final Logger LOG = LoggerFactory.getLogger(
    JobHeartbeats.class
  );

  static final long DEADLINE_SECONDS = 5;
  private static final long STALENESS_FACTOR = 2;

  /** Every job this build expects — the list staleness is judged against, never the rows returned. */
  static final List<String> SCHEDULED_JOBS = List.of(
    "ledger-hourly",
    "ledger-daily",
    "analytics-daily",
    "auth-hourly",
    "auth-daily",
    "billing-snapshot",
    "ingestion-reconcile",
    "scope-reconcile",
    "webhook-retention"
  );

  /** Which service owns each schedule — `JOB_SERVICE`, reproduced. */
  static final Map<String, String> JOB_SERVICE = Map.ofEntries(
    Map.entry("ledger-hourly", "ingestion-service"),
    Map.entry("ledger-daily", "ingestion-service"),
    Map.entry("analytics-daily", "ticket-service"),
    Map.entry("auth-hourly", "auth-service"),
    Map.entry("auth-daily", "auth-service"),
    Map.entry("billing-snapshot", "auth-service"),
    Map.entry("ingestion-reconcile", "ingestion-service"),
    Map.entry("scope-reconcile", "ingestion-service"),
    Map.entry("webhook-retention", "notification-service")
  );

  /** Interval per job (ms), derived from its cron pattern — `INTERVAL_MS`, reproduced. */
  private static final Map<String, Long> INTERVAL_MS = Map.ofEntries(
    Map.entry("ledger-hourly", 60 * 60 * 1000L),
    Map.entry("ledger-daily", 24 * 60 * 60 * 1000L),
    Map.entry("analytics-daily", 24 * 60 * 60 * 1000L),
    Map.entry("auth-hourly", 60 * 60 * 1000L),
    Map.entry("auth-daily", 24 * 60 * 60 * 1000L),
    Map.entry("billing-snapshot", 60 * 60 * 1000L),
    Map.entry("ingestion-reconcile", 10 * 60 * 1000L),
    Map.entry("scope-reconcile", 60 * 60 * 1000L),
    Map.entry("webhook-retention", 24 * 60 * 60 * 1000L)
  );

  /** One heartbeat row, service-agnostic — the four generated `*JobRunStatus` types collapse into this. */
  record Heartbeat(
    String service,
    String jobName,
    Instant lastStartedAt,
    Instant lastSucceededAt,
    Integer lastDurationMs,
    String lastError,
    int consecutiveFailures
  ) {}

  /** One line of the report: a job, who owns it, its latest row (absent when it never ran) and the verdict. */
  record Item(String service, String jobName, Heartbeat row, String health) {}

  /** What was read, and what could not be. */
  record Report(List<Item> items, boolean degraded, List<String> unavailable) {}

  private final AnalyticsServiceGrpc.AnalyticsServiceBlockingStub analyticsStub;
  private final AiLedgerServiceGrpc.AiLedgerServiceBlockingStub ledgerStub;
  private final PlatformServiceGrpc.PlatformServiceBlockingStub platformStub;
  private final NotificationServiceGrpc.NotificationServiceBlockingStub notificationStub;

  public JobHeartbeats(
    AnalyticsServiceGrpc.AnalyticsServiceBlockingStub analyticsStub,
    AiLedgerServiceGrpc.AiLedgerServiceBlockingStub ledgerStub,
    PlatformServiceGrpc.PlatformServiceBlockingStub platformStub,
    NotificationServiceGrpc.NotificationServiceBlockingStub notificationStub
  ) {
    this.analyticsStub = analyticsStub;
    this.ledgerStub = ledgerStub;
    this.platformStub = platformStub;
    this.notificationStub = notificationStub;
  }

  /** The report, for a caller who has {@code CallerMetadata} to present. */
  Report report(Metadata caller) {
    List<String> sources = List.of(
      "ticket-service",
      "ingestion-service",
      "auth-service",
      "notification-service"
    );
    List<Callable<List<Heartbeat>>> legs = List.of(
      () -> ticketHeartbeats(caller),
      () -> ingestionHeartbeats(caller),
      () -> authHeartbeats(caller),
      () -> notificationHeartbeats(caller)
    );

    List<String> unavailable = new ArrayList<>();
    List<Heartbeat> rows = new ArrayList<>();
    try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor()) {
      List<Future<List<Heartbeat>>> started = new ArrayList<>();
      for (Callable<List<Heartbeat>> leg : legs) started.add(pool.submit(leg));

      // In leg order, so `unavailable` reads the same whichever answered first.
      for (int i = 0; i < started.size(); i++) {
        try {
          rows.addAll(started.get(i).get());
        } catch (ExecutionException failure) {
          LOG.warn(
            "{} leg failed: {}",
            sources.get(i),
            failure.getCause().getMessage()
          );
          unavailable.add(sources.get(i));
        } catch (InterruptedException interrupted) {
          Thread.currentThread().interrupt();
          unavailable.add(sources.get(i));
        }
      }
    }

    // Only the jobs whose owning service ANSWERED.
    List<String> reachable = SCHEDULED_JOBS.stream()
      .filter(name -> !unavailable.contains(JOB_SERVICE.get(name)))
      .toList();

    Map<String, Heartbeat> byName = new HashMap<>();
    for (Heartbeat row : rows) {
      byName.putIfAbsent(row.jobName(), row);
    }

    long now = System.currentTimeMillis();
    Map<String, String> verdicts = new HashMap<>();
    for (String name : reachable) {
      Heartbeat row = byName.get(name);
      if (row == null || row.lastSucceededAt() == null) {
        verdicts.put(name, "never-ran");
        continue;
      }
      long age = now - row.lastSucceededAt().toEpochMilli();
      if (age > INTERVAL_MS.get(name) * STALENESS_FACTOR) {
        verdicts.put(name, row.consecutiveFailures() > 0 ? "failing" : "stale");
      }
    }

    List<Item> items = new ArrayList<>();
    for (String name : reachable) {
      items.add(
        new Item(
          JOB_SERVICE.get(name),
          name,
          byName.get(name),
          verdicts.getOrDefault(name, "healthy")
        )
      );
    }

    // Per-step rows the schedulers also record — never judged for staleness,
    // since a step only runs when its parent does.
    Set<String> topLevel = new LinkedHashSet<>(SCHEDULED_JOBS);
    for (Heartbeat row : rows) {
      if (!topLevel.contains(row.jobName())) {
        items.add(new Item(row.service(), row.jobName(), row, "step"));
      }
    }

    return new Report(
      items,
      !verdicts.isEmpty() || !unavailable.isEmpty(),
      unavailable
    );
  }

  // ------------------------------------------------------------ the four legs

  private List<Heartbeat> ticketHeartbeats(Metadata caller) {
    JobHealthResponse response = with(analyticsStub, caller).getJobHealth(
      JobHealthRequest.getDefaultInstance()
    );

    return response
      .getItemsList()
      .stream()
      .map(item ->
        new Heartbeat(
          "ticket-service",
          item.getJobName(),
          item.hasLastStartedAt() ? toInstant(item.getLastStartedAt()) : null,
          item.hasLastSucceededAt()
            ? toInstant(item.getLastSucceededAt())
            : null,
          item.hasLastDurationMs() ? item.getLastDurationMs() : null,
          item.hasLastError() ? item.getLastError() : null,
          item.getConsecutiveFailures()
        )
      )
      .toList();
  }

  private List<Heartbeat> ingestionHeartbeats(Metadata caller) {
    AiJobHealthResponse response = with(ledgerStub, caller).getAiJobHealth(
      AiJobHealthRequest.getDefaultInstance()
    );

    return response
      .getItemsList()
      .stream()
      .map(item ->
        new Heartbeat(
          "ingestion-service",
          item.getJobName(),
          item.hasLastStartedAt() ? toInstant(item.getLastStartedAt()) : null,
          item.hasLastSucceededAt()
            ? toInstant(item.getLastSucceededAt())
            : null,
          item.hasLastDurationMs() ? item.getLastDurationMs() : null,
          item.hasLastError() ? item.getLastError() : null,
          item.getConsecutiveFailures()
        )
      )
      .toList();
  }

  private List<Heartbeat> authHeartbeats(Metadata caller) {
    AuthJobHealthResponse response = with(
      platformStub,
      caller
    ).getAuthJobHealth(AuthJobHealthRequest.getDefaultInstance());

    return response
      .getItemsList()
      .stream()
      .map(item ->
        new Heartbeat(
          "auth-service",
          item.getJobName(),
          item.hasLastStartedAt() ? toInstant(item.getLastStartedAt()) : null,
          item.hasLastSucceededAt()
            ? toInstant(item.getLastSucceededAt())
            : null,
          item.hasLastDurationMs() ? item.getLastDurationMs() : null,
          item.hasLastError() ? item.getLastError() : null,
          item.getConsecutiveFailures()
        )
      )
      .toList();
  }

  private List<Heartbeat> notificationHeartbeats(Metadata caller) {
    NotificationJobHealthResponse response = with(
      notificationStub,
      caller
    ).getNotificationJobHealth(
      NotificationJobHealthRequest.getDefaultInstance()
    );

    return response
      .getItemsList()
      .stream()
      .map(item ->
        new Heartbeat(
          "notification-service",
          item.getJobName(),
          item.hasLastStartedAt() ? toInstant(item.getLastStartedAt()) : null,
          item.hasLastSucceededAt()
            ? toInstant(item.getLastSucceededAt())
            : null,
          item.hasLastDurationMs() ? item.getLastDurationMs() : null,
          item.hasLastError() ? item.getLastError() : null,
          item.getConsecutiveFailures()
        )
      )
      .toList();
  }

  private static <S extends io.grpc.stub.AbstractStub<S>> S with(
    S stub,
    Metadata caller
  ) {
    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(caller));
  }

  private static Instant toInstant(com.google.protobuf.Timestamp timestamp) {
    return Instant.ofEpochSecond(timestamp.getSeconds(), timestamp.getNanos());
  }
}
