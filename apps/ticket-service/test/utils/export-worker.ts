import { INestApplication } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { AnalyticsExportProcessor } from '../../src/modules/analytics/analytics-export.processor';

/**
 * Stops the export worker, and waits for it to be READY before doing so.
 *
 * Two separate reasons, and the second is the one that is easy to get wrong.
 *
 * **Why stop it.** `AnalyticsExportProcessor` is a real BullMQ `@Processor`
 * against the same Redis the tests use, so a queued job is picked up by the live
 * worker in this process, racing whatever the test does explicitly. The symptom
 * was an export a test had just watched FAIL coming back READY a moment later,
 * which reads as a bug in the code under test rather than in the fixture.
 *
 * **Why `waitUntilReady()` first.** A BullMQ `Worker` opens its Redis
 * connections asynchronously after construction. Closing one that has not
 * finished connecting tears down what exists and lets the rest arrive
 * afterwards — a live socket nobody owns and nothing will ever close. The
 * process then stays alive after the last test, which Jest reports as:
 *
 *     Jest did not exit one second after the test run has completed.
 *
 * `--detectOpenHandles` finds nothing when this happens, because the handle
 * belongs to a library rather than to anything Jest instrumented — which is
 * what makes it worth a named helper instead of a line each spec re-derives.
 *
 * Measured rather than reasoned about: without the wait, 12 of the 14 suites
 * hang when run individually. `close(true)` does NOT help — forcing skips
 * waiting for in-flight jobs, which was never the problem.
 *
 * Every app built from `AppModule` gets its own worker, so every spec that
 * builds one needs this — including the two that happen to pass today, because
 * what they are relying on is timing.
 */
export async function stopExportWorker(
  app: INestApplication | TestingModule,
): Promise<void> {
  const { worker } = app.get(AnalyticsExportProcessor);

  await worker.waitUntilReady();
  await worker.close();
}
