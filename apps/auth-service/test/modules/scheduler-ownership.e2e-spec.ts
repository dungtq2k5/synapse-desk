import { Queue, Worker, type Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
  SCHEDULED_JOBS,
  SCHEDULER_QUEUE,
  compareAlphabetically,
} from '@synapsedesk/common';
import { E2eFixture, bootstrapE2eTest } from '../utils';
import { SchedulerProcessor } from '../../src/modules/scheduler/scheduler.processor';

/**
 * A scheduled job reaches only the service that owns it.
 *
 * **The test the bug needed and no suite had**, because it takes two services at
 * once and every suite runs one. `SCHEDULER_QUEUE` was a bare `'scheduler'`:
 * each service registered only its own repeat entries and ran a worker on
 * everyone's queue, so BullMQ handed each job to whichever worker claimed it
 * first. `ledger-hourly` arrived at ticket-service, hit its unknown-job branch,
 * and that branch RETURNED — so BullMQ recorded success and advanced the
 * schedule. Roughly two thirds of every service's runs evaporated, silently.
 *
 * **Driven with raw `Queue`/`Worker` rather than two Nest applications.** The
 * property under test is delivery — which queue a job lands on and which worker
 * may claim it — and that is decided entirely by the names in
 * `SCHEDULER_QUEUE`. Booting auth-service and ingestion-service in one jest
 * process would add a database, a gRPC server and a NATS connection to a test
 * whose subject is a Redis key. The queue names and job names below are the
 * real exported constants, so a rename cannot make this test pass by drifting
 * away from production.
 *
 * It lives in auth-service's suite because that is a harness with a real Redis;
 * it asserts nothing about auth-service in particular.
 */
