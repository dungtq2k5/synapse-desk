import { status } from '@grpc/grpc-js';
import { faker } from '@faker-js/faker';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { expectRpc, rpcCode } from '@synapsedesk/common/testing/rpc';
import {
  DocumentStatus,
  INGESTION_QUEUE,
  IngestionJobStatus,
} from '@synapsedesk/common';
import {
  IngestionJobResponse,
  IngestionJobStatus as ProtoIngestionJobStatus,
} from '@synapsedesk/grpc-proto';
import { E2eFixture, bootstrapE2eTest } from '../utils';
import { memberContext, pageRequest } from '../utils/context';
import {
  buildTenant,
  createDocument,
  createIngestionJob,
  createScopedDocument,
  TenantFixture,
} from '../factories';
import { IngestionJobsService } from '../../src/modules/ingestion-jobs/ingestion-jobs.service';

/**
 * The pipeline worklist.
 *
 * Against a real database because the properties worth proving are `where`
 * clauses: the tenant filter, which nothing enforces for you, and the
 * soft-delete filter, which has to reach through a relation because this table
 * has no `deletedAt` of its own.
 *
 * Against a real queue for the same reason — retry and cancel both ask BullMQ
 * what it is holding, and a mocked answer would prove only that the mock was
 * consulted.
 */
