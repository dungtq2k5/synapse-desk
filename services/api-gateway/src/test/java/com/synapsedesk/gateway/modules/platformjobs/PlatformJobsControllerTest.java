package com.synapsedesk.gateway.modules.platformjobs;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.google.protobuf.Timestamp;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.auth.SuperAdminCheck;
import com.synapsedesk.gateway.common.metrics.JobHeartbeats;
import com.synapsedesk.gateway.modules.platformjobs.dto.rest.BackfillJobDto;
import com.synapsedesk.gateway.modules.platformjobs.dto.rest.JobHealthResponseDto;
import com.synapsedesk.gateway.modules.platformjobs.dto.rest.JobRunStatusResponseDto;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import synapsedesk.auth.Platform.AuthJobHealthResponse;
import synapsedesk.auth.PlatformServiceGrpc;
import synapsedesk.ingestion.AiLedgerServiceGrpc;
import synapsedesk.ingestion.Ledger.AiJobHealthResponse;
import synapsedesk.notification.Notification.NotificationJobHealthResponse;
import synapsedesk.notification.NotificationServiceGrpc;
import synapsedesk.ticket.Analytics.JobHealthResponse;
import synapsedesk.ticket.Analytics.JobRunStatus;
import synapsedesk.ticket.Analytics.RunRollupResponse;
import synapsedesk.ticket.AnalyticsServiceGrpc;

/**
 * `PlatformJobsApi` — `health`'s single most important property: a job
 * owned by an UNREACHABLE service is excluded from
 * the report entirely, never reported {@code never-ran}. Reporting it would
 * page somebody about a wiring bug that does not exist. Staleness verdicts
 * and step rows are the second layer this test pins.
 */
class PlatformJobsControllerTest {

  private final AnalyticsServiceGrpc.AnalyticsServiceBlockingStub analyticsStub =
    mock(AnalyticsServiceGrpc.AnalyticsServiceBlockingStub.class);
  private final AiLedgerServiceGrpc.AiLedgerServiceBlockingStub ledgerStub =
    mock(AiLedgerServiceGrpc.AiLedgerServiceBlockingStub.class);
  private final PlatformServiceGrpc.PlatformServiceBlockingStub platformStub =
    mock(PlatformServiceGrpc.PlatformServiceBlockingStub.class);
  private final NotificationServiceGrpc.NotificationServiceBlockingStub notificationStub =
    mock(NotificationServiceGrpc.NotificationServiceBlockingStub.class);
  private final CurrentUser currentUser = mock(CurrentUser.class);
  private PlatformJobsController controller;

