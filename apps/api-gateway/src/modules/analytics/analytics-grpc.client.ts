import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AI_LEDGER_SERVICE_NAME,
  AiLedgerServiceClient,
  ANALYTICS_SERVICE_NAME,
  AnalyticsServiceClient,
  fromTimestamp,
  INGESTION_GRPC_CLIENT,
  TICKET_GRPC_CLIENT,
  USER_SERVICE_NAME,
  UserServiceClient,
  AUTH_GRPC_CLIENT,
} from '@synapsedesk/grpc-proto';
import { formatErrorMsg, RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import { AnalyticsRangeQueryDto } from './dto/rest/analytics.dto';
import {
  AiUsageDto,
  AnalyticsExportDto,
  DeflectionDto,
  MeanDto,
  OverviewDto,
  RateDto,
  ResponseTimesDto,
  SatisfactionDto,
  VolumeDto,
} from './dto/rest/analytics-response.dto';

/** What a failed leg reports back, so the caller can mark it unavailable. */
export type LegFailure = { source: string; reason: string };

/**
 * The gateway's analytics client — 19-doc §1, §3.2.
 *
 * **This class IS the argument for having no `analytics-service`.** The fan-out
 * is smaller than the ownership map implies: eight of the eleven endpoints are
 * single-service, and the three that are not join on a user id or a document id
 * at a cardinality of tens-to-hundreds per tenant. That is an in-memory join in
 * the composition layer, not a distributed query — and a service whose entire
 * job is this file would be a hop that adds latency and a deploy unit while
 * answering no question the gateway could not.
 *
 * `auth-service` appears here as a NAME SOURCE, never as an analytics source:
 * resolving an agent id to a display name is the same cross-service reference
 * pattern used everywhere else (RDM §1.13), not an aggregation.
 */
@Injectable()
export class AnalyticsGrpcClient
  extends BaseGrpcClient
  implements OnModuleInit
{
  protected readonly serviceName = 'ticket-service';

  private readonly logger = new Logger(AnalyticsGrpcClient.name);

  private analyticsService!: AnalyticsServiceClient;
  private ledgerService!: AiLedgerServiceClient;
  private userService!: UserServiceClient;

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
    this.userService =
      this.authClient.getService<UserServiceClient>(USER_SERVICE_NAME);
  }

  // ------------------------------------------- the single-service endpoints

  async overview(
    query: AnalyticsRangeQueryDto,
    context: RequestContext,
  ): Promise<OverviewDto> {
    const response = await this.call(
      (metadata) =>
        this.analyticsService.getOverview(toRangeRequest(query), metadata),
      context,
    );

    return {
      ticketsCreated: response.ticketsCreated,
      ticketsResolved: response.ticketsResolved,
      ticketsEscalated: response.ticketsEscalated,
      openTickets: response.openTickets,
      deflection: toRate(response.deflection),
      csat: toRate(response.csat),
      humanFirstResponseSeconds: toMean(response.humanFirstResponseSeconds),
      aiFirstResponseSeconds: toMean(response.aiFirstResponseSeconds),
      resolutionSeconds: toMean(response.resolutionSeconds),
      openTicketMedianAgeSeconds: response.openTicketMedianAgeSeconds ?? null,
      computedAt: fromTimestamp(response.computedAt) ?? null,
    };
  }

  async deflection(
    query: AnalyticsRangeQueryDto,
    context: RequestContext,
  ): Promise<DeflectionDto> {
    const response = await this.call(
      (metadata) =>
        this.analyticsService.getDeflection(toRangeRequest(query), metadata),
      context,
    );

    return {
      points: response.points.map((point) => ({
        day: point.day,
        deflection: toRate(point.deflection),
        chatConversations: point.chatConversations,
        chatResolvedWithoutEscalation: point.chatResolvedWithoutEscalation,
      })),
      total: toRate(response.total),
    };
  }

  async responseTimes(
    query: AnalyticsRangeQueryDto,
    context: RequestContext,
  ): Promise<ResponseTimesDto> {
    const response = await this.call(
      (metadata) =>
        this.analyticsService.getResponseTimes(toRangeRequest(query), metadata),
      context,
    );

    return {
      points: response.points.map((point) => ({
        day: point.day,
        humanFirstResponseSeconds: toMean(point.humanFirstResponseSeconds),
        aiFirstResponseSeconds: toMean(point.aiFirstResponseSeconds),
        resolutionSeconds: toMean(point.resolutionSeconds),
      })),
      humanTotal: toMean(response.humanTotal),
      aiTotal: toMean(response.aiTotal),
      resolutionTotal: toMean(response.resolutionTotal),
    };
  }

  async volume(
    query: AnalyticsRangeQueryDto,
    context: RequestContext,
  ): Promise<VolumeDto> {
    const response = await this.call(
      (metadata) =>
        this.analyticsService.getVolume(toRangeRequest(query), metadata),
      context,
    );

    return {
      points: response.points,
      byStatus: response.byStatus,
      byPriority: response.byPriority,
      bySource: response.bySource,
    };
  }

  async satisfaction(
    query: AnalyticsRangeQueryDto,
    context: RequestContext,
  ): Promise<SatisfactionDto> {
    const response = await this.call(
      (metadata) =>
        this.analyticsService.getSatisfaction(toRangeRequest(query), metadata),
      context,
    );

    return {
      points: response.points.map((point) => ({
        day: point.day,
        csat: toRate(point.csat),
        citationAccuracy: toRate(point.citationAccuracy),
      })),
      csatTotal: toRate(response.csatTotal),
      citationAccuracyTotal: toRate(response.citationAccuracyTotal),
    };
  }

  async aiUsage(
    query: AnalyticsRangeQueryDto,
    context: RequestContext,
  ): Promise<AiUsageDto> {
    const response = await this.call(
      (metadata) =>
        this.ledgerService.getAiUsage(
          {
            from: query.from,
            to: query.to,
            granularity: query.granularity,
          },
          metadata,
        ),
      context,
    );

    return {
      points: response.points.map((point) => ({
        day: point.day,
        generations: point.generations,
        costMicros: point.costMicros,
      })),
      byPurpose: response.byPurpose.map(toSlice),
      byModel: response.byModel.map(toSlice),
      totalCostMicros: response.totalCostMicros,
      totalGenerations: response.totalGenerations,
      monthlyBudgetMicros: response.monthlyBudgetMicros,
      aiModelTier: response.aiModelTier,
      draftAcceptance: toRate(response.draftAcceptance),
      emptyRetrievalRate: toRate(response.emptyRetrievalRate),
      computedAt: fromTimestamp(response.computedAt) ?? null,
    };
  }

  // ------------------------------------------------------ 19-doc §5, export

  async createExport(
    dto: { kind: string; from: string; to: string; departmentId?: string },
    context: RequestContext,
  ): Promise<AnalyticsExportDto> {
    return toExportDto(
      await this.call(
        (metadata) => this.analyticsService.createExport(dto, metadata),
        context,
      ),
    );
  }

  async getExport(
    id: string,
    context: RequestContext,
  ): Promise<AnalyticsExportDto> {
    return toExportDto(
      await this.call(
        (metadata) => this.analyticsService.getExport({ id }, metadata),
        context,
      ),
    );
  }

  // ------------------------------------------------- the cross-service legs

  /**
   * A leg that may fail WITHOUT failing the request — 19-doc §3.2.
   *
   * Returns a discriminated result rather than throwing, so the composer can
   * render the legs it has and mark the rest `unavailable`. That is what
   * someone diagnosing an incident actually needs: a dashboard where nine tiles
   * render and one names the service that is down beats a 500 that names
   * nothing.
   *
   * `call()` is still used inside, so a leg keeps the shared deadline and
   * metadata packing. What changes is what happens to the error: for a
   * single-service route it propagates and the exception filter turns it into a
   * status; here it is caught, and the request still answers 200.
   */
  async tryLeg<T>(
    source: string,
    produce: () => Promise<T>,
  ): Promise<{ value: T } | { failure: LegFailure }> {
    try {
      return { value: await produce() };
    } catch (error) {
      const reason = formatErrorMsg(error);
      this.logger.warn(`Analytics leg '${source}' unavailable: ${reason}`);

      return { failure: { source, reason } };
    }
  }

  agentStats(query: AnalyticsRangeQueryDto, context: RequestContext) {
    return this.tryLeg('ticket-service', () =>
      this.call(
        (metadata) =>
          this.analyticsService.getAgentStats(toRangeRequest(query), metadata),
        context,
      ),
    );
  }

  ledgerUsage(query: AnalyticsRangeQueryDto, context: RequestContext) {
    return this.tryLeg('ingestion-service', () =>
      this.call(
        (metadata) =>
          this.ledgerService.getAiUsage(
            { from: query.from, to: query.to, granularity: query.granularity },
            metadata,
          ),
        context,
      ),
    );
  }

  knowledgeGaps(
    query: AnalyticsRangeQueryDto,
    limit: number,
    context: RequestContext,
  ) {
    return this.tryLeg('ingestion-service', () =>
      this.call(
        (metadata) =>
          this.ledgerService.getKnowledgeGaps(
            { from: query.from, to: query.to, limit },
            metadata,
          ),
        context,
      ),
    );
  }

  documentAnalytics(limit: number, context: RequestContext) {
    return this.tryLeg('ingestion-service', () =>
      this.call(
        (metadata) =>
          this.ledgerService.getDocumentAnalytics({ limit }, metadata),
        context,
      ),
    );
  }

  /**
   * Display names for a set of agent ids — the HYDRATION leg.
   *
   * Bulk, and reusing the read Domain E added for notification audiences: one
   * round trip for a page of agents rather than one per row. A per-row lookup
   * would make the endpoint's cost scale with team size for a field that is
   * decoration on every row.
   */
  hydrateNames(userIds: string[], context: RequestContext) {
    return this.tryLeg('auth-service', () =>
      this.call(
        (metadata) =>
          this.userService.listUsersByIds(
            { organizationId: context.organizationId ?? '', userIds },
            metadata,
          ),
        context,
      ),
    );
  }
}