describe('Ingestion jobs (e2e)', () => {
  let fx: E2eFixture;
  let jobs: IngestionJobsService;
  let queue: Queue;
  let tenant: TenantFixture;

  const caller = (t: TenantFixture = tenant) =>
    memberContext({ id: t.userId, organizationId: t.organizationId });

  /** Same tenant, no departments — the caller a scoped document must exclude. */
  const outsider = (t: TenantFixture = tenant) =>
    memberContext(
      { id: faker.string.uuid(), organizationId: t.organizationId },
      [],
      { departmentIds: [] },
    );

  const listRequest = () => ({
    page: pageRequest(),
    status: ProtoIngestionJobStatus.INGESTION_JOB_STATUS_UNSPECIFIED,
    documentId: '',
  });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    jobs = fx.moduleRef.get(IngestionJobsService);
    // The workers are stopped by the bootstrap, so a job added here stays
    // exactly where it was put.
    queue = fx.moduleRef.get<Queue>(getQueueToken(INGESTION_QUEUE));
  }, 30_000);

  beforeEach(async () => {
    await fx.reset();
    tenant = buildTenant();
  });

  afterAll(() => fx.close());

  it('1. lists a tenant’s jobs, newest first by default', async () => {
    const document = await createDocument(fx.prisma, tenant);
    await createIngestionJob(fx.prisma, tenant, document.id, {
      status: IngestionJobStatus.FAILED,
      errorLog: 'parse failed',
    });

    const page = await jobs.listIngestionJobs(listRequest(), caller());

    expect(page.items).toHaveLength(1);
    expect(page.items[0].documentId).toBe(document.id);
    expect(page.items[0].errorLog).toBe('parse failed');
    expect(page.items[0].status).toBe(
      ProtoIngestionJobStatus.INGESTION_JOB_STATUS_FAILED,
    );
  });

  it('**2. EXCLUDES another tenant’s jobs**', async () => {
    // The mistake the denormalized column exists to make cheap. Nothing in
    // Prisma enforces the filter — a forgotten clause here is a cross-tenant
    // leak, not a bug.
    const stranger = buildTenant();
    const theirs = await createDocument(fx.prisma, stranger);
    await createIngestionJob(fx.prisma, stranger, theirs.id);

    const page = await jobs.listIngestionJobs(listRequest(), caller());

    expect(page.items).toEqual([]);
    expect(page.meta?.totalItems).toBe(0);
  });

  it('**3. the scope reads THIS row’s tenant, not the document’s**', async () => {
    // The column is denormalized, so the two can disagree — and a filter that
    // joined to the parent instead would return a row this caller must not see
    // while still looking correct.
    const stranger = buildTenant();
    const document = await createDocument(fx.prisma, tenant);
    await createIngestionJob(fx.prisma, stranger, document.id);

    const page = await jobs.listIngestionJobs(listRequest(), caller());

    expect(page.items).toEqual([]);
  });

  it('**4. EXCLUDES jobs of a soft-deleted document**', async () => {
    // `IngestionJob` has no `deletedAt`, so this has to reach through the
    // relation. Without it a worklist keeps offering work for a document
    // nothing else will show.
    const document = await createDocument(fx.prisma, tenant, {
      deletedAt: new Date(),
      deletedById: tenant.userId,
    });
    await createIngestionJob(fx.prisma, tenant, document.id);

    const page = await jobs.listIngestionJobs(listRequest(), caller());

    expect(page.items).toEqual([]);
  });

  it('**4b. EXCLUDES jobs of a document outside the caller’s departments**', async () => {
    // The same predicate `GET /documents` applies. Without it this route
    // answers for a document the by-id read refuses, one route apart — and it
    // carries `error_log` with it.
    const document = await createScopedDocument(fx.prisma, tenant, [
      tenant.departmentId,
    ]);
    await createIngestionJob(fx.prisma, tenant, document.id, {
      status: IngestionJobStatus.FAILED,
      errorLog: 'the parser gave up',
    });

    const page = await jobs.listIngestionJobs(listRequest(), outsider());

    expect(page.items).toEqual([]);
    // The COUNT too — a total naming rows the caller cannot fetch tells them
    // how many exist that they may not see.
    expect(page.meta?.totalItems).toBe(0);
  });

  it('4c. a member of ONE listed department still sees them', async () => {
    // The narrowing has to stop where the boundary does: overlap, not
    // containment, exactly as `listDocuments` reads it.
    const document = await createScopedDocument(fx.prisma, tenant, [
      tenant.departmentId,
      tenant.otherDepartmentId,
    ]);
    const job = await createIngestionJob(fx.prisma, tenant, document.id);

    const page = await jobs.listIngestionJobs(
      listRequest(),
      memberContext(
        { id: tenant.userId, organizationId: tenant.organizationId },
        [],
        {
          departmentIds: [tenant.otherDepartmentId],
        },
      ),
    );

    expect(page.items.map((item) => item.id)).toEqual([job.id]);
  });

  it('5. filters by status, and UNSPECIFIED means no filter', async () => {
    const document = await createDocument(fx.prisma, tenant);
    await createIngestionJob(fx.prisma, tenant, document.id, {
      status: IngestionJobStatus.FAILED,
    });
    await createIngestionJob(fx.prisma, tenant, document.id, {
      status: IngestionJobStatus.COMPLETED,
    });

    const failed = await jobs.listIngestionJobs(
      {
        ...listRequest(),
        status: ProtoIngestionJobStatus.INGESTION_JOB_STATUS_FAILED,
      },
      caller(),
    );
    const all = await jobs.listIngestionJobs(listRequest(), caller());

    expect(failed.items).toHaveLength(1);
    expect(all.items).toHaveLength(2);
  });

  it('6. **CANCELLED survives the round trip** through both enums', async () => {
    // The seventh member, across the domain enum, the column and the proto
    // bridge. A member added to one and not the others maps to UNSPECIFIED.
    const document = await createDocument(fx.prisma, tenant);
    await createIngestionJob(fx.prisma, tenant, document.id, {
      status: IngestionJobStatus.CANCELLED,
    });

    const page = await jobs.listIngestionJobs(
      {
        ...listRequest(),
        status: ProtoIngestionJobStatus.INGESTION_JOB_STATUS_CANCELLED,
      },
      caller(),
    );

    expect(page.items[0].status).toBe(
      ProtoIngestionJobStatus.INGESTION_JOB_STATUS_CANCELLED,
    );
  });

  describe('getIngestionJob', () => {
    it('**7. another tenant’s job is NOT_FOUND, never PERMISSION_DENIED**', async () => {
      // A distinguishable error confirms the id exists. One query carries both
      // predicates, so the two answers cannot diverge.
      const stranger = buildTenant();
      const theirs = await createDocument(fx.prisma, stranger);
      const job = await createIngestionJob(fx.prisma, stranger, theirs.id);

      await expectRpc(
        jobs.getIngestionJob({ id: job.id }, caller()),
        status.NOT_FOUND,
      );
    });

    it('**7b. a job of a document outside the caller’s departments is NOT_FOUND**', async () => {
      // The by-id read applies the SAME predicate as the list, or the list's
      // filter is one route from being decorative.
      const document = await createScopedDocument(fx.prisma, tenant, [
        tenant.departmentId,
      ]);
      const job = await createIngestionJob(fx.prisma, tenant, document.id);

      await expectRpc(
        jobs.getIngestionJob({ id: job.id }, outsider()),
        status.NOT_FOUND,
      );
    });

    it('8. an id that exists nowhere is the SAME error', async () => {
      await expectRpc(
        jobs.getIngestionJob({ id: faker.string.uuid() }, caller()),
        status.NOT_FOUND,
      );
    });
  });

  describe('listDocumentIngestionJobs', () => {
    it('9. returns every attempt for one document, oldest first', async () => {
      // Oldest first because this is a history: the first attempt is the one
      // that explains the rest.
      const document = await createDocument(fx.prisma, tenant);
      const first = await createIngestionJob(fx.prisma, tenant, document.id, {
        status: IngestionJobStatus.FAILED,
      });
      const second = await createIngestionJob(fx.prisma, tenant, document.id);

      const page = await jobs.listDocumentIngestionJobs(
        { id: document.id },
        caller(),
      );

      expect(page.items.map((item) => item.id)).toEqual([first.id, second.id]);
    });

    it('**9b. a scoped document’s history is empty outside its departments**', async () => {
      const document = await createScopedDocument(fx.prisma, tenant, [
        tenant.departmentId,
      ]);
      await createIngestionJob(fx.prisma, tenant, document.id);

      const page = await jobs.listDocumentIngestionJobs(
        { id: document.id },
        outsider(),
      );

      expect(page.items).toEqual([]);
    });

    it('10. is scoped too — another tenant’s document yields nothing', async () => {
      const stranger = buildTenant();
      const theirs = await createDocument(fx.prisma, stranger);
      await createIngestionJob(fx.prisma, stranger, theirs.id);

      const page = await jobs.listDocumentIngestionJobs(
        { id: theirs.id },
        caller(),
      );

      expect(page.items).toEqual([]);
    });
  });

  describe('retryIngestionJob', () => {
    it('11. **inserts a SECOND row and leaves the failed one alone**', async () => {
      // Reusing the row would destroy the only copy of `error_log` at the
      // moment someone is working out whether the retry fails the same way —
      // and would re-add a BullMQ id the queue may still hold, which `add()`
      // ignores silently.
      const document = await createDocument(fx.prisma, tenant);
      const failed = await createIngestionJob(fx.prisma, tenant, document.id, {
        status: IngestionJobStatus.FAILED,
        errorLog: 'the original reason',
      });

      const retry = await jobs.retryIngestionJob({ id: failed.id }, caller());

      expect(retry.id).not.toBe(failed.id);
      expect(retry.status).toBe(
        ProtoIngestionJobStatus.INGESTION_JOB_STATUS_QUEUED,
      );

      const source = await fx.prisma.ingestionJob.findUniqueOrThrow({
        where: { id: failed.id },
      });
      expect(source.status).toBe(IngestionJobStatus.FAILED);
      expect(source.errorLog).toBe('the original reason');
    });

    it('12. enqueues the new job, carrying the document’s object path', async () => {
      const document = await createDocument(fx.prisma, tenant);
      const failed = await createIngestionJob(fx.prisma, tenant, document.id, {
        status: IngestionJobStatus.FAILED,
      });

      const retry = await jobs.retryIngestionJob({ id: failed.id }, caller());

      const queued = await queue.getJob(retry.id);
      expect(queued?.data).toMatchObject({
        documentId: document.id,
        ingestionJobId: retry.id,
        objectPath: document.fileUrl,
        fileType: document.fileType,
      });
      // Recorded on the row too — the thread from a stuck document to a job
      // someone can name in Redis.
      expect(retry.bullmqJobId).toBe(retry.id);
    });

    it('**12b. discards the attempt BullMQ still has pending**', async () => {
      // `fail()` writes FAILED and rethrows, so `attempts: 3` leaves the next
      // try in `delayed` for five seconds. Retrying inside that window without
      // discarding puts a second worker on one document, and `writeChunkRows`
      // is `deleteMany` + `createMany` on the documentId — concurrently, they
      // destroy each other's rows.
      //
      // The pending attempt is stood up directly: the bootstrap stops every
      // worker, so nothing here can fail a job and have BullMQ schedule its own
      // retry.
      const document = await createDocument(fx.prisma, tenant);
      const failed = await createIngestionJob(fx.prisma, tenant, document.id, {
        status: IngestionJobStatus.FAILED,
      });
      await queue.add(
        'ingest',
        { ingestionJobId: failed.id },
        { jobId: failed.id, delay: 5_000 },
      );

      const retry = await jobs.retryIngestionJob({ id: failed.id }, caller());

      expect(await queue.getJob(failed.id)).toBeUndefined();
      expect(await queue.getJob(retry.id)).toBeDefined();
    });

    it('13. resets the document to PENDING', async () => {
      // The document row is what every other surface reads. Left FAILED while
      // a job runs, the two disagree.
      const document = await createDocument(fx.prisma, tenant, {
        status: DocumentStatus.FAILED,
      });
      const failed = await createIngestionJob(fx.prisma, tenant, document.id, {
        status: IngestionJobStatus.FAILED,
      });

      await jobs.retryIngestionJob({ id: failed.id }, caller());

      const after = await fx.prisma.document.findUniqueOrThrow({
        where: { id: document.id },
      });
      expect(after.status).toBe(DocumentStatus.PENDING);
    });

    it('14. **a STRANDED QUEUED job retries, and its row ends CANCELLED naming the new one**', async () => {
      // The cap-deferred case: the row says QUEUED and the queue has never
      // heard of it. Without ending the source row it stays QUEUED forever and
      // the dashboard never stops showing it.
      const document = await createDocument(fx.prisma, tenant);
      const stranded = await createIngestionJob(fx.prisma, tenant, document.id);

      const retry = await jobs.retryIngestionJob({ id: stranded.id }, caller());

      const source = await fx.prisma.ingestionJob.findUniqueOrThrow({
        where: { id: stranded.id },
      });
      expect(source.status).toBe(IngestionJobStatus.CANCELLED);
      expect(source.processedAt).not.toBeNull();
      // The successor is named in a COLUMN, not spelled into `error_log` for a
      // later reader to parse back out.
      expect(source.supersededById).toBe(retry.id);
      expect(source.errorLog).toBeNull();
    });

    it('**14b. two CONCURRENT retries of one row produce one job**', async () => {
      // Both calls pass the precondition — it is a read — and both insert.
      // Without a guard: two ids, two workers, and `writeChunkRows` deleting
      // each other's chunks.
      //
      // TWO guards now stand here, and the message says which one fired.
      // `ingestion_jobs_one_live_per_document` blocks the loser's INSERT
      // against the winner's uncommitted row, so it answers first and the
      // supersede claim below it never evaluates `count === 0` on this path.
      // The claim stays because it is the only thing that WRITES the successor
      // id, and because a source superseded by a retry that has since finished
      // reaches it with no live row for the index to catch.
      const document = await createDocument(fx.prisma, tenant);
      const failed = await createIngestionJob(fx.prisma, tenant, document.id, {
        status: IngestionJobStatus.FAILED,
      });

      const outcomes = await Promise.allSettled([
        jobs.retryIngestionJob({ id: failed.id }, caller()),
        jobs.retryIngestionJob({ id: failed.id }, caller()),
      ]);

      // Type-guard predicates, not bare comparisons: `.filter()` does not
      // narrow `PromiseSettledResult`, so `.value` and `.reason` below are only
      // reachable through one.
      const won = outcomes.filter(
        (o): o is PromiseFulfilledResult<IngestionJobResponse> =>
          o.status === 'fulfilled',
      );
      const lost = outcomes.filter(
        (o): o is PromiseRejectedResult => o.status === 'rejected',
      );
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect(rpcCode(lost[0].reason)).toBe(status.FAILED_PRECONDITION);
      expect(lost[0].reason).toMatchObject({
        message: expect.stringContaining('already being processed') as string,
      });

      // The source, plus exactly ONE new row — the loser's insert is gone.
      expect(await fx.prisma.ingestionJob.count()).toBe(2);
      const source = await fx.prisma.ingestionJob.findUniqueOrThrow({
        where: { id: failed.id },
      });
      expect(source.supersededById).toBe(won[0].value.id);
      // And the loser never reached `enqueue`, which is after the commit.
      expect(await queue.getJobCountByTypes('waiting')).toBe(1);
    });

    it('14c. a superseded row is refused FOREVER, and the message names its successor', async () => {
      // Not merely a concurrent guard: the thing to retry is the successor.
      const document = await createDocument(fx.prisma, tenant);
      const failed = await createIngestionJob(fx.prisma, tenant, document.id, {
        status: IngestionJobStatus.FAILED,
      });

      const retry = await jobs.retryIngestionJob({ id: failed.id }, caller());
      const second = jobs.retryIngestionJob({ id: failed.id }, caller());

      await expectRpc(second, status.FAILED_PRECONDITION);
      await expect(second).rejects.toMatchObject({
        // Reusing cancel's "already finished" would be false here.
        message: expect.stringContaining(retry.id) as string,
      });
    });

    it('**14d. retries from CANCELLED, and the cancel reason SURVIVES**', async () => {
      // Cancel-then-retry is the documented correction, and the source row is
      // the only record of why. Nothing may overwrite its `error_log` — the
      // successor is named in a column instead.
      const document = await createDocument(fx.prisma, tenant);
      const cancelled = await createIngestionJob(
        fx.prisma,
        tenant,
        document.id,
        { status: IngestionJobStatus.CANCELLED, errorLog: 'Cancelled' },
      );

      const retry = await jobs.retryIngestionJob(
        { id: cancelled.id },
        caller(),
      );

      expect(retry.id).not.toBe(cancelled.id);
      const source = await fx.prisma.ingestionJob.findUniqueOrThrow({
        where: { id: cancelled.id },
      });
      expect(source.errorLog).toBe('Cancelled');
      expect(source.status).toBe(IngestionJobStatus.CANCELLED);
      expect(source.supersededById).toBe(retry.id);
    });

    it('**14e. a retry is refused while ANOTHER live job holds the document**', async () => {
      // The per-document invariant, which `superseded_by_id` cannot reach: it
      // claims one ROW, and this is a second row. Retry and reindex are two
      // routes into the same document, and the arrangement below is what a
      // reindex in flight looks like from retry's side.
      //
      // Nothing in the service reads for this. The refusal comes from
      // `ingestion_jobs_one_live_per_document`, because a read cannot hold
      // between its own SELECT and the INSERT that follows it.
      const document = await createDocument(fx.prisma, tenant);
      const failed = await createIngestionJob(fx.prisma, tenant, document.id, {
        status: IngestionJobStatus.FAILED,
      });
      await createIngestionJob(fx.prisma, tenant, document.id, {
        status: IngestionJobStatus.EMBEDDING,
      });

      const refused = jobs.retryIngestionJob({ id: failed.id }, caller());

      await expectRpc(refused, status.FAILED_PRECONDITION);
      await expect(refused).rejects.toMatchObject({
        message: expect.stringContaining('already being processed') as string,
      });

      // The insert rolled back with the transaction: two rows, not three, and
      // the source is untouched — no supersede claim, no status change.
      expect(await fx.prisma.ingestionJob.count()).toBe(2);
      const source = await fx.prisma.ingestionJob.findUniqueOrThrow({
        where: { id: failed.id },
      });
      expect(source.supersededById).toBeNull();
      expect(source.status).toBe(IngestionJobStatus.FAILED);
    });

    it('15. **a QUEUED job the queue still HOLDS is refused**', async () => {
      // Same row status as 14 and the opposite answer, decided by BullMQ alone.
      // Retrying this one runs two workers over one document.
      const document = await createDocument(fx.prisma, tenant);
      const waiting = await createIngestionJob(fx.prisma, tenant, document.id);
      await queue.add(
        'ingest',
        { ingestionJobId: waiting.id },
        { jobId: waiting.id },
      );

      await expectRpc(
        jobs.retryIngestionJob({ id: waiting.id }, caller()),
        status.FAILED_PRECONDITION,
      );

      expect(await fx.prisma.ingestionJob.count()).toBe(1);
    });

    it('16. a COMPLETED job is refused — that is a reindex', async () => {
      // Reindex has to purge the old vectors first and retry must not, so
      // conflating them leaves a document indexed twice.
      const document = await createDocument(fx.prisma, tenant, {
        status: DocumentStatus.INDEXED,
      });
      const done = await createIngestionJob(fx.prisma, tenant, document.id, {
        status: IngestionJobStatus.COMPLETED,
      });

      await expectRpc(
        jobs.retryIngestionJob({ id: done.id }, caller()),
        status.FAILED_PRECONDITION,
      );
    });

    it('17. a job mid-pipeline is refused', async () => {
      const document = await createDocument(fx.prisma, tenant);
      const running = await createIngestionJob(fx.prisma, tenant, document.id, {
        status: IngestionJobStatus.CHUNKING,
      });

      await expectRpc(
        jobs.retryIngestionJob({ id: running.id }, caller()),
        status.FAILED_PRECONDITION,
      );
    });

    it('18. **another tenant’s job is NOT_FOUND, and nothing is queued**', async () => {
      const stranger = buildTenant();
      const theirs = await createDocument(fx.prisma, stranger);
      const job = await createIngestionJob(fx.prisma, stranger, theirs.id, {
        status: IngestionJobStatus.FAILED,
      });

      await expectRpc(
        jobs.retryIngestionJob({ id: job.id }, caller()),
        status.NOT_FOUND,
      );

      expect(await fx.prisma.ingestionJob.count()).toBe(1);
      expect(await queue.getJobCountByTypes('waiting')).toBe(0);
    });
  });

  describe('cancelIngestionJob', () => {
    it('19. **removes a waiting job from the queue**', async () => {
      const document = await createDocument(fx.prisma, tenant);
      const waiting = await createIngestionJob(fx.prisma, tenant, document.id);
      await queue.add(
        'ingest',
        { ingestionJobId: waiting.id },
        { jobId: waiting.id },
      );

      const result = await jobs.cancelIngestionJob(
        { id: waiting.id },
        caller(),
      );

      expect(result.cancelled).toBe(true);
      expect(await queue.getJob(waiting.id)).toBeUndefined();
      const row = await fx.prisma.ingestionJob.findUniqueOrThrow({
        where: { id: waiting.id },
      });
      expect(row.status).toBe(IngestionJobStatus.CANCELLED);
    });

    it('20. **cancels a job the queue has never heard of**', async () => {
      // The WRITE is what cancels; removal is a courtesy. A cancel that
      // depended on finding a queue entry could not stop a stranded job at all.
      const document = await createDocument(fx.prisma, tenant);
      const stranded = await createIngestionJob(fx.prisma, tenant, document.id);

      const result = await jobs.cancelIngestionJob(
        { id: stranded.id },
        caller(),
      );

      expect(result.cancelled).toBe(true);
      const row = await fx.prisma.ingestionJob.findUniqueOrThrow({
        where: { id: stranded.id },
      });
      expect(row.status).toBe(IngestionJobStatus.CANCELLED);
      expect(row.processedAt).not.toBeNull();
    });

    it('21. **puts the document in FAILED, not a cancelled-shaped status**', async () => {
      // `DocumentStatus` has no CANCELLED by design: the document row says
      // "not indexed", the job row says why.
      const document = await createDocument(fx.prisma, tenant, {
        status: DocumentStatus.PROCESSING,
      });
      const running = await createIngestionJob(fx.prisma, tenant, document.id, {
        status: IngestionJobStatus.EMBEDDING,
      });

      await jobs.cancelIngestionJob({ id: running.id }, caller());

      const after = await fx.prisma.document.findUniqueOrThrow({
        where: { id: document.id },
      });
      expect(after.status).toBe(DocumentStatus.FAILED);
    });

    it('22. **a finished job is refused, and the document is left alone**', async () => {
      // The conditional write and its rollback: cancelling a COMPLETED job
      // would report an indexed document as failed.
      const document = await createDocument(fx.prisma, tenant, {
        status: DocumentStatus.INDEXED,
      });
      const done = await createIngestionJob(fx.prisma, tenant, document.id, {
        status: IngestionJobStatus.COMPLETED,
      });

      await expectRpc(
        jobs.cancelIngestionJob({ id: done.id }, caller()),
        status.FAILED_PRECONDITION,
      );

      const after = await fx.prisma.document.findUniqueOrThrow({
        where: { id: document.id },
      });
      expect(after.status).toBe(DocumentStatus.INDEXED);
    });

    it('23. another tenant’s job is NOT_FOUND, and stays QUEUED', async () => {
      const stranger = buildTenant();
      const theirs = await createDocument(fx.prisma, stranger);
      const job = await createIngestionJob(fx.prisma, stranger, theirs.id);

      await expectRpc(
        jobs.cancelIngestionJob({ id: job.id }, caller()),
        status.NOT_FOUND,
      );

      const row = await fx.prisma.ingestionJob.findUniqueOrThrow({
        where: { id: job.id },
      });
      expect(row.status).toBe(IngestionJobStatus.QUEUED);
    });
  });
});
