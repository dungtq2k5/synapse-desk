package com.synapsedesk.gateway.platformjobs;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.common.metrics.GatewayMetrics;
import com.synapsedesk.gateway.common.metrics.PublishedSeries;
import io.grpc.Metadata;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * What the scrape turns the heartbeats into: which jobs get a series, with whose
 * name and which value, and what a failed read does.
 */
class JobMetricsCollectorTest {

  private MeterRegistry registry;
  private JobHeartbeats heartbeats;
  private JobMetricsCollector collector;

  @BeforeEach
  void setUp() {
    registry = new SimpleMeterRegistry();
    heartbeats = mock(JobHeartbeats.class);
    collector = new JobMetricsCollector(
      heartbeats,
      new GatewayMetrics(registry)
    );
  }

  private static JobHeartbeats.Item item(
    String service,
    String job,
    Instant succeededAt,
    String health
  ) {
    return new JobHeartbeats.Item(
      service,
      job,
      new JobHeartbeats.Heartbeat(
        service,
        job,
        null,
        succeededAt,
        null,
        null,
        0
      ),
      health
    );
  }

  private void reports(JobHeartbeats.Item... items) {
    when(heartbeats.report(any())).thenReturn(
      new JobHeartbeats.Report(List.of(items), false, List.of())
    );
  }

  private Gauge series(String job, String owner) {
    return registry
      .find(PublishedSeries.JOB_LAST_SUCCESS)
      .tags("scheduled_job", job, "owner_service", owner)
      .gauge();
  }

  @Test
  void eachJobGetsItsOwnSeriesNamedForItsOwnerWithItsOwnTimestamp() {
    reports(
      item(
        "ticket-service",
        "analytics-daily",
        Instant.ofEpochSecond(1_756_684_800L),
        "healthy"
      ),
      item(
        "ingestion-service",
        "ledger-daily",
        Instant.ofEpochSecond(1_756_771_200L),
        "healthy"
      )
    );

    collector.refresh();

    assertThat(series("analytics-daily", "ticket-service").value()).isEqualTo(
      1_756_684_800d
    );
    assertThat(series("ledger-daily", "ingestion-service").value()).isEqualTo(
      1_756_771_200d
    );
  }

  @Test
  void aJobThatNeverSucceededIsAbsentNotZero() {
    reports(
      item("ticket-service", "analytics-daily", null, "never-ran"),
      item(
        "ingestion-service",
        "ledger-daily",
        Instant.ofEpochSecond(5L),
        "healthy"
      )
    );

    collector.refresh();

    assertThat(series("analytics-daily", "ticket-service")).isNull();
    assertThat(series("ledger-daily", "ingestion-service")).isNotNull();
  }

  @Test
  void aRowWithNoHeartbeatAtAllIsAbsentToo() {
    when(heartbeats.report(any())).thenReturn(
      new JobHeartbeats.Report(
        List.of(
          new JobHeartbeats.Item(
            "ticket-service",
            "analytics-daily",
            null,
            "never-ran"
          )
        ),
        true,
        List.of()
      )
    );

    collector.refresh();

    assertThat(
      registry.find(PublishedSeries.JOB_LAST_SUCCESS).gauges()
    ).isEmpty();
  }

  @Test
  void stepRowsAreExportedUnderTheirOwnService() {
    reports(
      item(
        "auth-service",
        "auth-hourly:sweep",
        Instant.ofEpochSecond(7L),
        "step"
      )
    );

    collector.refresh();

    assertThat(series("auth-hourly:sweep", "auth-service").value()).isEqualTo(
      7d
    );
  }

  @Test
  void timestampsKeepMillisecondPrecisionAsNodeDoes() {
    reports(
      item(
        "ticket-service",
        "analytics-daily",
        Instant.ofEpochSecond(1_000L, 250_000_000L),
        "healthy"
      )
    );

    collector.refresh();

    assertThat(series("analytics-daily", "ticket-service").value()).isEqualTo(
      1_000.25d
    );
  }

  @Test
  void aJobThatDisappearsFromTheReportDisappearsFromTheGauge() {
    reports(
      item("ticket-service", "a", Instant.ofEpochSecond(1L), "healthy"),
      item("ingestion-service", "b", Instant.ofEpochSecond(2L), "healthy")
    );
    collector.refresh();

    reports(item("ticket-service", "a", Instant.ofEpochSecond(1L), "healthy"));
    collector.refresh();

    assertThat(series("b", "ingestion-service")).isNull();
  }

  @Test
  void aFailedReadNeitherThrowsNorDisturbsWhatWasThere() {
    reports(item("ticket-service", "a", Instant.ofEpochSecond(1L), "healthy"));
    collector.refresh();

    when(heartbeats.report(any())).thenThrow(
      new IllegalStateException("peer down")
    );
    collector.refresh();

    // A scrape must not fail because a peer is down, and the peer's own probe is
    // what reports the outage.
    assertThat(series("a", "ticket-service").value()).isEqualTo(1d);
  }

  @Test
  void theHeartbeatsAreReadAsTheScrapeWithNoUserAndNoTenant() {
    reports();

    collector.refresh();

    ArgumentCaptor<Metadata> sent = ArgumentCaptor.forClass(Metadata.class);
    verify(heartbeats).report(sent.capture());
    Metadata metadata = sent.getValue();
    assertThat(
      metadata.get(
        Metadata.Key.of("user_agent", Metadata.ASCII_STRING_MARSHALLER)
      )
    ).isEqualTo("prometheus-scrape");
    assertThat(
      metadata.get(
        Metadata.Key.of("ip_address", Metadata.ASCII_STRING_MARSHALLER)
      )
    ).isEqualTo("127.0.0.1");
    assertThat(
      metadata.containsKey(
        Metadata.Key.of("user_id", Metadata.ASCII_STRING_MARSHALLER)
      )
    ).isFalse();
    assertThat(
      metadata.containsKey(
        Metadata.Key.of("organization_id", Metadata.ASCII_STRING_MARSHALLER)
      )
    ).isFalse();
  }
}
