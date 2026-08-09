import { Injectable, Logger } from '@nestjs/common';
import { formatErrorMsg, RequestOrigin } from '@synapsedesk/common';
import { PlatformJobsService } from '../platform-jobs/platform-jobs.service';
import { MetricsRegistry } from './metrics.registry';

/**
 * The internal caller identity used for the scrape.
 *
 * A scrape has no user. The heartbeat read is a platform-level operation, so it
 * travels with an origin and no subject — the same shape an unauthenticated
 * gateway call uses.
 */
const SCRAPE_ORIGIN: RequestOrigin = {
  ip: '127.0.0.1',
  userAgent: 'prometheus-scrape',
};

/**
 * Exports `job_last_success_timestamp_seconds` — 23-doc §4, and the item the
 * doc says to build first.
 *
 * 20-doc §4.2 specifies a staleness alert over the `job_runs` heartbeat.
 * Exporting that table as a gauge turns the alert into a Prometheus rule:
 *
 * ```txt
 * time() - job_last_success_timestamp_seconds{job="ledger.daily"} > 172800
 * ```
 *
 * Two lines instead of a bespoke alerting path — and it fires for *"it broke"*
 * and *"it was never wired"* alike, which were indistinguishable and equally bad
 * when seven jobs sat uncalled.
 *
 * **Collected ON SCRAPE rather than on a timer**, so the value is never staler
 * than the scrape interval and nothing runs in a pod nobody is scraping.
 */
@Injectable()
export class JobMetricsCollector {
  private readonly logger = new Logger(JobMetricsCollector.name);

  constructor(
    private readonly metrics: MetricsRegistry,
    private readonly jobs: PlatformJobsService,
  ) {}

  async refresh(): Promise<void> {
    try {
      const health = await this.jobs.health(SCRAPE_ORIGIN);

      // **Reset first.** Without it, a job removed from `SCHEDULED_JOBS` keeps
      // exporting its last value forever — a gauge for a job that no longer
      // exists, permanently green, in the metric whose whole purpose is to
      // notice absence.
      this.metrics.jobLastSuccess.reset();

      for (const item of health.items) {
        // **ABSENT, not zero** — 23-doc §4 test 4. Zero is 1970, which
        // satisfies any `time() - x > threshold` rule and reads as
        // catastrophically stale rather than as unknown. A job that has never
        // run must produce NO series, so the alert distinguishes "no data"
        // from "very old data" — and those need different responses.
        if (!item.lastSucceededAt) continue;

        this.metrics.jobLastSuccess.set(
          { job: item.jobName, service: item.service },
          new Date(item.lastSucceededAt).getTime() / 1000,
        );
      }
    } catch (error) {
      // A scrape must not fail because a peer is down. The gauge simply carries
      // its previous values, and the peer's own probe is what reports that
      // outage — this endpoint reporting it too would be a second, worse copy.
      this.logger.warn(`Job metrics refresh failed: ${formatErrorMsg(error)}`);
    }
  }
}
