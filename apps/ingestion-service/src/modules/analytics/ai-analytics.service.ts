import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  addAiStats,
  AiStatSums,
  AnalyticsGranularity,
  CallerContext,
  DocumentFlagType,
  ANALYTICS_TOP_N,
  draftAcceptanceRate,
  EMPTY_AI_STATS,
  emptyRetrievalRate,
  failureRate,
  MAX_ANALYTICS_RANGE_DAYS,
  Mean,
  meanLatencyMs,
  Rate,
  requireTenant,
} from '@synapsedesk/common';
import {
  AiUsageRequest,
  AiUsageResponse,
  DocumentAnalyticsRequest,
  DocumentAnalyticsResponse,
  KnowledgeGapsRequest,
  KnowledgeGapsResponse,
  AiMeanValue,
  AiRateValue,
  toTimestamp,
} from '@synapsedesk/grpc-proto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthReferenceService } from '../auth-client/auth-reference.service';

/** The purposes that ANSWER a question — the only ones an empty retrieval means anything for. */
const ANSWERING_PURPOSES = new Set(['CHAT_ANSWER', 'DRAFT']);

/** A rollup row with its dimensions. */
type AiDailyRow = AiStatSums & {
  day: Date;
  purpose: string;
  modelName: string;
  computedAt: Date;
};

/**
 * AI spend and corpus health — 19-doc §3.2.
 *
 * **Reads `ai_generation_daily_stats`, never `ai_generations`.** That table is
 * retention-rolled (RDM Table 29): raw rows aggregate away after ~90 days, so a
 * query against them would report a shrinking spend for a tenant whose usage is
 * flat, and no error anywhere.
 *
 * The two document endpoints are the exception and read `document_chunks`
 * counters directly — those are a PROJECTION maintained by
 * `ChunkUsageProjection` for exactly this reason (12-doc §4.1), so they survive
 * retention too.
 */
