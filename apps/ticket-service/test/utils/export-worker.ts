import { INestApplication } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { AnalyticsExportProcessor } from '../../src/modules/analytics/analytics-export.processor';
import { SchedulerProcessor } from '../../src/modules/scheduler/scheduler.processor';

/**
 * Stops every live BullMQ worker, waiting for each to be READY first.
 *
 * Call this from every spec that builds an app from `AppModule` — including the
 * ones that pass without it, which are relying on timing.
 *
 * **The wait is not optional.** A BullMQ `Worker` opens its Redis connections
 * asynchronously after construction; closing one mid-connect leaves a socket
 * nobody owns, and Jest then reports *"Jest did not exit one second after the
 * test run has completed"*. `--detectOpenHandles` finds nothing, because the
 * handle belongs to a library. Without the wait, 12 of 14 suites hang when run
 * individually. `close(true)` does not help — forcing skips waiting for
 * in-flight jobs, which was never the problem.
 *
 * Stopping the workers also keeps a live `AnalyticsExportProcessor` from racing
 * the test, and keeps `SchedulerProcessor`'s cron repeats from rewriting rows a
 * suite is asserting on if it happens to run across the top of an hour.
 */
export async function stopWorkers(
  app: INestApplication | TestingModule,
): Promise<void> {
  for (const { worker } of [
    app.get(AnalyticsExportProcessor),
    app.get(SchedulerProcessor),
  ]) {
    await worker.waitUntilReady();
    await worker.close();
  }
}
