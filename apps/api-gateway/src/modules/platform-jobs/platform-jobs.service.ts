import type { GrpcPeer } from '@synapsedesk/grpc-proto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  checkStaleness,
  JobHeartbeat,
  RequestContext,
  RequestOrigin,
  JOB_SERVICE,
  SCHEDULED_JOBS,
  SchedulerService,
  ScheduledJobName,
} from '@synapsedesk/common';
import { PlatformJobsClient } from './platform-jobs.client';
import { BackfillJobDto } from './dto/platform-jobs.dto';
import {
  JobHealthResponseDto,
  JobRunResultResponseDto,
  JobRunStatusResponseDto,
} from './dto/platform-jobs-response.dto';

/**
 * The gRPC peer for each scheduler-owning service.
 *
 * Three entries, and it exists because the two vocabularies differ:
 * `SCHEDULER_QUEUE` is keyed `'ingestion'` and a `GrpcPeer` is
 * `'ingestion-service'`. Derived rather than string-built, so a peer that stops
 * matching is a compile error instead of a call to a name nothing answers.
 */
const SERVICE_PEER: Record<SchedulerService, GrpcPeer> = {
  auth: 'auth-service',
  ticket: 'ticket-service',
  ingestion: 'ingestion-service',
};

/**
 * Which service owns each schedule.
 *
 * **Derived from `JOB_SERVICE`, not repeated here.** This used to be its own
 * exhaustive `Record<ScheduledJobName, GrpcPeer>`, which was compile-checked
 * and correct — and was a SECOND answer to "which service owns this job",
 * with the registrars holding the first. Two exhaustive tables cannot disagree
 * about coverage; they can absolutely disagree about content.
 *
 * `JOB_SERVICE` is now the one answer, and the registrars iterate it, so a job
 * that appears on this page is a job some service registered.
 */
function jobOwner(name: ScheduledJobName): GrpcPeer {
  return SERVICE_PEER[JOB_SERVICE[name]];
}

/**
 * The platform job surface
 *
 * Two jobs, and the second is the one that pays for the first:
 *
 *   1. **Report health**, judging staleness against the list of jobs this build
 *      EXPECTS rather than against the rows it happens to find. A job that has
 *      never run has no row, and that is the case this whole document exists
 *      about — a reader that iterates over rows finds nothing wrong.
 *   2. **Trigger and backfill**, because a rollup bug fixed going forward
 *      leaves the wrong numbers in place forever, and a scheduled job you
 *      cannot run by hand cannot be debugged in staging without waiting for the
 *      clock.
 */
@Injectable()
export class PlatformJobsService {
  private readonly logger = new Logger(PlatformJobsService.name);

  constructor(private readonly client: PlatformJobsClient) {}