  @BeforeEach
  void setUp() {
    when(analyticsStub.withDeadlineAfter(anyLong(), any())).thenReturn(
      analyticsStub
    );
    when(analyticsStub.withInterceptors(any())).thenReturn(analyticsStub);
    when(ledgerStub.withDeadlineAfter(anyLong(), any())).thenReturn(ledgerStub);
    when(ledgerStub.withInterceptors(any())).thenReturn(ledgerStub);
    when(platformStub.withDeadlineAfter(anyLong(), any())).thenReturn(
      platformStub
    );
    when(platformStub.withInterceptors(any())).thenReturn(platformStub);
    when(notificationStub.withDeadlineAfter(anyLong(), any())).thenReturn(
      notificationStub
    );
    when(notificationStub.withInterceptors(any())).thenReturn(notificationStub);
    when(currentUser.require(any())).thenReturn(
      new RequestContext(
        "agent-1",
        null,
        true,
        List.of(),
        List.of(),
        true,
        "127.0.0.1",
        "test"
      )
    );
    controller = new PlatformJobsController(
      analyticsStub,
      ledgerStub,
      platformStub,
      notificationStub,
      currentUser,
      new SuperAdminCheck(),
      new JobHeartbeats(
        analyticsStub,
        ledgerStub,
        platformStub,
        notificationStub
      )
    );

    // Every leg empty and reachable by default; individual tests override.
    when(analyticsStub.getJobHealth(any())).thenReturn(
      JobHealthResponse.getDefaultInstance()
    );
    when(ledgerStub.getAiJobHealth(any())).thenReturn(
      AiJobHealthResponse.getDefaultInstance()
    );
    when(platformStub.getAuthJobHealth(any())).thenReturn(
      AuthJobHealthResponse.getDefaultInstance()
    );
    when(notificationStub.getNotificationJobHealth(any())).thenReturn(
      NotificationJobHealthResponse.getDefaultInstance()
    );

    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(new MockHttpServletRequest())
    );
  }

  @AfterEach
  void tearDown() {
    RequestContextHolder.resetRequestAttributes();
  }

  @Test
  void aJobOwnedByAnUnreachableServiceIsExcludedNotReportedNeverRan() {
    when(ledgerStub.getAiJobHealth(any())).thenThrow(
      new StatusRuntimeException(Status.UNAVAILABLE)
    );

    JobHealthResponseDto data = controller
      .platformJobsControllerGetHealthV1()
      .getBody()
      .data();

    assertThat(data.getUnavailable()).containsExactly("ingestion-service");
    // ledger-hourly, ledger-daily, ingestion-reconcile, scope-reconcile are ingestion-owned.
    assertThat(data.getItems())
      .extracting(JobRunStatusResponseDto::getJobName)
      .doesNotContain(
        "ledger-hourly",
        "ledger-daily",
        "ingestion-reconcile",
        "scope-reconcile"
      );
    assertThat(data.getDegraded()).isTrue();
  }

  @Test
  void aJobWithNoRowAtAllIsNeverRan() {
    JobHealthResponseDto data = controller
      .platformJobsControllerGetHealthV1()
      .getBody()
      .data();

    JobRunStatusResponseDto analytics = data
      .getItems()
      .stream()
      .filter(item -> "analytics-daily".equals(item.getJobName()))
      .findFirst()
      .orElseThrow();
    assertThat(analytics.getHealth()).isEqualTo(
      JobRunStatusResponseDto.HealthEnum.NEVER_RAN
    );
  }

  @Test
  void aRecentSuccessIsHealthy() {
    when(analyticsStub.getJobHealth(any())).thenReturn(
      JobHealthResponse.newBuilder()
        .addItems(rowAt("analytics-daily", Instant.now(), 0))
        .build()
    );

    JobHealthResponseDto data = controller
      .platformJobsControllerGetHealthV1()
      .getBody()
      .data();

    JobRunStatusResponseDto analytics = data
      .getItems()
      .stream()
      .filter(item -> "analytics-daily".equals(item.getJobName()))
      .findFirst()
      .orElseThrow();
    assertThat(analytics.getHealth()).isEqualTo(
      JobRunStatusResponseDto.HealthEnum.HEALTHY
    );
  }

  @Test
  void anOldSuccessWithNoFailuresIsStaleNotFailing() {
    when(analyticsStub.getJobHealth(any())).thenReturn(
      JobHealthResponse.newBuilder()
        .addItems(
          rowAt(
            "analytics-daily",
            Instant.now().minusSeconds(10 * 24 * 3600),
            0
          )
        )
        .build()
    );

    JobHealthResponseDto data = controller
      .platformJobsControllerGetHealthV1()
      .getBody()
      .data();

    JobRunStatusResponseDto analytics = data
      .getItems()
      .stream()
      .filter(item -> "analytics-daily".equals(item.getJobName()))
      .findFirst()
      .orElseThrow();
    assertThat(analytics.getHealth()).isEqualTo(
      JobRunStatusResponseDto.HealthEnum.STALE
    );
  }

  @Test
  void anOldSuccessWithConsecutiveFailuresIsFailing() {
    when(analyticsStub.getJobHealth(any())).thenReturn(
      JobHealthResponse.newBuilder()
        .addItems(
          rowAt(
            "analytics-daily",
            Instant.now().minusSeconds(10 * 24 * 3600),
            3
          )
        )
        .build()
    );

    JobHealthResponseDto data = controller
      .platformJobsControllerGetHealthV1()
      .getBody()
      .data();

    JobRunStatusResponseDto analytics = data
      .getItems()
      .stream()
      .filter(item -> "analytics-daily".equals(item.getJobName()))
      .findFirst()
      .orElseThrow();
    assertThat(analytics.getHealth()).isEqualTo(
      JobRunStatusResponseDto.HealthEnum.FAILING
    );
  }

  @Test
  void aRowWhoseNameIsNotAScheduledJobIsAppendedAsAStepNeverJudged() {
    when(analyticsStub.getJobHealth(any())).thenReturn(
      JobHealthResponse.newBuilder()
        .addItems(
          rowAt(
            "ticket-rollup",
            Instant.now().minusSeconds(365L * 24 * 3600),
            99
          )
        )
        .build()
    );

    JobHealthResponseDto data = controller
      .platformJobsControllerGetHealthV1()
      .getBody()
      .data();

    JobRunStatusResponseDto step = data
      .getItems()
      .stream()
      .filter(item -> "ticket-rollup".equals(item.getJobName()))
      .findFirst()
      .orElseThrow();
    assertThat(step.getHealth()).isEqualTo(
      JobRunStatusResponseDto.HealthEnum.STEP
    );
  }

  @Test
  void runRefusesAnUntriggerableJobNameWith400() {
    assertThatThrownBy(() ->
      controller.platformJobsControllerRunV1("not-a-real-job")
    )
      .isInstanceOf(
        org.springframework.web.server.ResponseStatusException.class
      )
      .hasMessageContaining("400");
  }

  @Test
  void runDispatchesAnalyticsDailyAndSumsTicketAndAgentRows() {
    when(analyticsStub.runRollup(any())).thenReturn(
      RunRollupResponse.newBuilder()
        .setTenants(2)
        .setTicketRows(5)
        .setAgentRows(3)
        .build()
    );

    var response = controller.platformJobsControllerRunV1("analytics-daily");

    assertThat(response.getBody().message()).isEqualTo("Job run complete");
    assertThat(response.getBody().data().getRows()).isEqualTo(
      java.math.BigDecimal.valueOf(8)
    );
  }

  @Test
  void backfillRefusesFromAfterToWith400() {
    BackfillJobDto dto = new BackfillJobDto();
    dto.setFrom("2026-02-01");
    dto.setTo("2026-01-01");
    dto.setReason("test");

    assertThatThrownBy(() ->
      controller.platformJobsControllerBackfillV1("analytics-daily", dto)
    )
      .isInstanceOf(
        org.springframework.web.server.ResponseStatusException.class
      )
      .hasMessageContaining("from must not be after to");
  }

  private static JobRunStatus rowAt(
    String jobName,
    Instant lastSucceededAt,
    int consecutiveFailures
  ) {
    return JobRunStatus.newBuilder()
      .setJobName(jobName)
      .setLastSucceededAt(
        Timestamp.newBuilder()
          .setSeconds(lastSucceededAt.getEpochSecond())
          .build()
      )
      .setConsecutiveFailures(consecutiveFailures)
      .build();
  }
}