function toRangeRequest(query: AnalyticsRangeQueryDto) {
  return {
    from: query.from,
    to: query.to,
    departmentId: query.departmentId,
    granularity: query.granularity,
  };
}

/** `undefined` → null, never → 0. A missing rate is not a rate of zero. */
function toRate(value?: {
  rate?: number;
  numerator: number;
  denominator: number;
}): RateDto {
  return {
    rate: value?.rate ?? null,
    numerator: value?.numerator ?? 0,
    denominator: value?.denominator ?? 0,
  };
}

function toMean(value?: { mean?: number; count: number }): MeanDto {
  return { mean: value?.mean ?? null, count: value?.count ?? 0 };
}

function toSlice(slice: {
  purpose: string;
  modelName: string;
  generations: number;
  promptTokens: number;
  completionTokens: number;
  costMicros: number;
  latencyMs?: { mean?: number; count: number };
  failureRate?: { rate?: number; numerator: number; denominator: number };
}) {
  return {
    purpose: slice.purpose,
    modelName: slice.modelName,
    generations: slice.generations,
    promptTokens: slice.promptTokens,
    completionTokens: slice.completionTokens,
    costMicros: slice.costMicros,
    latencyMs: toMean(slice.latencyMs),
    failureRate: toRate(slice.failureRate),
  };
}

function toExportDto(response: {
  id: string;
  status: string;
  kind: string;
  rowCount?: number;
  rollupComputedAt?: unknown;
  downloadUrl?: string;
  error?: string;
  createdAt?: unknown;
  completedAt?: unknown;
}): AnalyticsExportDto {
  return {
    id: response.id,
    status: response.status,
    kind: response.kind,
    rowCount: response.rowCount ?? null,
    rollupComputedAt: fromTimestamp(response.rollupComputedAt as never) ?? null,
    downloadUrl: response.downloadUrl ?? null,
    error: response.error ?? null,
    createdAt: fromTimestamp(response.createdAt as never) ?? new Date(0),
    completedAt: fromTimestamp(response.completedAt as never) ?? null,
  };
}
