import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  CancelIngestionJobResponse,
  DocumentIdRequest,
  IngestionJobIdRequest,
  IngestionJobResponse,
  ListIngestionJobsRequest,
  ListIngestionJobsResponse,
  emptyPage,
  fromProtoIngestionJobStatus,
  toPageMeta,
  toPrismaPage,
} from '@synapsedesk/grpc-proto';
import {
  CallerContext,
  DocumentStatus,
  IngestionJobStatus,
  RESUMABLE_INGESTION_STATUSES,
  requireTenant,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { IngestionQueueService } from '../ingestion/ingestion-queue.service';
import { IngestionJob, Prisma } from '../../generated/prisma/client';
import { documentVisibility } from '../../common/document-visibility';
import { asConcurrentIngestion } from '../../common/live-ingestion-job';
import { toIngestionJobResponse } from './ingestion-job.mapper';

/** What the tenant may sort a job worklist by. */
// Local rather than in `libs/common`: one consumer, and §3.1 says a second has to exist or be imminent before a constant moves.
const INGESTION_JOB_SORTABLE_FIELDS = ['createdAt', 'status'] as const;

/** The statuses retry accepts once the source's queue entry is discarded. */
const RETRYABLE_INGESTION_STATUSES = new Set<IngestionJobStatus>([
  IngestionJobStatus.FAILED,
  IngestionJobStatus.CANCELLED,
]);

/**
 * The refusal a retry of an already-superseded job gets.
 *
 * Deliberately NOT cancel's "already finished": that is false here, and the
 * successor is the thing the caller actually wants.
 */
function supersededError(successorId: string | null): RpcException {
  return new RpcException({
    code: status.FAILED_PRECONDITION,
    message: successorId
      ? `This ingestion job was already retried as ${successorId}`
      : 'This ingestion job was already retried',
  });
}

/**
 * A stored status, as the enum it stands for.
 *
 * `ingestion_jobs.status` is a `VarChar` rather than a Postgres enum
 * (conventions §7.3), so Prisma types it `string` and nothing narrows it back.
 */
function statusOf(job: IngestionJob): IngestionJobStatus {
  return job.status as IngestionJobStatus;
}

/** `ingestion_jobs`, scoped to the caller's tenant. */
@Injectable()
export class IngestionJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: IngestionQueueService,
  ) {}

  async listIngestionJobs(
    request: ListIngestionJobsRequest,
    context: CallerContext,
  ): Promise<ListIngestionJobsResponse> {
    const page = request.page ?? emptyPage();
    const { skip, take, orderBy } = toPrismaPage(
      page,
      INGESTION_JOB_SORTABLE_FIELDS,
    );

    const where: Prisma.IngestionJobWhereInput = {
      ...this.scope(context),
      // UNSPECIFIED (0) is falsy and means "no filter", so `fromProto*`
      // returning null and the field being absent are the same thing.
      ...(fromProtoIngestionJobStatus(request.status)
        ? { status: fromProtoIngestionJobStatus(request.status)! }
        : {}),
      ...(request.documentId ? { documentId: request.documentId } : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.ingestionJob.findMany({ where, orderBy, skip, take }),
      // The SAME `where`. A count computed without the scope would tell a
      // caller how many jobs exist that they cannot see.
      this.prisma.ingestionJob.count({ where }),
    ]);

    return {
      items: items.map(toIngestionJobResponse),
      meta: toPageMeta(page, totalItems, items.length),
    };
  }

  async getIngestionJob(
    request: IngestionJobIdRequest,
    context: CallerContext,
  ): Promise<IngestionJobResponse> {
    return toIngestionJobResponse(await this.load(request.id, context));
  }

  /**
   * Every attempt at one document, oldest first.
   *
   * Unpaginated — `meta` reports the full count so the envelope matches the
   * paginated list's shape.
   */
  async listDocumentIngestionJobs(
    request: DocumentIdRequest,
    context: CallerContext,
  ): Promise<ListIngestionJobsResponse> {
    const where: Prisma.IngestionJobWhereInput = {
      ...this.scope(context),
      documentId: request.id,
    };

    const items = await this.prisma.ingestionJob.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });

    return {
      items: items.map(toIngestionJobResponse),
      // Unpaginated, but the envelope is the same shape — a client reading a
      // list should not need two response types for one entity.
      meta: toPageMeta(emptyPage(), items.length, items.length),
    };
  }

  /**
   * Queues a fresh attempt at the same document.
   *
   * Inserts a NEW row and enqueues that id — the source row stays as the
   * record of what went wrong. Accepts a `FAILED` or `CANCELLED` job, and a
   * `QUEUED` one BullMQ no longer holds, which is what a job deferred at the
   * AI cap is left as.
   *
   * @returns the new job, `QUEUED`.
   * @throws RpcException NOT_FOUND when this tenant has no such job.
   * @throws RpcException FAILED_PRECONDITION when the job is running, about to
   * run, or already indexed.
   */
  async retryIngestionJob(
    request: IngestionJobIdRequest,
    context: CallerContext,
  ): Promise<IngestionJobResponse> {
    const source = await this.load(request.id, context);
    await this.assertRetryable(source);

    // A `FAILED` row does not mean BullMQ is done with it: `attempts: 3` means
    // the next try is sitting in `delayed`, guaranteed to run. Retry SUPERSEDES
    // that attempt, and leaving it scheduled puts a second worker on this
    // document — which `writeChunkRows` cannot survive concurrently.
    //
    // Before the transaction, so no window holds both the old entry and the new
    // row.
    await this.queue.discard(source.id);

    // `load` already proved the parent document is in this tenant and not
    // soft-deleted, so this read needs no scope of its own.
    const document = await this.prisma.document.findUniqueOrThrow({
      where: { id: source.documentId },
      select: { fileUrl: true, fileType: true, ocrLanguages: true },
    });

    const retry = await this.prisma
      .$transaction(async (tx) => {
        // BEFORE the insert, and that ordering is load-bearing.
        //
        // Only the stranded row needs its STATUS ended: it is the one still
        // QUEUED, and a QUEUED row nothing will ever run is what the dashboard
        // shows forever. A `FAILED` or `CANCELLED` row is terminal already, and
        // its `error_log` is the one copy of why this retry is happening.
        //
        // It has to come first because `ingestion_jobs_one_live_per_document`
        // counts a `QUEUED` row as live: inserting the successor while the
        // stranded source still holds that status is the index's own violation,
        // and it would make the stranded case — the one this route exists for —
        // the one case retry could not serve.
        if (statusOf(source) === IngestionJobStatus.QUEUED) {
          await tx.ingestionJob.update({
            where: { id: source.id },
            data: {
              status: IngestionJobStatus.CANCELLED,
              processedAt: new Date(),
            },
          });
        }

        const created = await tx.ingestionJob.create({
          data: {
            organizationId: source.organizationId,
            documentId: source.documentId,
            // `enqueue` fills this in; the column is not nullable.
            bullmqJobId: '',
            status: IngestionJobStatus.QUEUED,
          },
        });

        // Claimed on EVERY source status, because the race is not
        // status-specific: two clicks on one FAILED row are as fatal as two on a
        // stranded one.
        //
        // Depends on READ COMMITTED — the loser blocks on the row lock,
        // re-evaluates this qual against the committed row and matches nothing.
        // Passing `isolationLevel` to this transaction would make it raise a
        // serialization error instead, and the branch below would never run.
        const { count } = await tx.ingestionJob.updateMany({
          where: { id: source.id, supersededById: null },
          data: { supersededById: created.id },
        });

        if (count === 0) await this.refuseSuperseded(tx, source.id);

        await tx.document.update({
          where: { id: source.documentId },
          data: { status: DocumentStatus.PENDING },
        });

        return created;
      })
      .catch((error: unknown) => {
        // A live job for this document that is NOT the source row — a second
        // route re-ran it while this retry was in flight. The refusal comes from
        // the index rather than from a read, because a read cannot hold.
        throw asConcurrentIngestion(error);
      });

    // AFTER the commit: a worker that picked the job up mid-transaction would
    // find no row to advance.
    await this.queue.enqueue({
      organizationId: retry.organizationId,
      documentId: retry.documentId,
      ingestionJobId: retry.id,
      objectPath: document.fileUrl,
      fileType: document.fileType,
      ocrLanguages: document.ocrLanguages,
    });

    // Re-read rather than returning the row created above: `enqueue` records
    // `bullmqJobId` on it, and that id is how someone finds the job in Redis.
    return toIngestionJobResponse(
      await this.prisma.ingestionJob.findUniqueOrThrow({
        where: { id: retry.id },
      }),
    );
  }

  /**
   * Stops a job that has not finished.
   *
   * The database write is the cancellation — the worker re-checks the row at
   * every stage boundary. Dropping the queue entry only spares a run that
   * would refuse itself, and cannot interrupt one already in progress.
   *
   * @throws RpcException NOT_FOUND when this tenant has no such job.
   * @throws RpcException FAILED_PRECONDITION when the job already finished.
   */
  async cancelIngestionJob(
    request: IngestionJobIdRequest,
    context: CallerContext,
  ): Promise<CancelIngestionJobResponse> {
    const job = await this.load(request.id, context);

    await this.prisma.$transaction(async (tx) => {
      // Conditional, and interactive so the throw rolls the document write
      // back: the worker may have completed between the read above and here,
      // and cancelling a finished job would report an indexed document failed.
      const { count } = await tx.ingestionJob.updateMany({
        where: {
          id: job.id,
          status: { in: [...RESUMABLE_INGESTION_STATUSES] },
        },
        data: {
          status: IngestionJobStatus.CANCELLED,
          errorLog: 'Cancelled',
          processedAt: new Date(),
        },
      });

      if (count === 0) {
        throw new RpcException({
          code: status.FAILED_PRECONDITION,
          message: 'This ingestion job has already finished',
        });
      }

      await tx.document.update({
        where: { id: job.documentId },
        // `FAILED`, because `DocumentStatus` has no cancelled-shaped member by
        // design — the document row says "not indexed", the job row says why.
        data: { status: DocumentStatus.FAILED },
      });
    });

    // Best effort, and after the commit: a stranded job has no queue entry
    // left to remove and is cancelled all the same.
    await this.queue.discard(job.id);

    return { cancelled: true };
  }

  /**
   * @throws RpcException FAILED_PRECONDITION, always — naming the successor.
   */
  private async refuseSuperseded(
    tx: Prisma.TransactionClient,
    sourceId: string,
  ): Promise<never> {
    // `updateMany` reports a count and nothing else, so the winner's id costs
    // one more read — on the losing path only, which is the rare one. A fresh
    // statement under READ COMMITTED sees the committed winner.
    const claimed = await tx.ingestionJob.findUnique({
      where: { id: sourceId },
      select: { supersededById: true },
    });

    throw supersededError(claimed?.supersededById ?? null);
  }

  /**
   * @throws RpcException FAILED_PRECONDITION unless the job may be retried.
   */
  private async assertRetryable(job: IngestionJob): Promise<void> {
    const jobStatus = statusOf(job);

    // The settled case. The claim inside the transaction is the authority —
    // this only spares the common path a wasted insert and a rollback.
    if (job.supersededById) {
      throw supersededError(job.supersededById);
    }

    if (RETRYABLE_INGESTION_STATUSES.has(jobStatus)) return;

    // A `QUEUED` row means nothing on its own — it is both what a job about to
    // run looks like and what one deferred at the AI cap was left as. BullMQ
    // is the only thing that can tell them apart (known-gaps #3).
    if (
      jobStatus === IngestionJobStatus.QUEUED &&
      !(await this.queue.isRunnable(job.id))
    ) {
      return;
    }

    throw new RpcException({
      code: status.FAILED_PRECONDITION,
      message:
        jobStatus === IngestionJobStatus.COMPLETED
          ? 'This document is already indexed; reindexing it is a separate operation'
          : `Ingestion job is still ${jobStatus.toLowerCase()}`,
    });
  }

  /**
   * One job, scoped.
   *
   * @throws RpcException NOT_FOUND when no row matches — including a row that
   * belongs to another tenant.
   */
  private async load(id: string, context: CallerContext) {
    // `findFirst`, never `findUnique`: the latter takes only unique fields and
    // cannot express the tenant filter (known-gaps #1). One query with both
    // predicates is also what keeps "no such job" and "not yours"
    // indistinguishable — a separate check could report them differently.
    const job = await this.prisma.ingestionJob.findFirst({
      where: { id, ...this.scope(context) },
    });

    if (!job) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Ingestion job not found',
      });
    }

    return job;
  }

  /** The tenant, soft-delete and visibility predicates every query here repeats. */
  private scope(context: CallerContext): Prisma.IngestionJobWhereInput {
    return {
      organizationId: requireTenant(context),
      // `IngestionJob` carries neither `deletedAt` nor the department links, so
      // both reach through the relation. Without the first the worklist offers
      // work for a document nothing else will show; without the second
      // `GET /ingestion-jobs` answers for a document `GET /documents/:id`
      // refuses, one route apart.
      document: { deletedAt: null, ...documentVisibility(context) },
    };
  }
}
