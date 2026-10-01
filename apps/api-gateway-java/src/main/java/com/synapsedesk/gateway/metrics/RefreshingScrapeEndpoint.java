package com.synapsedesk.gateway.metrics;

import com.synapsedesk.gateway.platformjobs.JobMetricsCollector;
import io.prometheus.metrics.model.registry.PrometheusRegistry;
import java.util.Properties;
import java.util.Set;
import org.jspecify.annotations.Nullable;
import org.springframework.boot.actuate.endpoint.annotation.ReadOperation;
import org.springframework.boot.actuate.endpoint.web.WebEndpointResponse;
import org.springframework.boot.actuate.endpoint.web.annotation.WebEndpoint;
import org.springframework.boot.micrometer.metrics.autoconfigure.export.prometheus.PrometheusOutputFormat;
import org.springframework.boot.micrometer.metrics.autoconfigure.export.prometheus.PrometheusScrapeEndpoint;

/**
 * {@code /metrics}, with the job gauge refreshed first.
 *
 * <p>Actuator's own scrape endpoint, unchanged but for one line: the heartbeats are
 * read when Prometheus asks, so the value is never staler than the scrape interval.
 * A subclass rather than a second endpoint so the id, the path mapping and the
 * exposure setting stay exactly as configured; Actuator's own bean backs off
 * because this one is of its type.
 *
 * <p>The refresh never throws (see {@link JobMetricsCollector}), so a peer that is
 * down cannot turn a scrape into an error.
 */
@WebEndpoint(id = "prometheus")
public class RefreshingScrapeEndpoint extends PrometheusScrapeEndpoint {

  private final JobMetricsCollector jobs;

  public RefreshingScrapeEndpoint(
    PrometheusRegistry registry,
    Properties exporterProperties,
    JobMetricsCollector jobs
  ) {
    super(registry, exporterProperties);
    this.jobs = jobs;
  }

  @ReadOperation(producesFrom = PrometheusOutputFormat.class)
  @Override
  public WebEndpointResponse<byte[]> scrape(
    PrometheusOutputFormat format,
    @Nullable Set<String> includedNames
  ) {
    jobs.refresh();

    return super.scrape(format, includedNames);
  }
}
