import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  UserProjection,
  AI_LEDGER_SERVICE_NAME,
  AiLedgerServiceClient,
  ANALYTICS_SERVICE_NAME,
  AnalyticsServiceClient,
  fromProtoTimestamp,
  INGESTION_GRPC_CLIENT,
  TICKET_GRPC_CLIENT,
  USER_SERVICE_NAME,
  UserServiceClient,
  AUTH_GRPC_CLIENT,
  fromProtoAiModelTier,
  toProtoAnalyticsExportKind,
  AgentStatsResponse,
  AiUsageResponse,
  DocumentAnalyticsResponse,
  KnowledgeGapsResponse,
  ListUsersByIdsResponse,
} from '@synapsedesk/grpc-proto';
import { formatErrorMsg, RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import {
  toAiUsageSliceDto,
  toAnalyticsExportDto,
  toAnalyticsRangeRequest,
  toMeanDto,
  toRateDto,
} from './analytics.mapper';
import {
  AnalyticsRangeQueryDto,
  CreateExportDto,
} from './dto/rest/analytics.dto';
import {
  AiUsageDto,
  AnalyticsExportDto,
  DeflectionDto,
  OverviewDto,
  ResponseTimesDto,
  SatisfactionDto,
  VolumeDto,
} from './dto/rest/analytics-response.dto';

/** What a failed leg reports back, so the caller can mark it unavailable. */
export type LegFailure = { source: string; reason: string };

/** What {@link AnalyticsGrpcClient.tryLeg} resolves to: the value, or why not. */
export type LegResult<T> = { value: T } | { failure: LegFailure };

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
        this.analyticsService.getOverview(
          toAnalyticsRangeRequest(query),
          metadata,
        ),
      context,
    );

    return {
      ticketsCreated: response.ticketsCreated,
      ticketsResolved: response.ticketsResolved,
      ticketsEscalated: response.ticketsEscalated,
      openTickets: response.openTickets,
      deflection: toRateDto(response.deflection),
      csat: toRateDto(response.csat),
      humanFirstResponseSeconds: toMeanDto(response.humanFirstResponseSeconds),
      aiFirstResponseSeconds: toMeanDto(response.aiFirstResponseSeconds),
      resolutionSeconds: toMeanDto(response.resolutionSeconds),
      openTicketMedianAgeSeconds: response.openTicketMedianAgeSeconds ?? null,
      computedAt: fromProtoTimestamp(response.computedAt) ?? null,
      dataThrough: response.dataThrough ?? null,
    };
  }

  async deflection(
    query: AnalyticsRangeQueryDto,
    context: RequestContext,
  ): Promise<DeflectionDto> {
    const response = await this.call(
      (metadata) =>
        this.analyticsService.getDeflection(
          toAnalyticsRangeRequest(query),
          metadata,
        ),
      context,
    );

    return {
      points: response.points.map((point) => ({
        day: point.day,
        deflection: toRateDto(point.deflection),
        chatConversations: point.chatConversations,
        chatResolvedWithoutEscalation: point.chatResolvedWithoutEscalation,
      })),
      total: toRateDto(response.total),
      dataThrough: response.dataThrough ?? null,
    };
  }

  async responseTimes(
    query: AnalyticsRangeQueryDto,
    context: RequestContext,
  ): Promise<ResponseTimesDto> {
    const response = await this.call(
      (metadata) =>
        this.analyticsService.getResponseTimes(
          toAnalyticsRangeRequest(query),
          metadata,
        ),
      context,
    );

    return {
      points: response.points.map((point) => ({
        day: point.day,
        humanFirstResponseSeconds: toMeanDto(point.humanFirstResponseSeconds),
        aiFirstResponseSeconds: toMeanDto(point.aiFirstResponseSeconds),
        resolutionSeconds: toMeanDto(point.resolutionSeconds),
      })),
      humanTotal: toMeanDto(response.humanTotal),
      aiTotal: toMeanDto(response.aiTotal),
      resolutionTotal: toMeanDto(response.resolutionTotal),
      dataThrough: response.dataThrough ?? null,
    };
  }

  async volume(
    query: AnalyticsRangeQueryDto,
    context: RequestContext,
  ): Promise<VolumeDto> {
    const response = await this.call(
      (metadata) =>
        this.analyticsService.getVolume(
          toAnalyticsRangeRequest(query),
          metadata,
        ),
      context,
    );

    return {
      points: response.points,
      byStatus: response.byStatus,
      byPriority: response.byPriority,
      bySource: response.bySource,
      dataThrough: response.dataThrough ?? null,
    };
  }

  async satisfaction(
    query: AnalyticsRangeQueryDto,
    context: RequestContext,
  ): Promise<SatisfactionDto> {
    const response = await this.call(
      (metadata) =>
        this.analyticsService.getSatisfaction(
          toAnalyticsRangeRequest(query),
          metadata,
        ),
      context,
    );

    return {
      points: response.points.map((point) => ({
        day: point.day,
        csat: toRateDto(point.csat),
        citationAccuracy: toRateDto(point.citationAccuracy),
      })),
      csatTotal: toRateDto(response.csatTotal),
      citationAccuracyTotal: toRateDto(response.citationAccuracyTotal),
      dataThrough: response.dataThrough ?? null,
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
      byPurpose: response.byPurpose.map(toAiUsageSliceDto),
      byModel: response.byModel.map(toAiUsageSliceDto),
      totalCostMicros: response.totalCostMicros,
      totalGenerations: response.totalGenerations,
      monthlyBudgetMicros: response.monthlyBudgetMicros,
      aiModelTier: fromProtoAiModelTier(response.aiModelTier),
      draftAcceptance: toRateDto(response.draftAcceptance),
      emptyRetrievalRate: toRateDto(response.emptyRetrievalRate),
      computedAt: fromProtoTimestamp(response.computedAt) ?? null,
      dataThrough: response.dataThrough ?? null,
    };
  }

  // ------------------------------------------------------ 19-doc §5, export

  async createExport(
    dto: CreateExportDto,
    context: RequestContext,
  ): Promise<AnalyticsExportDto> {
    return toAnalyticsExportDto(
      await this.call(
        (metadata) =>
          this.analyticsService.createExport(
            { ...dto, kind: toProtoAnalyticsExportKind(dto.kind) },
            metadata,
          ),
        context,
      ),
    );
  }

  async getExport(
    id: string,
    context: RequestContext,
  ): Promise<AnalyticsExportDto> {
    return toAnalyticsExportDto(
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
  ): Promise<LegResult<T>> {
    try {
      return { value: await produce() };
    } catch (error) {
      const reason = formatErrorMsg(error);
      this.logger.warn(`Analytics leg '${source}' unavailable: ${reason}`);

      return { failure: { source, reason } };
    }
  }

  agentStats(
    query: AnalyticsRangeQueryDto,
    context: RequestContext,
  ): Promise<LegResult<AgentStatsResponse>> {
    return this.tryLeg('ticket-service', () =>
      this.call(
        (metadata) =>
          this.analyticsService.getAgentStats(
            toAnalyticsRangeRequest(query),
            metadata,
          ),
        context,
      ),
    );
  }

  ledgerUsage(
    query: AnalyticsRangeQueryDto,
    context: RequestContext,
  ): Promise<LegResult<AiUsageResponse>> {
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
  ): Promise<LegResult<KnowledgeGapsResponse>> {
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

  documentAnalytics(
    limit: number,
    context: RequestContext,
  ): Promise<LegResult<DocumentAnalyticsResponse>> {
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
  hydrateNames(
    userIds: string[],
    context: RequestContext,
  ): Promise<LegResult<ListUsersByIdsResponse>> {
    return this.tryLeg('auth-service', () =>
      this.call(
        (metadata) =>
          this.userService.listUsersByIds(
            {
              organizationId: context.organizationId ?? '',
              userIds,
              // **`true` here, unlike the notification caller** — 27-doc §3.
              // An agent-performance table naming everyone who handled a
              // ticket last quarter must still name the ones who have since
              // left; excluding them turns a leaderboard row into a blank.
              includeInactive: true,
              // The names only. This path renders a table and has no business
              // receiving an address it would then have to remember to drop.
              projection: UserProjection.USER_PROJECTION_SUMMARY,
            },
            metadata,
          ),
        context,
      ),
    );
  }
}
