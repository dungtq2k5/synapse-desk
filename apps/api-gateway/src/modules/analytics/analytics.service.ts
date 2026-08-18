import {
  toProtoAnalyticsExportKind,
  fromProtoDocumentFlagType,
} from '@synapsedesk/grpc-proto';
import {
  toAiUsageResponseDto,
  toAnalyticsExportResponseDto,
  toAnalyticsRangeRequest,
  toDeflectionResponseDto,
  toOverviewResponseDto,
  toResponseTimesResponseDto,
  toSatisfactionResponseDto,
  toVolumeResponseDto,
} from './analytics.mapper';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { AnalyticsCacheService } from './analytics-cache.service';
import { AnalyticsGrpcClient, LegFailure } from './analytics-grpc.client';
import {
  AnalyticsRangeQueryDto,
  AnalyticsTopNQueryDto,
  CreateExportDto,
  DocumentAnalyticsQueryDto,
} from './dto/rest/analytics.dto';
import {
  AgentAnalyticsResponseDto,
  AgentStatResponseDto,
  DocumentAnalyticsResponseDto,
  KnowledgeGapsResponseDto,
  UnavailableBlockResponseDto,
  AiUsageResponseDto,
  DeflectionResponseDto,
  OverviewResponseDto,
  ResponseTimesResponseDto,
  SatisfactionResponseDto,
  VolumeResponseDto,
  AnalyticsExportResponseDto,
} from './dto/rest/analytics-response.dto';

