package com.synapsedesk.gateway.platformjobs;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.IsoDateCheck;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.auth.SuperAdminCheck;
import com.synapsedesk.gateway.config.JsIsoFormat;
import com.synapsedesk.gateway.generated.model.BackfillJobDto;
import com.synapsedesk.gateway.generated.model.JobHealthResponseDto;
import com.synapsedesk.gateway.generated.model.JobRunResultResponseDto;
import com.synapsedesk.gateway.generated.model.JobRunStatusResponseDto;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.openapi.ApiErrors;
import com.synapsedesk.gateway.web.ApiPaths;
import com.synapsedesk.gateway.web.ApiResponse;
import io.grpc.stub.MetadataUtils;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.auth.Platform.AuthJobHealthRequest;
import synapsedesk.auth.Platform.AuthJobHealthResponse;
import synapsedesk.auth.PlatformServiceGrpc;
import synapsedesk.ingestion.AiLedgerServiceGrpc;
import synapsedesk.ingestion.Ledger.AiJobHealthRequest;
import synapsedesk.ingestion.Ledger.AiJobHealthResponse;
import synapsedesk.ingestion.Ledger.RunAiRollupRequest;
import synapsedesk.ingestion.Ledger.RunAiRollupResponse;
import synapsedesk.notification.Notification.NotificationJobHealthRequest;
import synapsedesk.notification.Notification.NotificationJobHealthResponse;
import synapsedesk.notification.NotificationServiceGrpc;
import synapsedesk.ticket.Analytics.JobHealthRequest;
import synapsedesk.ticket.Analytics.JobHealthResponse;
import synapsedesk.ticket.Analytics.RunRollupRequest;
import synapsedesk.ticket.Analytics.RunRollupResponse;
import synapsedesk.ticket.AnalyticsServiceGrpc;

/**
 * `PlatformJobsApi` — the scheduled-job surface Node's own comments call
 * "the endpoint whose absence cost two domains": {@code health} judges
 * staleness against the jobs this build EXPECTS ({@link #SCHEDULED_JOBS}),
 * never against the rows a service happens to return, so a job that has
 * never run reports {@code never-ran} rather than nothing at all.
 *
 * <p><b>Gated by {@link SuperAdminCheck}</b>, the same door {@code
 * PlatformAuditLogsController} uses — every route here is
 * `/platform/jobs/*`.
 *
 * <p><b>Four legs, isolated.</b> Each backend's heartbeat table lives in its
 * own database, so one unreachable service must not fail the whole read —
 * {@link #tryLeg} reports a failure as a name in {@code unavailable} rather
 * than throwing, and a job owned by an unreachable service is EXCLUDED from
 * {@code reachable} (not reported {@code never-ran}) — reporting it would
 * page somebody about a wiring bug that does not exist. See {@code
 * platform-jobs.service.ts}'s own comment on this exact point.
 *
 * <p><b>{@code BackfillJobDto.from}/{@code to} carry no format validation</b>
 * — the generator drops {@code @IsISO8601} (there is no Bean Validation
 * equivalent to carry it forward as), so this controller checks via {@link
 * com.synapsedesk.gateway.auth.IsoDateCheck}, shared with every other DTO
 * the generator dropped it from.
 *
 * <p><b>Migrated off `PlatformJobsApi`.</b> No {@code @RequirePermission}
 * here — {@link SuperAdminCheck} is the door, same as {@code
 * PlatformAuditLogsController}.
 */
@Tag(name = "Platform Jobs")
@RestController
@RequestMapping(ApiPaths.V1)
@Validated
public class PlatformJobsController {

  private static final Logger LOG = LoggerFactory.getLogger(
    PlatformJobsController.class
  );

  private static final long DEADLINE_SECONDS = 5;
  private static final long STALENESS_FACTOR = 2;

  private static final String ANALYTICS_DAILY = "analytics-daily";
  private static final String LEDGER_DAILY = "ledger-daily";