@Injectable()
export class AiAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authReference: AuthReferenceService,
  ) {}

  async getAiUsage(
    request: AiUsageRequest,
    context: CallerContext,
  ): Promise<AiUsageResponse> {
    const organizationId = requireTenant(context);
    const range = parseRange(request.from, request.to);

    const [rows, entitlement, tier] = await Promise.all([
      this.dailyRows(organizationId, range),
      // The budget the spend is measured AGAINST, fetched here so a caller does
      // not need a second round trip to render a progress bar. A number with no
      // ceiling beside it is one nobody can act on.
      this.authReference.getAiEntitlement(context),
      this.authReference.getAiModelTier(context),
    ]);

    const totals = sumAll(rows);

    return {
      points: [...bucketByDay(rows, granularityOf(request.granularity))].map(
        ([day, stats]) => ({
          day,
          generations: stats.generations,
          costMicros: stats.costMicros,
        }),
      ),
      // **The per-purpose split is the point** (19-doc §3.2): it shows a tenant
      // where the budget actually goes, which is rarely where they assume —
      // embeddings and review passes are usually the surprise.
      byPurpose: slice(
        rows,
        (row) => row.purpose,
        (row) => ({
          purpose: row.purpose,
          modelName: '',
        }),
      ),
      byModel: slice(
        rows,
        (row) => row.modelName,
        (row) => ({
          purpose: '',
          modelName: row.modelName,
        }),
      ),
      totalCostMicros: totals.costMicros,
      totalGenerations: totals.generations,
      monthlyBudgetMicros: Number(entitlement.budgetMicros),
      aiModelTier: tier,
      draftAcceptance: toRate(draftAcceptanceRate(totals)),
      emptyRetrievalRate: toRate(
        emptyRetrievalRate(sumAll(answeringOnly(rows))),
      ),
      computedAt: latestComputedAt(rows),
    };
  }

  /**
   * The content backlog — 19-doc §3.2.
   *
   * Two signals that answer different questions and are useless apart: the
   * empty-retrieval RATE says how often the corpus had nothing, and the
   * document flags say which documents are the problem.
   */
  async getKnowledgeGaps(
    request: KnowledgeGapsRequest,
    context: CallerContext,
  ): Promise<KnowledgeGapsResponse> {
    const organizationId = requireTenant(context);
    const range = parseRange(request.from, request.to);

    const rows = answeringOnly(await this.dailyRows(organizationId, range));
    const totals = sumAll(rows);

    const flags = await this.prisma.documentFlag.findMany({
      where: {
        organizationId,
        resolvedAt: null,
        // The two flags that mean "the corpus is not answering". `OUTDATED` and
        // `DUPLICATE` are corpus HYGIENE, which is a different backlog and
        // would bury these under noise.
        flagType: {
          in: [DocumentFlagType.UNRETRIEVED, DocumentFlagType.UNCITED],
        },
        document: { deletedAt: null },
      },
      include: { document: { select: { title: true } } },
      orderBy: { detectedAt: 'desc' },
      take: clampLimit(request.limit),
    });

    return {
      emptyRetrievals: totals.emptyRetrievals,
      answeringGenerations: totals.generations,
      emptyRetrievalRate: toRate(emptyRetrievalRate(totals)),
      flags: flags.map((flag) => ({
        documentId: flag.documentId,
        documentTitle: flag.document.title,
        flagType: flag.flagType,
        detail: flag.detail,
      })),
    };
  }

  /**
   * Corpus health from the chunk counters — 19-doc §3.2.
   *
   * **`UNRETRIEVED` and `UNCITED` are DIFFERENT findings** (RDM Table 27) and
   * are returned as separate lists. A document nobody's question came near may
   * simply be mis-titled; one retrieved twenty times and cited never is
   * actively displacing the sources that would have answered. Folding them into
   * one "unused" list is how the second, worse problem hides inside the first.
   *
   * No date range: these are lifetime counters on the chunk rows, and a
   * "documents never retrieved in March" list would flag every document written
   * in April.
   */
  async getDocumentAnalytics(
    request: DocumentAnalyticsRequest,
    context: CallerContext,
  ): Promise<DocumentAnalyticsResponse> {
    const organizationId = requireTenant(context);
    const limit = clampLimit(request.limit);

    const rows = await this.prisma.$queryRawUnsafe<
      {
        document_id: string;
        title: string;
        retrieval_count: number;
        citation_count: number;
        chunk_count: number;
      }[]
    >(
      `
      SELECT d.id AS document_id,
             d.title,
             COALESCE(SUM(c.retrieval_count), 0)::int AS retrieval_count,
             COALESCE(SUM(c.citation_count), 0)::int AS citation_count,
             COUNT(c.id)::int AS chunk_count
      FROM documents d
      LEFT JOIN document_chunks c
        ON c.document_id = d.id AND c.is_deleted = false
      WHERE d.organization_id = $1::uuid AND d.deleted_at IS NULL
      GROUP BY d.id, d.title
      `,
      organizationId,
    );

    const documents = rows.map((row) => ({
      documentId: row.document_id,
      title: row.title,
      retrievalCount: row.retrieval_count,
      citationCount: row.citation_count,
      chunkCount: row.chunk_count,
    }));

    return {
      mostCited: [...documents]
        .filter((document) => document.citationCount > 0)
        .sort((left, right) => right.citationCount - left.citationCount)
        .slice(0, limit),
      neverRetrieved: documents
        .filter((document) => document.retrievalCount === 0)
        .slice(0, limit),
      retrievedNeverCited: documents
        .filter(
          (document) =>
            document.retrievalCount > 0 && document.citationCount === 0,
        )
        .sort((left, right) => right.retrievalCount - left.retrievalCount)
        .slice(0, limit),
    };
  }

  private async dailyRows(
    organizationId: string,
    range: { from: Date; to: Date },
  ): Promise<AiDailyRow[]> {
    const rows = await this.prisma.aiGenerationDailyStat.findMany({
      where: { organizationId, day: { gte: range.from, lte: range.to } },
      orderBy: { day: 'asc' },
    });

    return rows.map((row) => ({
      day: row.day,
      purpose: row.purpose,
      modelName: row.modelName,
      computedAt: row.computedAt,
      generations: row.generations,
      // BigInt on the way out of Postgres and Number here: the wire carries
      // int64, and a tenant's quarterly micros stay far inside the 53-bit
      // range a double represents exactly.
      promptTokens: Number(row.promptTokens),
      completionTokens: Number(row.completionTokens),
      costMicros: Number(row.costMicros),
      latencyMsSum: Number(row.latencyMsSum),
      latencyCount: row.latencyCount,
      failures: row.failures,
      emptyRetrievals: row.emptyRetrievals,
      draftsAccepted: row.draftsAccepted,
      draftsEdited: row.draftsEdited,
      draftsDiscarded: row.draftsDiscarded,
    }));
  }
}

/**
 * Empty retrievals only mean something for a purpose that ANSWERS.
 *
 * An embedding retrieves nothing by definition, and a classification retrieves
 * nothing on purpose — counting them would make the knowledge-gap rate track
 * ingestion volume rather than corpus coverage.
 */
