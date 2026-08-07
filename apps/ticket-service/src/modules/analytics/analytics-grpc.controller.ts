import { JobHealthService } from '@synapsedesk/common';
import { Controller } from '@nestjs/common';
import type { Metadata } from '@grpc/grpc-js';
import {
  JobHealthResponse,
  toTimestamp,
  AgentStatsResponse,
  AnalyticsRangeRequest,
  AnalyticsServiceController,
  AnalyticsServiceControllerMethods,
  CreateExportRequest,
  DeflectionResponse,
  ExportResponse,
  GetExportRequest,
  OverviewResponse,
  ResponseTimesResponse,
  RunRollupRequest,
  RunRollupResponse,
  SatisfactionResponse,
  unpackCallerContext,
  VolumeResponse,
} from '@synapsedesk/grpc-proto';
import { AnalyticsService } from './analytics.service';
import { TicketRollupJob } from './ticket-rollup.job';
import { AnalyticsExportFacade } from './analytics-export.facade';

/**
 * Domain B's analytics surface — 19-doc §3.2.
 *
 * Every read unpacks the caller context, and every one is tenant-scoped by
 * `requireTenant` inside the service. The rollup tables are NEW tables written
 * by a job rather than by a scoped request handler, which is exactly where a
 * missing `organization_id` filter hides — so the scoping is asserted per
 * endpoint rather than assumed from the table.
 */
@Controller()
@AnalyticsServiceControllerMethods()
export class AnalyticsGrpcController implements AnalyticsServiceController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly rollup: TicketRollupJob,
    private readonly exports: AnalyticsExportFacade,
    private readonly jobHealth: JobHealthService,
  ) {}

  getOverview(
    request: AnalyticsRangeRequest,
    metadata?: Metadata,
  ): Promise<OverviewResponse> {
    return this.analytics.getOverview(request, unpackCallerContext(metadata));
  }

  getDeflection(
    request: AnalyticsRangeRequest,
    metadata?: Metadata,
  ): Promise<DeflectionResponse> {
    return this.analytics.getDeflection(request, unpackCallerContext(metadata));
  }

  getResponseTimes(
    request: AnalyticsRangeRequest,
    metadata?: Metadata,
  ): Promise<ResponseTimesResponse> {
    return this.analytics.getResponseTimes(
      request,
      unpackCallerContext(metadata),
    );
  }

  getVolume(
    request: AnalyticsRangeRequest,
    metadata?: Metadata,
  ): Promise<VolumeResponse> {
    return this.analytics.getVolume(request, unpackCallerContext(metadata));
  }

  getSatisfaction(
    request: AnalyticsRangeRequest,
    metadata?: Metadata,
  ): Promise<SatisfactionResponse> {
    return this.analytics.getSatisfaction(
      request,
      unpackCallerContext(metadata),
    );
  }

  getAgentStats(
    request: AnalyticsRangeRequest,
    metadata?: Metadata,
  ): Promise<AgentStatsResponse> {
    return this.analytics.getAgentStats(request, unpackCallerContext(metadata));
  }

  /**
   * The rollup, on demand.
   *
   * **Platform-operated and never routed to a tenant.** A backfill recomputes
   * numbers a customer may already have exported, so it is an operator's
   * decision with an audit trail behind it — not a button on a dashboard.
   *
   * Exposed as an RPC rather than left to a scheduler alone because the
   * recovery path has to be reachable: 19-doc §2.3 is explicit that the
   * alternative to a shipped backfill is a metric that stays wrong forever.
   */
  async runRollup(request: RunRollupRequest): Promise<RunRollupResponse> {
    const outcome =
      request.from && request.to
        ? await this.rollup.backfill(
            new Date(`${request.from}T00:00:00.000Z`),
            new Date(`${request.to}T00:00:00.000Z`),
          )
        : await this.rollup.run();

    return {
      tenants: outcome.tenants,
      ticketRows: outcome.ticketRows,
      agentRows: outcome.agentRows,
    };
  }
  /**
   * The heartbeat — 20-doc §4.4.
   *
   * Platform-operated, like `runRollup` above. Returns every row unjudged: the
   * staleness decision needs the list of jobs this build EXPECTS, and a job
   * that never ran has no row to return.
   */
  async getJobHealth(): Promise<JobHealthResponse> {
    const rows = await this.jobHealth.list();

    return {
      items: rows.map((row) => ({
        jobName: row.jobName,
        lastStartedAt: row.lastStartedAt
          ? toTimestamp(row.lastStartedAt)
          : undefined,
        lastSucceededAt: row.lastSucceededAt
          ? toTimestamp(row.lastSucceededAt)
          : undefined,
        lastDurationMs: row.lastDurationMs ?? undefined,
        lastError: row.lastError ?? undefined,
        consecutiveFailures: row.consecutiveFailures,
      })),
    };
  }

  // ------------------------------------------------------ 19-doc §5, export

  /**
   * Queues an export and answers IMMEDIATELY with a job id.
   *
   * The file appears later. A synchronous export of a quarter would hold a
   * request open for the length of a bulk read — which is the hot-path
   * competition this whole design exists to avoid, arriving through the one
   * endpoint that looks like a read.
   */
  createExport(
    request: CreateExportRequest,
    metadata?: Metadata,
  ): Promise<ExportResponse> {
    return this.exports.create(request, unpackCallerContext(metadata));
  }

  /**
   * One export's state, with a freshly minted download URL when it is ready.
   *
   * Another tenant's id answers **404, not 403** — a 403 confirms the job
   * exists, which turns polling into an oracle for how much a competitor
   * exports.
   */
  getExport(
    request: GetExportRequest,
    metadata?: Metadata,
  ): Promise<ExportResponse> {
    return this.exports.get(request.id, unpackCallerContext(metadata));
  }
}
