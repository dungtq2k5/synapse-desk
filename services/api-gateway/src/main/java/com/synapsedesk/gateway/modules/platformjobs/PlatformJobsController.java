package com.synapsedesk.gateway.modules.platformjobs;

import com.synapsedesk.gateway.common.auth.CurrentRequest;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.auth.SuperAdminCheck;
import com.synapsedesk.gateway.common.config.JsIsoFormat;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import com.synapsedesk.gateway.common.lifecycle.OrgAccess;
import com.synapsedesk.gateway.common.lifecycle.OrgAccessKind;
import com.synapsedesk.gateway.common.metrics.JobHeartbeats;
import com.synapsedesk.gateway.common.openapi.ApiErrors;
import com.synapsedesk.gateway.common.security.SuperAdminOnly;
import com.synapsedesk.gateway.common.web.ApiPaths;
import com.synapsedesk.gateway.common.web.ApiResponse;
import com.synapsedesk.gateway.modules.platformjobs.dto.rest.BackfillJobDto;
import com.synapsedesk.gateway.modules.platformjobs.dto.rest.JobHealthResponseDto;
import com.synapsedesk.gateway.modules.platformjobs.dto.rest.JobRunResultResponseDto;
import com.synapsedesk.gateway.modules.platformjobs.dto.rest.JobRunStatusResponseDto;
import com.synapsedesk.gateway.modules.platformjobs.dto.rest.RunJobDto;
import io.grpc.stub.MetadataUtils;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.jspecify.annotations.Nullable;
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
import synapsedesk.ingestion.AiLedgerServiceGrpc;
import synapsedesk.ingestion.Ledger.RunAiRollupRequest;
import synapsedesk.ingestion.Ledger.RunAiRollupResponse;
import synapsedesk.ticket.Analytics.RunRollupRequest;
import synapsedesk.ticket.Analytics.RunRollupResponse;
import synapsedesk.ticket.AnalyticsServiceGrpc;

/**
 * `PlatformJobsApi` — the scheduled-job surface. {@code health} judges
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
 * page somebody about a wiring bug that does not exist.
 *
 * <p><b>{@code BackfillJobDto.from}/{@code to}</b> must be strict ISO-8601
 * dates, enforced by {@code @StrictIso8601} on the DTO, the validator every
 * other date field uses.
 *
 * <p><b>Migrated off `PlatformJobsApi`.</b> No {@code @RequirePermission}
 * here — {@link SuperAdminCheck} is the door, same as {@code
 * PlatformAuditLogsController}.
 */
@Tag(name = "Platform Jobs")
@RestController
// Refused to anyone but a super admin, before the body is read (SessionInterceptor, from this marker). A super admin has no tenant, so the lifecycle gate never decides here either: the route is exempt outright.
@SuperAdminOnly
@OrgAccessKind(OrgAccess.AUTH)
@RequestMapping(ApiPaths.V1)
@Validated
public class PlatformJobsController {

  private static final Logger LOG = LoggerFactory.getLogger(
    PlatformJobsController.class
  );

  private static final long DEADLINE_SECONDS = JobHeartbeats.DEADLINE_SECONDS;

  private static final String ANALYTICS_DAILY = "analytics-daily";
  private static final String LEDGER_DAILY = "ledger-daily";

  private final AnalyticsServiceGrpc.AnalyticsServiceBlockingStub analyticsStub;
  private final AiLedgerServiceGrpc.AiLedgerServiceBlockingStub ledgerStub;
  private final CurrentUser currentUser;
  private final SuperAdminCheck superAdminCheck;
  private final JobHeartbeats heartbeats;

  public PlatformJobsController(
    AnalyticsServiceGrpc.AnalyticsServiceBlockingStub analyticsStub,
    AiLedgerServiceGrpc.AiLedgerServiceBlockingStub ledgerStub,
    CurrentUser currentUser,
    SuperAdminCheck superAdminCheck,
    JobHeartbeats heartbeats
  ) {
    this.analyticsStub = analyticsStub;
    this.ledgerStub = ledgerStub;
    this.currentUser = currentUser;
    this.superAdminCheck = superAdminCheck;
    this.heartbeats = heartbeats;
  }

  @GetMapping(value = "/platform/jobs", produces = { "application/json" })
  @ApiErrors({ "401" })
  public ResponseEntity<
    ApiResponse<JobHealthResponseDto>
  > platformJobsControllerGetHealthV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());
    superAdminCheck.require(context);

    JobHeartbeats.Report report = heartbeats.report(CallerMetadata.of(context));

    List<JobRunStatusResponseDto> items = report
      .items()
      .stream()
      .map(item ->
        toStatusDto(item.service(), item.jobName(), item.row(), item.health())
      )
      .toList();

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        new JobHealthResponseDto()
          .items(items)
          .degraded(report.degraded())
          .unavailable(report.unavailable())
      )
    );
  }

  @PostMapping(
    value = "/platform/jobs/{name}/run",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<JobRunResultResponseDto>
  > platformJobsControllerRunV1(
    @PathVariable("name") String name,
    @Valid @RequestBody RunJobDto runJobDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    superAdminCheck.require(context);

    JobRunResultResponseDto data = dispatch(
      name,
      context,
      runJobDto.getReason(),
      null,
      null,
      null
    );

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

    if (backfillJobDto.getFrom().compareTo(backfillJobDto.getTo()) > 0) {
      throw new ResponseStatusException(
        HttpStatus.BAD_REQUEST,
        "from must not be after to"
      );
    }

    UUID organizationId = backfillJobDto.getOrganizationId();
    LOG.warn(
      "BACKFILL {} {}..{}{} by {}: {}",
      name,
      backfillJobDto.getFrom(),
      backfillJobDto.getTo(),
      organizationId == null ? "" : " (" + organizationId + ")",
      context.sub(),
      backfillJobDto.getReason()
    );

    JobRunResultResponseDto data = dispatch(
      name,
      context,
      backfillJobDto.getReason(),
      backfillJobDto.getFrom(),
      backfillJobDto.getTo(),
      organizationId
    );

    return ResponseEntity.ok(ApiResponse.of(200, "Backfill complete", data));
  }

  private JobRunResultResponseDto dispatch(
    String jobName,
    RequestContext context,
    String reason,
    String from,
    String to,
    @Nullable UUID organizationId
  ) {
    if (ANALYTICS_DAILY.equals(jobName)) {
      // The reason goes down to the service, which audits the run.
      RunRollupRequest.Builder wire = RunRollupRequest.newBuilder().setReason(
        reason
      );
      if (from != null) {
        wire.setFrom(from);
      }
      if (to != null) {
        wire.setTo(to);
      }
      if (organizationId != null) {
        wire.setOrganizationId(organizationId.toString());
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
      RunAiRollupRequest.Builder wire =
        RunAiRollupRequest.newBuilder().setReason(reason);
      if (from != null) {
        wire.setFrom(from);
      }
      if (to != null) {
        wire.setTo(to);
      }
      if (organizationId != null) {
        wire.setOrganizationId(organizationId.toString());
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

  private static JobRunStatusResponseDto toStatusDto(
    String service,
    String jobName,
    JobHeartbeats.Heartbeat row,
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
}
