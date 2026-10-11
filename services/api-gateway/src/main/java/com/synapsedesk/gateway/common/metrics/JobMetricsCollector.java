package com.synapsedesk.gateway.common.metrics;

import com.synapsedesk.gateway.common.auth.RequestOrigin;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import com.synapsedesk.gateway.common.metrics.GatewayMetrics;
import com.synapsedesk.gateway.common.metrics.GatewayMetrics.JobSuccess;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Exports {@code job_last_success_timestamp_seconds} from the {@code job_runs}
 * heartbeats.
 *
 * <p>Exporting that table as a gauge turns a staleness alert into a Prometheus
 * rule ({@code time() - job_last_success_timestamp_seconds{scheduled_job="ledger-daily"}
 * > 172800}) that fires for "it broke" and "it was never wired" alike.
 *
 * <p><b>Collected ON SCRAPE rather than on a timer</b>, so the value is never
 * staler than the scrape interval and nothing runs in a pod nobody is scraping.
 * There is no consumer behind it: the heartbeats are read from the owning services
 * over gRPC, each time.
 *
 * <p><b>A scrape must not fail because a peer is down.</b> A leg that does not
 * answer is reported by {@link JobHeartbeats} and its jobs are simply absent; if
 * the read itself fails, the gauge keeps its previous values and the peer's own
 * probe is what reports the outage — this endpoint reporting it too would be a
 * second, worse copy.
 */
@Component
public class JobMetricsCollector {

  private static final Logger LOG = LoggerFactory.getLogger(
    JobMetricsCollector.class
  );

  /**
   * The identity of a scrape: it has no user, so it travels with an origin and no
   * subject. The user agent is what a peer's call log names it by.
   */
  static final RequestOrigin SCRAPE_ORIGIN = new RequestOrigin(
    "127.0.0.1",
    "prometheus-scrape"
  );

  private final JobHeartbeats heartbeats;
  private final GatewayMetrics metrics;

  public JobMetricsCollector(JobHeartbeats heartbeats, GatewayMetrics metrics) {
    this.heartbeats = heartbeats;
    this.metrics = metrics;
  }

  public void refresh() {
    try {
      JobHeartbeats.Report report = heartbeats.report(
        CallerMetadata.of(SCRAPE_ORIGIN)
      );

      List<JobSuccess> successes = new ArrayList<>();
      for (JobHeartbeats.Item item : report.items()) {
        // ABSENT, not zero: see GatewayMetrics#replaceJobSuccesses.
        if (item.row() == null || item.row().lastSucceededAt() == null) {
          continue;
        }
        successes.add(
          new JobSuccess(
            item.jobName(),
            item.service(),
            // Seconds, keeping millisecond precision as the fraction.
            item.row().lastSucceededAt().toEpochMilli() / 1000d
          )
        );
      }

      metrics.replaceJobSuccesses(successes);
    } catch (RuntimeException failure) {
      LOG.warn("Job metrics refresh failed: {}", failure.getMessage());
    }
  }
}
