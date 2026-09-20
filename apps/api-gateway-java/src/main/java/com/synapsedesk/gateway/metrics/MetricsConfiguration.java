package com.synapsedesk.gateway.metrics;

import io.micrometer.core.instrument.Meter;
import io.micrometer.core.instrument.config.MeterFilter;
import io.micrometer.core.instrument.distribution.DistributionStatisticConfig;
import java.time.Duration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * What leaves this process, and in what shape.
 *
 * <p><b>An allowlist, not a list of exclusions.</b> Actuator publishes several
 * dozen families of its own — {@code jvm_*}, {@code executor_*},
 * {@code disk_*}, {@code tomcat_*}, {@code application_*} and its own
 * {@code http_server_requests_seconds}, which measures the same requests as
 * {@code http_request_duration_seconds} under a different name. Measured (J5):
 * naming them one by one to exclude would be a list that goes stale the first
 * time Actuator adds a binder, and the failure direction is EXTRA series
 * appearing quietly. Denying everything unpublished means a new family has to
 * be added here deliberately.
 */
@Configuration
public class MetricsConfiguration {

  /** Nothing outside {@link PublishedSeries} reaches the scrape. */
  @Bean
  MeterFilter onlyThePublishedSeries() {
    return MeterFilter.denyUnless(id -> PublishedSeries.LABELS.containsKey(id.getName()));
  }

  /**
   * Node's bucket boundaries, applied as service-level objectives.
   *
   * <p>A filter rather than a builder call per histogram, so the boundaries
   * live once beside the names they belong to. Without it Micrometer emits a
   * SUMMARY — {@code _count} and {@code _sum} only — and every
   * {@code histogram_quantile()} in a dashboard silently returns nothing.
   *
   * <p><b>A Timer's objectives are NANOSECONDS, not seconds.</b> Measured, and
   * it fails silently: Node's {@code 0.5} passed through unconverted became a
   * bucket at {@code le="5.0E-10"}, so the series, the labels and the bucket
   * COUNT all looked right and every bucket held zero. The same unit trap as
   * the cookie's {@code Max-Age}, one layer over — the boundaries are written
   * in the unit the environment and the dashboards use, and converted here,
   * once.
   */
  @Bean
  MeterFilter nodesBuckets() {
    return new MeterFilter() {
      @Override
      public DistributionStatisticConfig configure(
          Meter.Id id, DistributionStatisticConfig config) {
        double[] buckets = PublishedSeries.BUCKETS.get(id.getName());

        if (buckets == null) {
          return config;
        }

        double[] inBaseUnit = new double[buckets.length];
        for (int i = 0; i < buckets.length; i++) {
          inBaseUnit[i] =
              id.getType() == Meter.Type.TIMER
                  ? Duration.ofNanos((long) (buckets[i] * 1_000_000_000L)).toNanos()
                  : buckets[i];
        }

        return DistributionStatisticConfig.builder()
            .serviceLevelObjectives(inBaseUnit)
            .percentilesHistogram(false)
            .build()
            .merge(config);
      }
    };
  }
}
