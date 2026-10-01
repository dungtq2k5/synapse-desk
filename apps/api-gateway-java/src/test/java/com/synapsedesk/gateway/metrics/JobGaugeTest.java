package com.synapsedesk.gateway.metrics;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.metrics.GatewayMetrics.JobSuccess;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * {@code job_last_success_timestamp_seconds}: one value per series, replaced as a
 * whole on every refresh.
 *
 * <p>One job cannot tell a per-job gauge from a shared cell — the labels are right
 * either way — so these rows report two and read each back.
 */
class JobGaugeTest {

  private MeterRegistry registry;
  private GatewayMetrics metrics;

  @BeforeEach
  void setUp() {
    registry = new SimpleMeterRegistry();
    metrics = new GatewayMetrics(registry);
  }

  private Gauge series(String job, String owner) {
    return registry
      .find(PublishedSeries.JOB_LAST_SUCCESS)
      .tags("scheduled_job", job, "owner_service", owner)
      .gauge();
  }

  @Test
  void twoJobsAreTwoSeriesWithTwoValues() {
    metrics.replaceJobSuccesses(
      List.of(
        new JobSuccess("ledger-daily", "ingestion-service", 1_000d),
        new JobSuccess("analytics-daily", "ticket-service", 2_000d)
      )
    );

    assertThat(series("ledger-daily", "ingestion-service").value()).isEqualTo(
      1_000d
    );
    assertThat(series("analytics-daily", "ticket-service").value()).isEqualTo(
      2_000d
    );
  }

  @Test
  void aJobThatMovesDoesNotMoveTheOthers() {
    metrics.replaceJobSuccesses(
      List.of(
        new JobSuccess("a", "ticket-service", 1d),
        new JobSuccess("b", "ingestion-service", 2d)
      )
    );
    metrics.replaceJobSuccesses(
      List.of(
        new JobSuccess("a", "ticket-service", 100d),
        new JobSuccess("b", "ingestion-service", 2d)
      )
    );

    assertThat(series("a", "ticket-service").value()).isEqualTo(100d);
    assertThat(series("b", "ingestion-service").value()).isEqualTo(2d);
  }

  @Test
  void aJobThatIsNoLongerReportedIsGone() {
    metrics.replaceJobSuccesses(
      List.of(
        new JobSuccess("a", "ticket-service", 1d),
        new JobSuccess("b", "ingestion-service", 2d)
      )
    );

    metrics.replaceJobSuccesses(
      List.of(new JobSuccess("a", "ticket-service", 1d))
    );

    assertThat(series("b", "ingestion-service")).isNull();
    assertThat(series("a", "ticket-service")).isNotNull();
  }

  @Test
  void anEmptyReadRemovesEverythingRatherThanKeepingTheLastValues() {
    metrics.replaceJobSuccesses(
      List.of(new JobSuccess("a", "ticket-service", 1d))
    );

    metrics.replaceJobSuccesses(List.of());

    assertThat(
      registry.find(PublishedSeries.JOB_LAST_SUCCESS).gauges()
    ).isEmpty();
  }

  @Test
  void theSamePairTwiceIsOneSeriesAndTheLaterWins() {
    metrics.replaceJobSuccesses(
      List.of(
        new JobSuccess("a", "ticket-service", 1d),
        new JobSuccess("a", "ticket-service", 9d)
      )
    );

    assertThat(
      registry.find(PublishedSeries.JOB_LAST_SUCCESS).gauges()
    ).hasSize(1);
    assertThat(series("a", "ticket-service").value()).isEqualTo(9d);
  }

  @Test
  void theSeriesCarriesExactlyScheduledJobAndOwnerServiceNeverJob() {
    metrics.replaceJobSuccesses(
      List.of(new JobSuccess("a", "ticket-service", 1d))
    );

    Gauge gauge = registry.find(PublishedSeries.JOB_LAST_SUCCESS).gauge();

    assertThat(gauge.getId().getTags())
      .extracting(tag -> tag.getKey())
      .containsExactlyInAnyOrder("scheduled_job", "owner_service");
    assertThat(
      PublishedSeries.LABELS.get(PublishedSeries.JOB_LAST_SUCCESS)
    ).containsExactly("scheduled_job", "owner_service");
  }
}