describe('scheduled jobs reach only their owner (e2e)', () => {
  let fx: E2eFixture;
  /** The url the app itself uses, so this cannot drift onto another Redis. */
  let connection: { url: string };

  /** Everything a worker on a given queue actually received. */
  const seen = new Map<string, string[]>();

  const workers: Worker[] = [];
  const queues: Queue[] = [];

  const workerOn = (queueName: string): Worker => {
    seen.set(queueName, []);

    const worker = new Worker(
      queueName,
      (job: Job) => {
        seen.get(queueName)!.push(job.name);

        return Promise.resolve();
      },
      { connection, concurrency: 1 },
    );

    workers.push(worker);

    return worker;
  };

  const queueOn = (queueName: string): Queue => {
    const queue = new Queue(queueName, { connection });
    queues.push(queue);

    return queue;
  };

  /** Polls until every expected job has been observed, or gives up. */
  const settle = async (expected: number): Promise<void> => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const total = [...seen.values()].reduce(
        (count, names) => count + names.length,
        0,
      );

      if (total >= expected) return;

      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  beforeAll(async () => {
    fx = await bootstrapE2eTest();

    const config = fx.moduleRef.get(ConfigService);
    connection = { url: config.getOrThrow<string>('REDIS_URL') };
  }, 30_000);

  /**
   * Torn down per TEST, not per file.
   *
   * A worker left running from an earlier test still competes for jobs on its
   * queue — which is the very mechanism under test, so leaking one turns the
   * second case into a race whose outcome depends on which worker happened to
   * poll first. That would be a flaky test about flakiness.
   */
  afterEach(async () => {
    await Promise.all(workers.map((worker) => worker.close()));
    await Promise.all(queues.map((queue) => queue.obliterate({ force: true })));
    await Promise.all(queues.map((queue) => queue.close()));

    workers.length = 0;
    queues.length = 0;
    seen.clear();
  });

  afterAll(() => fx.close());

  it("**each service receives its OWN jobs and none of its neighbours'**", async () => {
    // The assertion the doc insists on: the job-name-to-WORKER pairing, not
    // merely that everything completed. Under the bug everything completed too
    // — that was the bug.
    const authQueue = queueOn(SCHEDULER_QUEUE.auth);
    const ingestionQueue = queueOn(SCHEDULER_QUEUE.ingestion);
    const ticketQueue = queueOn(SCHEDULER_QUEUE.ticket);

    workerOn(SCHEDULER_QUEUE.auth);
    workerOn(SCHEDULER_QUEUE.ingestion);
    workerOn(SCHEDULER_QUEUE.ticket);

    await authQueue.add(SCHEDULED_JOBS.AUTH_HOURLY, {});
    await authQueue.add(SCHEDULED_JOBS.AUTH_DAILY, {});
    await ingestionQueue.add(SCHEDULED_JOBS.LEDGER_HOURLY, {});
    await ingestionQueue.add(SCHEDULED_JOBS.LEDGER_DAILY, {});
    await ticketQueue.add(SCHEDULED_JOBS.ANALYTICS_DAILY, {});

    await settle(5);

    expect(seen.get(SCHEDULER_QUEUE.auth)!.sort(compareAlphabetically)).toEqual(
      [SCHEDULED_JOBS.AUTH_DAILY, SCHEDULED_JOBS.AUTH_HOURLY].sort(
        compareAlphabetically,
      ),
    );
    expect(
      seen.get(SCHEDULER_QUEUE.ingestion)!.sort(compareAlphabetically),
    ).toEqual(
      [SCHEDULED_JOBS.LEDGER_DAILY, SCHEDULED_JOBS.LEDGER_HOURLY].sort(
        compareAlphabetically,
      ),
    );
    expect(seen.get(SCHEDULER_QUEUE.ticket)).toEqual([
      SCHEDULED_JOBS.ANALYTICS_DAILY,
    ]);
  }, 30_000);

  it('**and a worker cannot decline a job it does not own** — the mechanism', async () => {
    // Why isolation has to come from the queue NAME rather than from each
    // processor being careful. Delivered onto ingestion's queue, ingestion's
    // worker takes `auth-hourly` without hesitation — there is no API to refuse
    // it, which is precisely what the shared queue exploited.
    //
    // Deterministic on purpose: the real bug was a race between workers, and a
    // test that raced would be flaky in the direction of passing.
    const ingestionQueue = queueOn(SCHEDULER_QUEUE.ingestion);
    workerOn(SCHEDULER_QUEUE.ingestion);

    await ingestionQueue.add(SCHEDULED_JOBS.AUTH_HOURLY, {});
    await settle(1);

    expect(seen.get(SCHEDULER_QUEUE.ingestion)).toEqual([
      SCHEDULED_JOBS.AUTH_HOURLY,
    ]);
  }, 30_000);

  it('**an unrecognised name lands in `failed`, never `completed`**', async () => {
    // §5.2. The old branch returned, so BullMQ recorded SUCCESS and advanced
    // the schedule for a run that did not happen — which is what made the
    // shared-queue loss invisible: the queue looked healthy because every
    // stolen job completed.
    //
    // Driven through auth's REAL processor rather than a stand-in, because the
    // thing being checked is that this processor throws. The app fixture closes
    // its own worker (so cron repeats cannot fire mid-suite), so the worker
    // here is ours and the handler is theirs.
    const processor = fx.moduleRef.get(SchedulerProcessor);
    const queue = queueOn(SCHEDULER_QUEUE.auth);

    const worker = new Worker(
      SCHEDULER_QUEUE.auth,
      (job: Job) => processor.process(job),
      { connection, concurrency: 1 },
    );
    workers.push(worker);

    // `attempts` defaults to 1 here — the repeat entries carry 3, which is what
    // bounds retries in production; a single attempt is what makes this test
    // deterministic rather than a four-minute backoff.
    const job = await queue.add('auth-weekly-from-2024', {});

    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await job.getState()) === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(await job.getState()).toBe('failed');
    expect(await queue.getCompletedCount()).toBe(0);
    expect(await queue.getFailedCount()).toBe(1);
  }, 30_000);
});
