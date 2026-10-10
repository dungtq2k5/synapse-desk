import { Injectable, Logger } from '@nestjs/common';
import {
  AiSurface,
  formatErrorMsg,
  IngestionJobStatus,
  parseOcrLanguages,
  systemContext,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiLedgerService } from '../ai-ledger/ai-ledger.service';
import { IngestionQueueService } from './ingestion-queue.service';
import { IngestionJobData } from './ingestion.processor';

/**
 * How many stuck jobs one run will re-queue.
 *
 * A bound, not a tuning knob: without it one tick over a large backlog is an
 * unbounded scan-and-enqueue, and the sweep becomes the thing that overwhelms
 * the queue it exists to top up. A backlog larger than this drains over
 * successive runs, oldest first.
 */
export const MAX_RECONCILED_PER_RUN = 100;

/**
 * How many distinct tenants one run will budget-check.
 *
 * The second axis, and it exists because fixing the first opened it. Deciding
 * the budget BEFORE the row cap means the number of entitlement reads is driven
 * by tenants rather than by rows — a hundred tenants with one stranded document
 * each would be a hundred cross-service reads in a tick, where the row cap had
 * bounded it at a handful.
 *
 * Oldest-stuck tenants first, so a tenant beyond this cap is reached on a later
 * run rather than never. Bounding one unbounded thing by introducing another is
 * not a fix.
 */
export const MAX_ORGANIZATIONS_PER_RUN = 20;

/** What the sweep did, for the log line and the tests. */
export type ReconcileResult = {
  /** Re-queued — never enqueued in the first place. */
  enqueued: number;
  /** Re-queued — deferred at the cap and drained. */
  drained: number;
  /** Left alone because their tenant is still over budget. */
  skippedAtCap: number;
  /** Left alone because BullMQ still holds them. */
  skippedRunnable: number;
  /**
   * Could not be turned into a job payload at all.
   *
   * Counted rather than only logged: a silently skipped job is a document that
   * never ingests and never appears anywhere again, which is the failure this
   * whole sweep exists to end.
   */
  unreconcilable: number;
};

type StuckJob = {
  id: string;
  organizationId: string;
  documentId: string;
  bullmqJobId: string;
  document: { fileUrl: string; fileType: string; ocrLanguages: string[] };
};

/**
 * Re-queues `QUEUED` ingestion jobs that nothing is going to run.
 *
 * One signature, two causes, and both are invisible today:
 *
 *   - **A lost `document.uploaded`.** The event publishes after the confirm
 *     transaction commits, and NATS here is core rather than JetStream — an
 *     `emit()` with no connected subscriber is gone. The row sits `QUEUED` with
 *     `bullmqJobId: ''` and the document sits `PENDING`, forever, and every
 *     query reports it as in progress.
 *   - **A deferral at the AI cap.** The processor returns the job to `QUEUED`
 *     and completes the BullMQ job deliberately, so nothing retried it. This
 *     sweep is what closed known-gaps #3.
 *
 * This converts "a document silently never ingests" into "a document ingests a
 * few minutes late", which is the difference between a correctness bug and a
 * latency one — and it needs no transport change to do it.
 */
@Injectable()
export class IngestionReconcileSweep {
  private readonly logger = new Logger(IngestionReconcileSweep.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: IngestionQueueService,
    private readonly ledger: AiLedgerService,
  ) {}

