import { Global, Module } from '@nestjs/common';
import { MetricsRegistry } from './metrics.registry';
import { MetricsServer } from './metrics.server';
import { JobMetricsCollector } from './job-metrics.collector';
import { PlatformJobsModule } from '../platform-jobs/platform-jobs.module';

/**
 * Metrics.
 *
 * `@Global` for one reason: `MetricsRegistry` is a single `@prometheus-io/client` registry,
 * and providing it twice would give the process two disjoint sets of counters —
 * one of which nothing scrapes. The same argument `QdrantModule` makes for its
 * client.
 *
 * **No controller.** `/metrics` is served by `MetricsServer` on its own
 * listener, deliberately not as a route on the public app — see that class.
 */
@Global()
@Module({
  imports: [PlatformJobsModule],
  providers: [MetricsRegistry, JobMetricsCollector, MetricsServer],
  exports: [MetricsRegistry, MetricsServer],
})
export class MetricsModule {}
