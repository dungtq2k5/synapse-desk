import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AI_LEDGER_SERVICE_NAME,
  AiLedgerServiceClient,
  ANALYTICS_SERVICE_NAME,
  AnalyticsServiceClient,
  fromProtoTimestamp,
  INGESTION_GRPC_CLIENT,
  TICKET_GRPC_CLIENT,
  AUTH_GRPC_CLIENT,
  PLATFORM_SERVICE_NAME,
  PlatformServiceClient,
} from '@synapsedesk/grpc-proto';
import {
  formatErrorMsg,
  RequestContext,
  RequestOrigin,
} from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import { JobRunStatusDto } from './dto/platform-jobs.dto';

/**
 * Who is asking for a heartbeat read.
 *
 * Widened from `RequestContext` to include a bare origin A
 * Prometheus scrape has no user, and `BaseGrpcClient.call` already takes the
 * union for exactly this reason: an unauthenticated caller is a real caller with
 * no identity, not a caller to fabricate one for.
 */
type HeartbeatCaller = RequestContext | RequestOrigin;

/** A heartbeat row plus which service it came from. */
export type ServiceHeartbeats = {
  service: string;
  rows: Omit<JobRunStatusDto, 'health'>[];
};

/**
 * Reads and drives the schedulers in both owning services
 *
 * The heartbeat tables live in `postgres_ticket` and `postgres_ingestion`, one
 * per service, because that is where the jobs run. So "are the jobs healthy" is
 * a two-leg fan-out — and a leg that fails is REPORTED rather than thrown,
 * because "ingestion-service is unreachable" is itself the answer somebody
 * asking this question needs.
 */
@Injectable()
export class PlatformJobsClient extends BaseGrpcClient implements OnModuleInit {
  protected readonly serviceName = 'ticket-service';

  private readonly logger = new Logger(PlatformJobsClient.name);

  private analyticsService!: AnalyticsServiceClient;
  private ledgerService!: AiLedgerServiceClient;
  private platformService!: PlatformServiceClient;

  constructor(
    @Inject(TICKET_GRPC_CLIENT) private readonly ticketClient: ClientGrpc,
    @Inject(INGESTION_GRPC_CLIENT) private readonly ingestionClient: ClientGrpc,
    @Inject(AUTH_GRPC_CLIENT) private readonly authClient: ClientGrpc,
  ) {
    super();
  }

  onModuleInit(): void {
    this.analyticsService =
      this.ticketClient.getService<AnalyticsServiceClient>(
        ANALYTICS_SERVICE_NAME,
      );
    this.ledgerService = this.ingestionClient.getService<AiLedgerServiceClient>(
      AI_LEDGER_SERVICE_NAME,
    );
    this.platformService = this.authClient.getService<PlatformServiceClient>(
      PLATFORM_SERVICE_NAME,
    );
  }

  async authHeartbeats(context: HeartbeatCaller): Promise<ServiceHeartbeats> {
    const response = await this.call(
      (metadata) => this.platformService.getAuthJobHealth({}, metadata),
      context,
    );

    return {
      service: 'auth-service',
      rows: response.items.map((item) => ({
        service: 'auth-service',
        jobName: item.jobName,
        lastStartedAt:
          fromProtoTimestamp(item.lastStartedAt)?.toISOString() ?? null,
        lastSucceededAt:
          fromProtoTimestamp(item.lastSucceededAt)?.toISOString() ?? null,
        lastDurationMs: item.lastDurationMs ?? null,
        lastError: item.lastError ?? null,
        consecutiveFailures: item.consecutiveFailures,
      })),
    };
  }

  async ticketHeartbeats(context: HeartbeatCaller): Promise<ServiceHeartbeats> {
    const response = await this.call(
      (metadata) => this.analyticsService.getJobHealth({}, metadata),
      context,
    );

    return {
      service: 'ticket-service',
      rows: response.items.map((item) => ({
        service: 'ticket-service',
        jobName: item.jobName,
        lastStartedAt:
          fromProtoTimestamp(item.lastStartedAt)?.toISOString() ?? null,
        lastSucceededAt:
          fromProtoTimestamp(item.lastSucceededAt)?.toISOString() ?? null,
        lastDurationMs: item.lastDurationMs ?? null,
        lastError: item.lastError ?? null,
        consecutiveFailures: item.consecutiveFailures,
      })),
    };
  }

  async ingestionHeartbeats(
    context: HeartbeatCaller,
  ): Promise<ServiceHeartbeats> {
    const response = await this.call(
      (metadata) => this.ledgerService.getAiJobHealth({}, metadata),
      context,
    );

    return {
      service: 'ingestion-service',
      rows: response.items.map((item) => ({
        service: 'ingestion-service',
        jobName: item.jobName,
        lastStartedAt:
          fromProtoTimestamp(item.lastStartedAt)?.toISOString() ?? null,
        lastSucceededAt:
          fromProtoTimestamp(item.lastSucceededAt)?.toISOString() ?? null,
        lastDurationMs: item.lastDurationMs ?? null,
        lastError: item.lastError ?? null,
        consecutiveFailures: item.consecutiveFailures,
      })),
    };
  }

  /** The ticket rollup — now, or over an explicit range. */
  async runTicketRollup(
    context: RequestContext,
    range?: { from: string; to: string },
  ): Promise<{ tenants: number; rows: number }> {
    const response = await this.call(
      (metadata) => this.analyticsService.runRollup(range ?? {}, metadata),
      context,
    );

    return {
      tenants: response.tenants,
      rows: response.ticketRows + response.agentRows,
    };
  }

  /** The AI rollup — now, or over an explicit range. */
  async runAiRollup(
    context: RequestContext,
    range?: { from: string; to: string },
  ): Promise<{ tenants: number; rows: number }> {
    const response = await this.call(
      (metadata) => this.ledgerService.runAiRollup(range ?? {}, metadata),
      context,
    );

    return { tenants: response.tenants, rows: response.rows };
  }

  /**
   * Wraps one leg so a failure becomes a REPORTED absence.
   *
   * A 500 because one service is restarting is the least useful possible answer
   * to "are the scheduled jobs running" — the whole question is about what is
   * and is not working.
   */
  async tryLeg<T>(
    source: string,
    leg: () => Promise<T>,
  ): Promise<{ value: T } | { failure: string }> {
    try {
      return { value: await leg() };
    } catch (error) {
      this.logger.warn(`${source} leg failed: ${formatErrorMsg(error)}`);

      return { failure: source };
    }
  }
}