function answeringOnly(rows: AiDailyRow[]): AiDailyRow[] {
  return rows.filter((row) => ANSWERING_PURPOSES.has(row.purpose));
}

function sumAll(rows: AiStatSums[]): AiStatSums {
  return rows.reduce((total, row) => addAiStats(total, row), EMPTY_AI_STATS);
}

/** Groups by one dimension, summing counters — never averaging rates. */
function slice(
  rows: AiDailyRow[],
  keyOf: (row: AiDailyRow) => string,
  labelOf: (row: AiDailyRow) => { purpose: string; modelName: string },
) {
  const grouped = new Map<
    string,
    { label: { purpose: string; modelName: string }; stats: AiStatSums }
  >();

  for (const row of rows) {
    const key = keyOf(row);
    const existing = grouped.get(key);

    grouped.set(key, {
      label: existing?.label ?? labelOf(row),
      stats: addAiStats(existing?.stats ?? EMPTY_AI_STATS, row),
    });
  }

  return (
    [...grouped.values()]
      .map(({ label, stats }) => ({
        ...label,
        generations: stats.generations,
        promptTokens: stats.promptTokens,
        completionTokens: stats.completionTokens,
        costMicros: stats.costMicros,
        latencyMs: toMean(meanLatencyMs(stats)),
        failureRate: toRate(failureRate(stats)),
      }))
      // Most expensive first: the question this answers is "where does the money
      // go", and an alphabetical list makes the reader find that out themselves.
      .sort((left, right) => right.costMicros - left.costMicros)
  );
}

function bucketByDay(
  rows: AiDailyRow[],
  granularity: AnalyticsGranularity,
): Map<string, AiStatSums> {
  const buckets = new Map<string, AiStatSums>();

  for (const row of rows) {
    const key = bucketKey(row.day, granularity);
    buckets.set(key, addAiStats(buckets.get(key) ?? EMPTY_AI_STATS, row));
  }

  return buckets;
}

function bucketKey(day: Date, granularity: AnalyticsGranularity): string {
  const iso = day.toISOString().slice(0, 10);

  if (granularity === AnalyticsGranularity.DAY) return iso;
  if (granularity === AnalyticsGranularity.MONTH)
    return `${iso.slice(0, 7)}-01`;

  const monday = new Date(day);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));

  return monday.toISOString().slice(0, 10);
}

function granularityOf(value: string | undefined): AnalyticsGranularity {
  const granularity = value as AnalyticsGranularity | undefined;

  return granularity &&
    Object.values(AnalyticsGranularity).includes(granularity)
    ? granularity
    : AnalyticsGranularity.DAY;
}

function parseRange(from: string, to: string): { from: Date; to: Date } {
  const start = parseDay(from, 'from');
  const end = parseDay(to, 'to');

  if (start > end) {
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: '`from` must not be after `to`',
    });
  }

  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days > MAX_ANALYTICS_RANGE_DAYS) {
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: `Range is ${days} days; the maximum is ${MAX_ANALYTICS_RANGE_DAYS}`,
    });
  }

  return { from: start, to: end };
}

function parseDay(value: string, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) {
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: `\`${field}\` must be a YYYY-MM-DD date`,
    });
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: `\`${field}\` is not a real date`,
    });
  }

  return parsed;
}

/**
 * Bounded, and defaulted when a client sends 0 — proto3 has no "absent" int.
 *
 * The bounds come from `ANALYTICS_TOP_N` rather than being written here, so
 * this and the two gateway DTOs cannot disagree. This is the copy that matters:
 * the gateway validates before its own calls, but this method is reachable from
 * any service over gRPC, where nothing validated anything.
 */
function clampLimit(limit: number | undefined): number {
  if (!limit || limit <= 0) return ANALYTICS_TOP_N.DEFAULT;

  return Math.min(limit, ANALYTICS_TOP_N.MAX);
}

function latestComputedAt(rows: AiDailyRow[]) {
  if (rows.length === 0) return undefined;

  return toTimestamp(
    rows.reduce(
      (latest, row) => (row.computedAt > latest ? row.computedAt : latest),
      rows[0].computedAt,
    ),
  );
}

function toRate(value: Rate): AiRateValue {
  return {
    rate: value.rate ?? undefined,
    numerator: value.numerator,
    denominator: value.denominator,
  };
}

function toMean(value: Mean): AiMeanValue {
  return { mean: value.mean ?? undefined, count: value.count };
}