  /**
   * Every expected job, with a verdict.
   *
   * **`expected` is the constant list, not the rows returned.** This is the
   * single most important line in the file: judging only what came back reports
   * a clean bill of health for a service whose scheduler was never wired, which
   * is precisely what happened for two domains.
   */
  async health(
    // `RequestOrigin` too, not just `RequestContext`. The Prometheus
    // scrape reads the same heartbeats and has no user, and inventing one would
    // put a fake actor in the audit trail of a read that nobody performed.
    context: RequestContext | RequestOrigin,
  ): Promise<JobHealthResponseDto> {
    // Three legs, because the heartbeat table lives in each service's own
    // database — auth-service joined them when it moved off `@nestjs/schedule`.
    //
    const [ticketLeg, ingestionLeg, authLeg] = await Promise.all([
      this.client.tryLeg('ticket-service', () =>
        this.client.ticketHeartbeats(context),
      ),
      this.client.tryLeg('ingestion-service', () =>
        this.client.ingestionHeartbeats(context),
      ),
      this.client.tryLeg('auth-service', () =>
        this.client.authHeartbeats(context),
      ),
    ]);

    const unavailable: string[] = [];
    const rows: Omit<JobRunStatusResponseDto, 'health'>[] = [];

    for (const leg of [ticketLeg, ingestionLeg, authLeg]) {
      if ('failure' in leg) {
        unavailable.push(leg.failure);
        continue;
      }
      rows.push(...leg.value.rows);
    }

    const heartbeats: JobHeartbeat[] = rows.map((row) => ({
      jobName: row.jobName,
      lastSucceededAt: row.lastSucceededAt
        ? new Date(row.lastSucceededAt)
        : null,
      consecutiveFailures: row.consecutiveFailures,
    }));

    // Only the jobs whose owning service ANSWERED. A job on an unreachable
    // service is not "never ran" — it is unknown, and `unavailable` already
    // says so. Reporting it as never-ran would page somebody about a wiring bug
    // that does not exist.
    const reachable = Object.values(SCHEDULED_JOBS).filter(
      (name) => !unavailable.includes(jobOwner(name)),
    );

    const verdicts = new Map(
      checkStaleness(reachable, heartbeats).map((v) => [v.jobName, v.reason]),
    );

    const items: JobRunStatusResponseDto[] = reachable.map((name) => {
      const row = rows.find((candidate) => candidate.jobName === name);

      return {
        service: jobOwner(name),
        jobName: name,
        lastStartedAt: row?.lastStartedAt ?? null,
        lastSucceededAt: row?.lastSucceededAt ?? null,
        lastDurationMs: row?.lastDurationMs ?? null,
        lastError: row?.lastError ?? null,
        consecutiveFailures: row?.consecutiveFailures ?? 0,
        health: verdicts.get(name) ?? 'healthy',
      };
    });

    // Per-STEP rows the schedulers also record. Reported after the top-level
    // jobs and never judged for staleness: a step only runs when its parent
    // does, so it would double-count the same outage under a second name.
    const stepNames = new Set(Object.values(SCHEDULED_JOBS) as string[]);
    for (const row of rows) {
      if (stepNames.has(row.jobName)) continue;

      items.push({ ...row, health: 'step' });
    }

    return {
      items,
      degraded: verdicts.size > 0 || unavailable.length > 0,
      unavailable,
    };
  }

  /**
   * Runs one job NOW.
   *
   * The first run after this ships is a backfill of everything since the tables
   * were created, and a rollup bug can only be corrected by recomputation.
   */
  async run(
    jobName: string,
    context: RequestContext,
  ): Promise<JobRunResultResponseDto> {
    return this.dispatch(jobName, context);
  }

  /**
   * Recomputes an explicit range.
   *
   * **Safe to expose only because the jobs are idempotent and range-bounded**
   *. Without that property this endpoint would be a way to
   * double every counter in a quarter, which is why the range is required
   * rather than optional.
   */
  async backfill(
    jobName: string,
    dto: BackfillJobDto,
    context: RequestContext,
  ): Promise<JobRunResultResponseDto> {
    if (dto.from > dto.to) {
      throw new BadRequestException('from must not be after to');
    }

    // Audited by logging the actor and the reason together with the range. A
    // backfill rewrites numbers somebody may already have acted on, and the
    // reason is the only part a reader cannot reconstruct from the rows.
    this.logger.warn(
      `BACKFILL ${jobName} ${dto.from}..${dto.to} by ${context.sub}: ${dto.reason}`,
    );

    return this.dispatch(jobName, context, { from: dto.from, to: dto.to });
  }

  private async dispatch(
    jobName: string,
    context: RequestContext,
    range?: { from: string; to: string },
  ): Promise<JobRunResultResponseDto> {
    switch (jobName) {
      case SCHEDULED_JOBS.ANALYTICS_DAILY: {
        const outcome = await this.client.runTicketRollup(context, range);

        return { service: 'ticket-service', jobName, ...outcome };
      }
      case SCHEDULED_JOBS.LEDGER_DAILY: {
        const outcome = await this.client.runAiRollup(context, range);

        return { service: 'ingestion-service', jobName, ...outcome };
      }
      default:
        // Named rather than silently ignored: a typo'd job name that returned
        // 200 with zeros is indistinguishable from a job that ran and found
        // nothing, which is the confusion this whole surface exists to remove.
        throw new BadRequestException(
          `'${jobName}' is not a job that can be triggered by hand`,
        );
    }
  }
}
