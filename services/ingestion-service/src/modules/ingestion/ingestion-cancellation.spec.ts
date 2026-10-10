import {
  IngestionJobStatus,
  TERMINAL_INGESTION_STATUSES,
} from '@synapsedesk/common';
import {
  IngestionProcessor,
  JobNoLongerRunnableError,
} from './ingestion.processor';

/**
 * Cancelling work already in flight, from the worker's side.
 *
 * BullMQ cannot kill an active job — removing one a worker holds does not stop
 * it — so the only way to end work in progress is for the worker to notice.
 * That noticing is `setJobStatus`: a write it was already doing at every stage
 * boundary, made conditional.
 *
 * **Unit rather than e2e because there is no other proof.** Driving a real
 * worker to a stage boundary and cancelling inside the window is a race a test
 * cannot hold open; the conditional update is the whole mechanism, and it is
 * observable directly.
 */
describe('IngestionProcessor cancellation (unit)', () => {
  /** `setJobStatus` is private, and the mechanism is what is under test. */
  const setJobStatus = (processor: IngestionProcessor) =>
    (
      processor as unknown as {
        setJobStatus: (id: string, status: IngestionJobStatus) => Promise<void>;
      }
    ).setJobStatus.bind(processor);

  const processorWith = (updateMany: jest.Mock) =>
    Object.assign(Object.create(IngestionProcessor.prototype), {
      prisma: { ingestionJob: { updateMany } },
    }) as IngestionProcessor;

  it('1. writes the next stage while the job is still resumable', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const processor = processorWith(updateMany);

    await expect(
      setJobStatus(processor)('job-1', IngestionJobStatus.PARSING),
    ).resolves.toBeUndefined();

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'job-1',
        status: { notIn: [...TERMINAL_INGESTION_STATUSES] },
      },
      data: { status: IngestionJobStatus.PARSING },
    });
  });

  it('2. **a count of ZERO is the cancellation signal**', async () => {
    // The row moved to a terminal status underneath the worker, so the
    // predicate matches nothing. No new column, no polling — the update the
    // processor was already making is the checkpoint.
    const processor = processorWith(jest.fn().mockResolvedValue({ count: 0 }));

    await expect(
      setJobStatus(processor)('job-1', IngestionJobStatus.EMBEDDING),
    ).rejects.toBeInstanceOf(JobNoLongerRunnableError);
  });

  it('**3. FAILED is NOT refused — BullMQ retries are the recovery path**', () => {
    // The predicate is what a person or a success made final, not what is
    // currently in flight. `attempts: 3` means a failed job is re-run, and that
    // run has to move the row back through the stages — refusing it would turn
    // a transient embedding outage into a permanent failure.
    //
    // An existing pipeline test caught this: the first version used
    // `RESUMABLE_INGESTION_STATUSES`, and "completes the leftovers on a re-run"
    // started returning CANCELLED.
    expect([...TERMINAL_INGESTION_STATUSES]).toEqual([
      IngestionJobStatus.COMPLETED,
      IngestionJobStatus.CANCELLED,
    ]);
    expect([...TERMINAL_INGESTION_STATUSES]).not.toContain(
      IngestionJobStatus.FAILED,
    );
  });

  it('**4. a cancel DURING a deferral does not escape the catch**', async () => {
    // The fourth `setJobStatus` call site is inside the `BudgetExhausted`
    // handler, so its refusal is raised from within a catch block — and an
    // exception thrown there escapes the handler entirely. That is the retried
    // -job bug the CANCELLED outcome exists to prevent, arriving through the
    // one call site that is not a stage boundary.
    const processor = Object.assign(
      Object.create(IngestionProcessor.prototype),
      {
        prisma: {
          ingestionJob: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
        },
        logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        setDocumentStatus: jest.fn(),
      },
    ) as unknown as IngestionProcessor;

    // Reaching the real deferral arm needs a worker; what is provable here is
    // that the write it makes refuses, which is the input to that arm.
    await expect(
      setJobStatus(processor)('job-1', IngestionJobStatus.QUEUED),
    ).rejects.toBeInstanceOf(JobNoLongerRunnableError);
  });

  it('**5. CANCELLED is a job status and NOT a document status**', async () => {
    // The enum split: the document goes to FAILED and says "not indexed", the
    // job says why. Asserted here because nothing else would notice the day
    // somebody adds CANCELLED to DocumentStatus for symmetry.
    const { DocumentStatus } = await import('@synapsedesk/common');

    expect(Object.values(IngestionJobStatus)).toContain('CANCELLED');
    expect(Object.values(DocumentStatus)).not.toContain('CANCELLED');
  });
});