  async sweep(): Promise<ReconcileResult> {
    const result: ReconcileResult = {
      enqueued: 0,
      drained: 0,
      skippedAtCap: 0,
      skippedRunnable: 0,
      unreconcilable: 0,
    };

    // **The budget is decided BEFORE the row cap, and that ordering is the
    // whole design.** Taking the oldest 100 rows first and discovering
    // afterwards that they all belong to one capped tenant means that tenant's
    // backlog is the only thing this sweep ever looks at — every tick, forever,
    // while every other tenant's stranded document goes unexamined and the run
    // reports healthy.
    const allowed = await this.organizationsUnderCap(result);
    if (allowed.length === 0) return this.report(result);

    // `QUEUED` only. PARSING/CHUNKING/EMBEDDING are a worker mid-flight, and
    // re-queueing one puts a second worker on a document the first is already
    // writing chunks for.
    //
    // Oldest first: the document stuck longest is the one whose owner has been
    // waiting longest, and a backlog over the cap should drain in that order
    // rather than in whatever order the planner returns.
    const candidates = await this.prisma.ingestionJob.findMany({
      where: {
        status: IngestionJobStatus.QUEUED,
        supersededById: null,
        organizationId: { in: allowed },
        // Written out rather than taken from `IngestionJobsService.scope()`,
        // which also carries `requireTenant` and `documentVisibility` — a
        // caller-scoped pair this sweep has no caller for.
        //
        // `deleteDocument` soft-deletes the document and never touches
        // `ingestion_jobs`, so without this a document deleted while its job
        // was stranded is re-ingested: parsed, chunked and EMBEDDED against the
        // tenant's budget, before `writeChunkRows` marks the chunks deleted.
        // No disclosure, and a full metered ingestion nobody asked for.
        document: { deletedAt: null },
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_RECONCILED_PER_RUN,
      include: {
        document: {
          select: { fileUrl: true, fileType: true, ocrLanguages: true },
        },
      },
    });

    const stuck: typeof candidates = [];
    for (const job of candidates) {
      // The only thing that can tell a stranded QUEUED row from one about to
      // run. A job enqueued seconds ago is runnable and is not ours.
      //
      // One Redis round trip per candidate, so at most `MAX_RECONCILED_PER_RUN`
      // per tick — and only over jobs whose tenant can actually act, which is a
      // second thing the budget-first ordering buys.
      if (await this.queue.isRunnable(job.id)) {
        result.skippedRunnable += 1;
        continue;
      }
      stuck.push(job);
    }

    // Still grouped, though the budget is already decided: the grouping is what
    // keeps one tenant's jobs contiguous in the log and in the queue, so a
    // backlog drains as a backlog rather than interleaved with everyone else's.
    for (const jobs of groupByOrganization(stuck).values()) {
      await this.reconcile(jobs, result);
    }

    return this.report(result);
  }

  /**
   * The tenants with stuck jobs that are under their AI cap, oldest first.
   *
   * **One entitlement read per tenant, before the row cap.** The gate covers
   * both causes rather than only the deferral, and that is the point rather
   * than a convenience: `process()` sets `PARSING`, downloads the object,
   * parses and chunks it, and only reaches the budget gate at the embedding
   * step — so a re-enqueue that will defer still pays for the parse first. Ten
   * stuck documents in a capped tenant is ten full parses every ten minutes,
   * forever, and that is as true of a never-enqueued job as of a deferred one.
   */
  private async organizationsUnderCap(
    result: ReconcileResult,
  ): Promise<string[]> {
    // Ordered by the oldest stuck job each tenant holds, so a tenant beyond
    // `MAX_ORGANIZATIONS_PER_RUN` is reached on a later run rather than never.
    const withStuckJobs = await this.prisma.ingestionJob.groupBy({
      by: ['organizationId'],
      where: {
        status: IngestionJobStatus.QUEUED,
        supersededById: null,
        document: { deletedAt: null },
      },
      _min: { createdAt: true },
      orderBy: { _min: { createdAt: 'asc' } },
      take: MAX_ORGANIZATIONS_PER_RUN,
    });

    const allowed: string[] = [];
    const atCap: string[] = [];

    for (const { organizationId } of withStuckJobs) {
      // `systemContext` carries a tenant and no actor, which is exactly what
      // auth-service's handler needs: `getOrganizationEntitlements` resolves
      // through `requireTenant`, never `requireActor`. The processor builds the
      // same context for the same call.
      const decision = await this.ledger.checkBudget(
        organizationId,
        AiSurface.INGESTION_EMBEDDING,
        systemContext(organizationId),
      );

      if (decision.allowed) allowed.push(organizationId);
      else atCap.push(organizationId);
    }

    if (atCap.length > 0) {
      result.skippedAtCap = atCap.length;
      // Per TENANT, not a job total: "100 at cap" is one tenant's backlog and
      // "100 across 40 tenants" is a platform-wide billing problem, and telling
      // those apart is the reason this line exists.
      this.logger.warn(
        `Skipped ${atCap.length} organization(s) at their AI cap: ${atCap.join(', ')}`,
      );
    }

    return allowed;
  }

  /**
   * The run's one unconditional log line.
   *
   * Unconditional because the alternative was logging only when work happened,
   * which made a tick that skipped everything indistinguishable from a tick
   * with nothing to do — and `runs.track` discards this return value, so the
   * log is the only surface an operator has.
   */
  private report(result: ReconcileResult): ReconcileResult {
    const requeued = result.enqueued + result.drained;

    if (requeued + result.skippedAtCap + result.unreconcilable > 0) {
      this.logger.log(
        `Reconcile: ${requeued} re-queued (${result.enqueued} never queued, ` +
          `${result.drained} deferred), ${result.skippedAtCap} org(s) at cap, ` +
          `${result.unreconcilable} unreconcilable, ` +
          `${result.skippedRunnable} already running`,
      );
    }

    return result;
  }

  /**
   * The stuck jobs of one tenant already known to be under its cap.
   *
   * No budget check here — `organizationsUnderCap` made it before the row cap
   * was applied, which is what stops one capped tenant owning the head of the
   * queue forever.
   */
  private async reconcile(
    jobs: readonly StuckJob[],
    result: ReconcileResult,
  ): Promise<void> {
    for (const job of jobs) {
      // ONE row must not block the queue behind it, whatever put it there.
      //
      // `toJobData` narrows `ocrLanguages` by parsing, and parsing REFUSES
      // rather than filters — so a row carrying a code the build no longer
      // knows throws here. Uncaught, that aborts the whole sweep, and
      // `createdAt asc` means the same row is hit first again next tick: every
      // stranded document behind it stays stranded forever.
      //
      // The write-side check in `confirmDocument`/`replaceDocument` is what
      // stops such a row being created. This is what stops an existing one —
      // legacy, or a future `OCR_LANGUAGES` retirement — from being permanent.
      try {
        await this.reconcileOne(job, result);
      } catch (error) {
        result.unreconcilable += 1;
        this.logger.error(
          `Cannot reconcile ingestion job ${job.id}: ${formatErrorMsg(error)}`,
        );
      }
    }
  }

  /** One job, by the arm its `bullmqJobId` names. */
  private async reconcileOne(
    job: StuckJob,
    result: ReconcileResult,
  ): Promise<void> {
    const data = toJobData(job);

    // `bullmqJobId` holds one bit, not an identifier: `enqueue` passes
    // `jobId: ingestionJobId`, so the column stores the row's own id back to
    // itself and what it records is "did enqueue return".
    //
    // Empty means it never did — nothing to remove. Set means BullMQ took it
    // and the run COMPLETED as a deferral, and `drainDeferred` removes before
    // adding because BullMQ refuses an `add()` for an id it still holds.
    if (job.bullmqJobId === '') {
      await this.queue.enqueue(data);
      result.enqueued += 1;
    } else {
      // Called per job rather than per organization, and deliberately: it
      // loops internally either way, and one call per job is what keeps arm A
      // and arm B reading alike at this branch.
      await this.queue.drainDeferred([data]);
      result.drained += 1;
    }
  }
}

function groupByOrganization(
  jobs: readonly StuckJob[],
): Map<string, StuckJob[]> {
  const byOrganization = new Map<string, StuckJob[]>();

  for (const job of jobs) {
    const existing = byOrganization.get(job.organizationId);
    if (existing) existing.push(job);
    else byOrganization.set(job.organizationId, [job]);
  }

  return byOrganization;
}

/**
 * The payload the worker needs, rebuilt from the row.
 *
 * The original arrived on `document.uploaded`, carrying these so the worker
 * needs no lookup to start. There is no event here, so the sweep reads what the
 * event would have carried — which is why the candidate query includes the
 * document.
 */
function toJobData(job: StuckJob): IngestionJobData {
  return {
    organizationId: job.organizationId,
    documentId: job.documentId,
    ingestionJobId: job.id,
    objectPath: job.document.fileUrl,
    fileType: job.document.fileType,
    // Narrowed here for the same reason the processor narrows it: a code that
    // is not a language must fail the job rather than drop out of `-l` and OCR
    // the document in English.
    ocrLanguages: parseOcrLanguages(job.document.ocrLanguages),
  };
}