  /** Every job this build expects — the list staleness is judged against, never the rows returned. */
  private static final List<String> SCHEDULED_JOBS = List.of(
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
  private static final Map<String, String> JOB_SERVICE = Map.ofEntries(
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

  private final AnalyticsServiceGrpc.AnalyticsServiceBlockingStub analyticsStub;
  private final AiLedgerServiceGrpc.AiLedgerServiceBlockingStub ledgerStub;
  private final PlatformServiceGrpc.PlatformServiceBlockingStub platformStub;
  private final NotificationServiceGrpc.NotificationServiceBlockingStub notificationStub;
  private final CurrentUser currentUser;
  private final SuperAdminCheck superAdminCheck;

  public PlatformJobsController(
    AnalyticsServiceGrpc.AnalyticsServiceBlockingStub analyticsStub,
    AiLedgerServiceGrpc.AiLedgerServiceBlockingStub ledgerStub,
    PlatformServiceGrpc.PlatformServiceBlockingStub platformStub,
    NotificationServiceGrpc.NotificationServiceBlockingStub notificationStub,
    CurrentUser currentUser,
    SuperAdminCheck superAdminCheck
  ) {
    this.analyticsStub = analyticsStub;
    this.ledgerStub = ledgerStub;
    this.platformStub = platformStub;
    this.notificationStub = notificationStub;
    this.currentUser = currentUser;
    this.superAdminCheck = superAdminCheck;
  }

  @GetMapping(value = "/platform/jobs", produces = { "application/json" })
  @ApiErrors({ "401" })
  public ResponseEntity<
    ApiResponse<JobHealthResponseDto>
  > platformJobsControllerGetHealthV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());
    superAdminCheck.require(context);

    List<String> unavailable = new ArrayList<>();
    List<HeartbeatRow> rows = new ArrayList<>();
    rows.addAll(
      tryLeg("ticket-service", unavailable, () -> ticketHeartbeats(context))
    );
    rows.addAll(
      tryLeg("ingestion-service", unavailable, () ->
        ingestionHeartbeats(context)
      )
    );
    rows.addAll(
      tryLeg("auth-service", unavailable, () -> authHeartbeats(context))
    );
    rows.addAll(
      tryLeg("notification-service", unavailable, () ->
        notificationHeartbeats(context)
      )
    );

    List<String> reachable = SCHEDULED_JOBS.stream()
      .filter(name -> !unavailable.contains(JOB_SERVICE.get(name)))
      .toList();

    Map<String, HeartbeatRow> byName = new HashMap<>();
    for (HeartbeatRow row : rows) {
      byName.putIfAbsent(row.jobName(), row);
    }

    long now = System.currentTimeMillis();
    Map<String, String> verdicts = new HashMap<>();
    for (String name : reachable) {
      HeartbeatRow row = byName.get(name);
      if (row == null || row.lastSucceededAt() == null) {
        verdicts.put(name, "never-ran");
        continue;
      }
      long age = now - row.lastSucceededAt().toEpochMilli();
      if (age > INTERVAL_MS.get(name) * STALENESS_FACTOR) {
        verdicts.put(name, row.consecutiveFailures() > 0 ? "failing" : "stale");
      }
    }

    List<JobRunStatusResponseDto> items = new ArrayList<>();
    for (String name : reachable) {
      HeartbeatRow row = byName.get(name);
      items.add(
        toStatusDto(
          JOB_SERVICE.get(name),
          name,
          row,
          verdicts.getOrDefault(name, "healthy")
        )
      );
    }

    // Per-step rows the schedulers also record — never judged for staleness,
    // since a step only runs when its parent does.
    Set<String> topLevel = new LinkedHashSet<>(SCHEDULED_JOBS);
    for (HeartbeatRow row : rows) {
      if (topLevel.contains(row.jobName())) {
        continue;
      }
      items.add(toStatusDto(row.service(), row.jobName(), row, "step"));
    }

    boolean degraded = !verdicts.isEmpty() || !unavailable.isEmpty();

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        new JobHealthResponseDto()
          .items(items)
          .degraded(degraded)
          .unavailable(unavailable)
      )
    );
  }

  @PostMapping(
    value = "/platform/jobs/{name}/run",
    produces = { "application/json" }
  )
  @ApiErrors({ "401", "404" })
  public ResponseEntity<
    ApiResponse<JobRunResultResponseDto>
  > platformJobsControllerRunV1(@PathVariable("name") String name) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    superAdminCheck.require(context);

    JobRunResultResponseDto data = dispatch(name, context, null, null);

    return ResponseEntity.ok(ApiResponse.of(200, "Job run complete", data));
  }

  @PostMapping(
    value = "/platform/jobs/{name}/backfill",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<JobRunResultResponseDto>
  > platformJobsControllerBackfillV1(
    @PathVariable("name") String name,
    @Valid @RequestBody BackfillJobDto backfillJobDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    superAdminCheck.require(context);

    IsoDateCheck.requireIsoDate(backfillJobDto.getFrom(), "from");
    IsoDateCheck.requireIsoDate(backfillJobDto.getTo(), "to");
    if (backfillJobDto.getFrom().compareTo(backfillJobDto.getTo()) > 0) {
      throw new ResponseStatusException(
        HttpStatus.BAD_REQUEST,
        "from must not be after to"
      );
    }

    LOG.warn(
      "BACKFILL {} {}..{} by {}: {}",
      name,
      backfillJobDto.getFrom(),
      backfillJobDto.getTo(),
      context.sub(),
      backfillJobDto.getReason()
    );

    JobRunResultResponseDto data = dispatch(
      name,
      context,
      backfillJobDto.getFrom(),
      backfillJobDto.getTo()
    );

    return ResponseEntity.ok(ApiResponse.of(200, "Backfill complete", data));
  }

  private JobRunResultResponseDto dispatch(
    String jobName,
    RequestContext context,
    String from,
    String to
  ) {
    if (ANALYTICS_DAILY.equals(jobName)) {
      RunRollupRequest.Builder wire = RunRollupRequest.newBuilder();
      if (from != null) {
        wire.setFrom(from);
      }
      if (to != null) {
        wire.setTo(to);
      }
      RunRollupResponse response = withAnalyticsMetadata(context).runRollup(
        wire.build()
      );

      return new JobRunResultResponseDto()
        .service(JobRunResultResponseDto.ServiceEnum.TICKET_SERVICE)
        .jobName(JobRunResultResponseDto.JobNameEnum.ANALYTICS_DAILY)
        .tenants(BigDecimal.valueOf(response.getTenants()))
        .rows(
          BigDecimal.valueOf(
            (long) response.getTicketRows() + response.getAgentRows()
          )
        );
    }

    if (LEDGER_DAILY.equals(jobName)) {
      RunAiRollupRequest.Builder wire = RunAiRollupRequest.newBuilder();
      if (from != null) {
        wire.setFrom(from);
      }
      if (to != null) {
        wire.setTo(to);
      }
      RunAiRollupResponse response = withLedgerMetadata(context).runAiRollup(
        wire.build()
      );

      return new JobRunResultResponseDto()
        .service(JobRunResultResponseDto.ServiceEnum.INGESTION_SERVICE)
        .jobName(JobRunResultResponseDto.JobNameEnum.LEDGER_DAILY)
        .tenants(BigDecimal.valueOf(response.getTenants()))
        .rows(BigDecimal.valueOf(response.getRows()));
    }

    // Named rather than silently ignored: a typo'd job name that returned 200
    // with zeros is indistinguishable from a job that ran and found nothing.
    throw new ResponseStatusException(
      HttpStatus.BAD_REQUEST,
      "'" + jobName + "' is not a job that can be triggered by hand"
    );
  }

  private List<HeartbeatRow> tryLeg(
    String source,
    List<String> unavailable,
    Supplier<List<HeartbeatRow>> leg
  ) {
    try {
      return leg.get();
    } catch (RuntimeException e) {
      LOG.warn("{} leg failed: {}", source, e.getMessage());
      unavailable.add(source);
      return List.of();
    }
  }

  private List<HeartbeatRow> ticketHeartbeats(RequestContext context) {
    JobHealthResponse response = withAnalyticsMetadata(context).getJobHealth(
      JobHealthRequest.getDefaultInstance()
    );

    return response
      .getItemsList()
      .stream()
      .map(item ->
        new HeartbeatRow(
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

  private List<HeartbeatRow> ingestionHeartbeats(RequestContext context) {
    AiJobHealthResponse response = withLedgerMetadata(context).getAiJobHealth(
      AiJobHealthRequest.getDefaultInstance()
    );

    return response
      .getItemsList()
      .stream()
      .map(item ->
        new HeartbeatRow(
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

  private List<HeartbeatRow> authHeartbeats(RequestContext context) {
    AuthJobHealthResponse response = withPlatformMetadata(
      context
    ).getAuthJobHealth(AuthJobHealthRequest.getDefaultInstance());

    return response
      .getItemsList()
      .stream()
      .map(item ->
        new HeartbeatRow(
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

  private List<HeartbeatRow> notificationHeartbeats(RequestContext context) {
    NotificationJobHealthResponse response = withNotificationMetadata(
      context
    ).getNotificationJobHealth(
      NotificationJobHealthRequest.getDefaultInstance()
    );

    return response
      .getItemsList()
      .stream()
      .map(item ->
        new HeartbeatRow(
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

  private static JobRunStatusResponseDto toStatusDto(
    String service,
    String jobName,
    HeartbeatRow row,
    String health
  ) {
    return new JobRunStatusResponseDto()
      .service(JobRunStatusResponseDto.ServiceEnum.fromValue(service))
      .jobName(jobName)
      .lastStartedAt(
        row != null && row.lastStartedAt() != null
          ? JsIsoFormat.PATTERN.format(row.lastStartedAt())
          : null
      )
      .lastSucceededAt(
        row != null && row.lastSucceededAt() != null
          ? JsIsoFormat.PATTERN.format(row.lastSucceededAt())
          : null
      )
      .lastDurationMs(
        row != null && row.lastDurationMs() != null
          ? BigDecimal.valueOf(row.lastDurationMs())
          : null
      )
      .lastError(row != null ? row.lastError() : null)
      .consecutiveFailures(
        BigDecimal.valueOf(row != null ? row.consecutiveFailures() : 0)
      )
      .health(JobRunStatusResponseDto.HealthEnum.fromValue(health));
  }

  private static Instant toInstant(com.google.protobuf.Timestamp timestamp) {
    return Instant.ofEpochSecond(timestamp.getSeconds(), timestamp.getNanos());
  }

  private AnalyticsServiceGrpc.AnalyticsServiceBlockingStub withAnalyticsMetadata(
    RequestContext context
  ) {
    return analyticsStub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }

  private AiLedgerServiceGrpc.AiLedgerServiceBlockingStub withLedgerMetadata(
    RequestContext context
  ) {
    return ledgerStub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }

  private PlatformServiceGrpc.PlatformServiceBlockingStub withPlatformMetadata(
    RequestContext context
  ) {
    return platformStub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }

  private NotificationServiceGrpc.NotificationServiceBlockingStub withNotificationMetadata(
    RequestContext context
  ) {
    return notificationStub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }

  /** One heartbeat row, service-agnostic — the four generated `*JobRunStatus` types collapse into this. */
  private record HeartbeatRow(
    String service,
    String jobName,
    Instant lastStartedAt,
    Instant lastSucceededAt,
    Integer lastDurationMs,
    String lastError,
    int consecutiveFailures
  ) {}
}