/**
 * The composition layer
 *
 * Two responsibilities and no third:
 *
 *   1. **Cache**, because these reads are expensive, tolerant of staleness and
 *      read repeatedly by a dashboard that polls.
 *   2. **Compose**, for the three endpoints that genuinely span services —
 *      calling the owning services in PARALLEL, joining in memory on a user or
 *      document id, and hydrating names.
 *
 * **A cross-service endpoint failing one leg returns the legs it has**, with
 * the missing block marked `unavailable`. A dashboard where nine tiles render
 * and one names the service that is down is far more useful than a 500 — and it
 * is what someone diagnosing an incident actually needs.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly client: AnalyticsGrpcClient,
    private readonly cache: AnalyticsCacheService,
  ) {}

  // ------------------------------------------- the six single-service reads

  overview(
    query: AnalyticsRangeQueryDto,
    context: RequestContext,
  ): Promise<OverviewResponseDto> {
    return this.cached('overview', query, context, () =>
      this.client
        .overview(toAnalyticsRangeRequest(query), context)
        .then(toOverviewResponseDto),
    );
  }

  deflection(
    query: AnalyticsRangeQueryDto,
    context: RequestContext,
  ): Promise<DeflectionResponseDto> {
    return this.cached('deflection', query, context, () =>
      this.client
        .deflection(toAnalyticsRangeRequest(query), context)
        .then(toDeflectionResponseDto),
    );
  }

  responseTimes(
    query: AnalyticsRangeQueryDto,
    context: RequestContext,
  ): Promise<ResponseTimesResponseDto> {
    return this.cached('response-times', query, context, () =>
      this.client
        .responseTimes(toAnalyticsRangeRequest(query), context)
        .then(toResponseTimesResponseDto),
    );
  }

  volume(
    query: AnalyticsRangeQueryDto,
    context: RequestContext,
  ): Promise<VolumeResponseDto> {
    return this.cached('volume', query, context, () =>
      this.client
        .volume(toAnalyticsRangeRequest(query), context)
        .then(toVolumeResponseDto),
    );
  }

  satisfaction(
    query: AnalyticsRangeQueryDto,
    context: RequestContext,
  ): Promise<SatisfactionResponseDto> {
    return this.cached('satisfaction', query, context, () =>
      this.client
        .satisfaction(toAnalyticsRangeRequest(query), context)
        .then(toSatisfactionResponseDto),
    );
  }

  aiUsage(
    query: AnalyticsRangeQueryDto,
    context: RequestContext,
  ): Promise<AiUsageResponseDto> {
    return this.cached('ai-usage', query, context, () =>
      this.client
        .aiUsage(
          { from: query.from, to: query.to, granularity: query.granularity },
          context,
        )
        .then(toAiUsageResponseDto),
    );
  }

  // -------------------------------------------- the three cross-service ones

  /**
   * Per-agent productivity — ticket-service ∪ ingestion-service ∪ names.
   *
   * Three legs, all in PARALLEL, joined on agent id. The join is in memory
   * because the cardinality is tens-to-hundreds of agents per tenant: a
   * distributed query would be a bigger machine for a `Map.get`.
   *
   * **Draft acceptance is tenant-wide rather than per agent**, and that is a
   * limitation stated rather than hidden: `ai_generations` records the user who
   * triggered a generation, but the daily rollup groups by (purpose, model)
   * only. Per-agent acceptance would need a fourth dimension on a table that
   * already multiplies by two — and the rollup shape does not include
   * it. Every row carries the same figure, which is honest about what it is.
   */
  async agents(
    query: AnalyticsRangeQueryDto,
    context: RequestContext,
    /**
     * **`false` skips the name-hydration leg entirely**.
     *
     * GraphQL passes it, because there the hydration IS the users loader:
     * `AgentStat.agent` resolves through the same `ListUsersByIds` this leg
     * calls, batched with every other user on the request, and only when a
     * client actually asks for it. Hydrating here as well would make the
     * numbers-only query — which is most of them — pay for a round trip whose
     * result nothing reads.
     *
     * **The cache key changes with it.** An un-hydrated result stored under the
     * plain `agents` key would be served to the REST route next, which would
     * then return `fullName: null` for every agent with nothing failing and no
     * leg marked unavailable.
     */
    options: { hydrateNames?: boolean } = {},
  ): Promise<AgentAnalyticsResponseDto> {
    const hydrateNames = options.hydrateNames ?? true;

    return this.cached(
      hydrateNames ? 'agents' : 'agents:no-names',
      query,
      context,
      async () => {
        const unavailable: UnavailableBlockResponseDto[] = [];

        const [statsLeg, usageLeg] = await Promise.all([
          this.client.agentStats(query, context),
          this.client.ledgerUsage(query, context),
        ]);

        const stats = unwrap(statsLeg, unavailable);
        const usage = unwrap(usageLeg, unavailable);

        const items: AgentStatResponseDto[] = (stats?.items ?? []).map(
          (row) => ({
            agentId: row.agentId,
            fullName: null,
            assigned: row.assigned,
            resolved: row.resolved,
            messagesSent: row.messagesSent,
            resolutionSeconds: {
              mean: row.resolutionSeconds?.mean ?? null,
              count: row.resolutionSeconds?.count ?? 0,
            },
            draftAcceptance: usage
              ? {
                  rate: usage.draftAcceptance?.rate ?? null,
                  numerator: usage.draftAcceptance?.numerator ?? 0,
                  denominator: usage.draftAcceptance?.denominator ?? 0,
                }
              : null,
          }),
        );

        // Hydration LAST and only if there is anything to hydrate: an empty
        // agent list must not cost a round trip to auth-service, and a name is
        // decoration — its absence marks the block unavailable without emptying
        // the numbers, which are the part somebody is actually reading.
        if (hydrateNames && items.length > 0) {
          const namesLeg = await this.client.hydrateNames(
            items.map((item) => item.agentId),
            context,
          );
          const names = unwrap(namesLeg, unavailable);

          if (names) {
            // `summaries`, not `items`. The request now asks for the
            // SUMMARY projection, so the notification-shaped `items` is empty and
            // reading it would leave every name null with nothing failing.
            const byId = new Map(
              names.summaries.map((user) => [user.userId, user.fullName]),
            );
            for (const item of items) {
              item.fullName = byId.get(item.agentId) ?? null;
            }
          }
        }

        return {
          items,
          // The STALEST of the two legs. `agent_daily_stats` and
          // `ai_generation_daily_stats` are written by two schedulers in two
          // services, so one can be days behind the other — and reporting the
          // fresher would let the healthy one vouch for the broken one.
          dataThrough: stalest(stats?.dataThrough, usage?.dataThrough),
          unavailable,
        };
      },
    );
  }

  /**
   * The content backlog — the empty-retrieval rate plus the document flags.
   *
   * One service answers both today, which makes this the cheapest of the three
   * — but it is composed the same way, because the flags and the rate are two
   * findings and a future split would otherwise be a rewrite.
   */
  async knowledgeGaps(
    query: AnalyticsTopNQueryDto,
    context: RequestContext,
  ): Promise<KnowledgeGapsResponseDto> {
    return this.cached('knowledge-gaps', query, context, async () => {
      const unavailable: UnavailableBlockResponseDto[] = [];
      const leg = await this.client.knowledgeGaps(
        { from: query.from, to: query.to, limit: query.limit },
        context,
      );
      const gaps = unwrap(leg, unavailable);

      return {
        emptyRetrievals: gaps?.emptyRetrievals ?? 0,
        answeringGenerations: gaps?.answeringGenerations ?? 0,
        emptyRetrievalRate: {
          rate: gaps?.emptyRetrievalRate?.rate ?? null,
          numerator: gaps?.emptyRetrievalRate?.numerator ?? 0,
          denominator: gaps?.emptyRetrievalRate?.denominator ?? 0,
        },
        // Mapped rather than passed through: `flags` is the raw wire shape,
        // and its `flagType` is a numeric proto enum that would otherwise reach
        // a JSON response as an integer.
        flags: (gaps?.flags ?? []).map((flag) => ({
          ...flag,
          flagType: fromProtoDocumentFlagType(flag.flagType),
        })),
        dataThrough: gaps?.dataThrough ?? null,
        unavailable,
      };
    });
  }

  /**
   * Corpus health — chunk counters from ingestion-service, citation accuracy
   * from ticket-service's feedback rollup.
   *
   * The one endpoint whose two legs come from genuinely different domains, and
   * the reason the partial-failure shape earns its place: a Knowledge Manager
   * looking at "which documents are never cited" is not helped by a 500 because
   * the CSAT service is restarting.
   */
  async documents(
    query: DocumentAnalyticsQueryDto,
    context: RequestContext,
  ): Promise<DocumentAnalyticsResponseDto> {
    return this.cached(
      'documents',
      { limit: query.limit },
      context,
      async () => {
        const unavailable: UnavailableBlockResponseDto[] = [];

        const [documentsLeg, satisfactionLeg] = await Promise.all([
          this.client.documentAnalytics(query.limit, context),
          // Citation accuracy is a ticket-side metric — it comes from feedback on
          // messages. A wide range so the figure means something: accuracy over
          // three days of ratings is a number nobody should act on.
          this.client.tryLeg('ticket-service', () =>
            this.client
              .satisfaction(toAnalyticsRangeRequest(lastYear()), context)
              .then(toSatisfactionResponseDto),
          ),
        ]);

        const documents = unwrap(documentsLeg, unavailable);
        const satisfaction = unwrap(satisfactionLeg, unavailable);

        return {
          mostCited: documents?.mostCited ?? [],
          neverRetrieved: documents?.neverRetrieved ?? [],
          retrievedNeverCited: documents?.retrievedNeverCited ?? [],
          citationAccuracy: satisfaction
            ? satisfaction.citationAccuracyTotal
            : null,
          dataThrough: stalest(
            documents?.dataThrough,
            satisfaction?.dataThrough,
          ),
          unavailable,
        };
      },
    );
  }

  // ------------------------------------------------------ export

  /**
   * Deliberately NOT cached.
   *
   * Creating a job is a write, and polling one is a question whose answer
   * changes on a timescale of seconds — a cached PENDING would be a spinner
   * that never resolves, which is the one failure a progress indicator must not
   * have.
   */
  async createExport(
    dto: CreateExportDto,
    context: RequestContext,
  ): Promise<AnalyticsExportResponseDto> {
    return toAnalyticsExportResponseDto(
      await this.client.createExport(
        { ...dto, kind: toProtoAnalyticsExportKind(dto.kind) },
        context,
      ),
    );
  }

  async getExport(
    id: string,
    context: RequestContext,
  ): Promise<AnalyticsExportResponseDto> {
    return toAnalyticsExportResponseDto(
      await this.client.getExport(id, context),
    );
  }

  /**
   * Read-through, keyed and TTL'd by range.
   *
   * The `computedAt` freshness segment is deliberately NOT read here: it would
   * need the answer to build the key for the answer. Closed ranges instead get
   * a long TTL bounded by a backfill's explicit invalidation, which is the same
   * guarantee arrived at from the other direction.
   */
  private cached<T>(
    endpoint: string,
    // `object` rather than `Record<string, unknown>`: a class DTO has no string
    // index signature, and requiring one at every call site would mean casting
    // the very shape the validation pipe just produced.
    params: object,
    context: RequestContext,
    produce: () => Promise<T>,
  ): Promise<T> {
    const to = 'to' in params && typeof params.to === 'string' ? params.to : '';

    return this.cache.wrap(
      {
        // The tenant id is the first segment of the key, so a cross-tenant hit
        // is unreachable rather than merely unlikely.
        organizationId: context.organizationId ?? 'no-tenant',
        endpoint,
        params: { ...params },
      },
      this.cache.ttlSecondsFor(to),
      produce,
    );
  }
}

/**
 * A leg's value, or null with the failure recorded.
 *
 * The shape that makes partial failure the DEFAULT rather than something each
 * endpoint has to remember: a caller that forgets to check gets `null` and an
 * empty list, not an exception that escapes to a 500.
 */
function unwrap<T>(
  leg: { value: T } | { failure: LegFailure },
  unavailable: UnavailableBlockResponseDto[],
): T | null {
  if ('value' in leg) return leg.value;

  unavailable.push(leg.failure);

  return null;
}

/**
 * The OLDEST `dataThrough` among the legs.
 *
 * A composed answer is only as fresh as its stalest input. Reporting the
 * freshest would let a healthy service vouch for a broken one, which is the
 * exact failure `dataThrough` exists to expose.
 *
 * A leg that is absent because it FAILED contributes nothing rather than
 * `null`: its block is already listed in `unavailable`, and letting a failed
 * leg force the whole answer to "never rolled up" would confuse a service being
 * down with a job never having run. They need different responses.
 *
 * `YYYY-MM-DD` sorts lexicographically, so no date parsing is needed — and
 * comparing strings avoids inventing a timezone the days do not have.
 */
function stalest(...days: (string | null | undefined)[]): string | null {
  const present = days.filter((day): day is string => Boolean(day));

  if (present.length === 0) return null;

  return present.reduce(
    (oldest, day) => (day < oldest ? day : oldest),
    present[0],
  );
}

/** The trailing year, for a rate that needs volume to mean anything. */
function lastYear(): AnalyticsRangeQueryDto {
  const to = new Date();
  const from = new Date(to);
  from.setUTCFullYear(from.getUTCFullYear() - 1);

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}
