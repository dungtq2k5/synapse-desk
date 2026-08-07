import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  addTicketStats,
  AnalyticsGranularity,
  CallerContext,
  citationAccuracy,
  csat,
  deflectionRate,
  aiFirstResponseSeconds,
  EMPTY_TICKET_STATS,
  humanFirstResponseSeconds,
  MAX_ANALYTICS_RANGE_DAYS,
  Mean,
  Rate,
  requireTenant,
  resolutionSeconds,
  TicketStatSums,
  TicketStatus,
} from '@synapsedesk/common';
import {
  AgentStatsResponse,
  AnalyticsRangeRequest,
  DeflectionResponse,
  MeanValue,
  OverviewResponse,
  RateValue,
  ResponseTimesResponse,
  SatisfactionResponse,
  toTimestamp,
  VolumeResponse,
} from '@synapsedesk/grpc-proto';
import { PrismaService } from '../prisma/prisma.service';

/** A rollup row plus the day it belongs to. */
type DailyRow = TicketStatSums & { day: Date; computedAt: Date };

/**
 * The six single-service analytics endpoints — 19-doc §3.2.
 *
 * **Every query reads `ticket_daily_stats`, never `tickets`.** That is the
 * whole point of §2: an aggregation over a quarter of tickets, on the table
 * serving ticket creation, is a Monday-morning dashboard competing with the hot
 * path. The two deliberate exceptions are marked where they occur — both answer
 * "right now", which a rollup of daily events structurally cannot.
 *
 * **No metric is computed here.** Every rate and mean comes from
 * `analytics.config`, so the gateway, an export and this service cannot arrive
 * at three different deflection rates. Step 2 of the doc's build order is that
 * file; this one only decides which rows to feed it.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(
    request: AnalyticsRangeRequest,
    context: CallerContext,
  ): Promise<OverviewResponse> {
    const organizationId = requireTenant(context);
    const range = parseRange(request);

    const [rows, openTickets, openMedianAge, dataThrough] = await Promise.all([
      this.dailyRows(organizationId, request, range),
      this.openTicketCount(organizationId, request),
      this.openTicketMedianAgeSeconds(organizationId, request),
      this.dataThrough(organizationId),
    ]);

    const totals = rows.reduce(
      (accumulator, row) => addTicketStats(accumulator, row),
      EMPTY_TICKET_STATS,
    );

    return {
      ticketsCreated: totals.ticketsCreated,
      ticketsResolved: totals.ticketsResolved,
      ticketsEscalated: totals.ticketsEscalated,
      openTickets,
      deflection: toRate(deflectionRate(totals)),
      csat: toRate(csat(totals)),
      humanFirstResponseSeconds: toMean(humanFirstResponseSeconds(totals)),
      aiFirstResponseSeconds: toMean(aiFirstResponseSeconds(totals)),
      resolutionSeconds: toMean(resolutionSeconds(totals)),
      // The counterweight. `resolution_seconds` can only see tickets that
      // closed, so it is biased optimistic — a ticket open for 40 days is
      // invisible to it, and reporting the mean alone would let a queue rot
      // while the headline improved.
      openTicketMedianAgeSeconds: openMedianAge ?? undefined,
      // Absent for a tenant with no rows, which is how a caller tells "quiet"
      // from "the job has not run".
      computedAt: latestComputedAt(rows),
      dataThrough,
    };
  }

  async getDeflection(
    request: AnalyticsRangeRequest,
    context: CallerContext,
  ): Promise<DeflectionResponse> {
    const organizationId = requireTenant(context);
    const [rows, dataThrough] = await Promise.all([
      this.dailyRows(organizationId, request, parseRange(request)),
      this.dataThrough(organizationId),
    ]);
    const buckets = bucketBy(rows, granularityOf(request));

    return {
      points: [...buckets].map(([day, stats]) => ({
        day,
        deflection: toRate(deflectionRate(stats)),
        chatConversations: stats.chatConversations,
        chatResolvedWithoutEscalation: stats.chatResolvedWithoutEscalation,
      })),
      // The total is computed from the SUMMED counters, not averaged from the
      // points. An average of daily rates weights a Tuesday with 3
      // conversations equally with a Monday with 300 — the same mistake the
      // rollup schema exists to prevent, arriving one layer up.
      total: toRate(deflectionRate(sumAll(rows))),
      dataThrough,
    };
  }

  async getResponseTimes(
    request: AnalyticsRangeRequest,
    context: CallerContext,
  ): Promise<ResponseTimesResponse> {
    const organizationId = requireTenant(context);
    const [rows, dataThrough] = await Promise.all([
      this.dailyRows(organizationId, request, parseRange(request)),
      this.dataThrough(organizationId),
    ]);
    const buckets = bucketBy(rows, granularityOf(request));
    const totals = sumAll(rows);

    return {
      points: [...buckets].map(([day, stats]) => ({
        day,
        humanFirstResponseSeconds: toMean(humanFirstResponseSeconds(stats)),
        aiFirstResponseSeconds: toMean(aiFirstResponseSeconds(stats)),
        resolutionSeconds: toMean(resolutionSeconds(stats)),
      })),
      humanTotal: toMean(humanFirstResponseSeconds(totals)),
      aiTotal: toMean(aiFirstResponseSeconds(totals)),
      resolutionTotal: toMean(resolutionSeconds(totals)),
      dataThrough,
    };
  }

  async getVolume(
    request: AnalyticsRangeRequest,
    context: CallerContext,
  ): Promise<VolumeResponse> {
    const organizationId = requireTenant(context);
    const [rows, dataThrough] = await Promise.all([
      this.dailyRows(organizationId, request, parseRange(request)),
      this.dataThrough(organizationId),
    ]);
    const buckets = bucketBy(rows, granularityOf(request));

    // **The one place this reads `tickets` rather than the rollup**, and it is
    // deliberate: "how many are OPEN right now" is not a question a daily
    // rollup of events can answer. A rollup could only report the status a
    // ticket had on the day it was created, which is a different number
    // wearing the same label.
    const breakdowns = await this.currentBreakdowns(organizationId, request);

    return {
      points: [...buckets].map(([day, stats]) => ({
        day,
        created: stats.ticketsCreated,
        resolved: stats.ticketsResolved,
        escalated: stats.ticketsEscalated,
      })),
      ...breakdowns,
      dataThrough,
    };
  }

  async getSatisfaction(
    request: AnalyticsRangeRequest,
    context: CallerContext,
  ): Promise<SatisfactionResponse> {
    const organizationId = requireTenant(context);
    const [rows, dataThrough] = await Promise.all([
      this.dailyRows(organizationId, request, parseRange(request)),
      this.dataThrough(organizationId),
    ]);
    const buckets = bucketBy(rows, granularityOf(request));
    const totals = sumAll(rows);

    return {
      points: [...buckets].map(([day, stats]) => ({
        day,
        csat: toRate(csat(stats)),
        citationAccuracy: toRate(citationAccuracy(stats)),
      })),
      csatTotal: toRate(csat(totals)),
      citationAccuracyTotal: toRate(citationAccuracy(totals)),
      dataThrough,
    };
  }

  /**
   * Per-agent productivity, from `agent_daily_stats`.
   *
   * Returns AGENT IDS and no names: `users` lives in postgres_auth and this
   * service has never known a display name. The gateway hydrates them, which is
   * the same cross-service reference pattern everything else uses (RDM §1.13)
   * — auth-service is a name source here, not an analytics source.
   */
  async getAgentStats(
    request: AnalyticsRangeRequest,
    context: CallerContext,
  ): Promise<AgentStatsResponse> {
    const organizationId = requireTenant(context);
    const range = parseRange(request);

    const [grouped, dataThrough] = await Promise.all([
      this.prisma.agentDailyStat.groupBy({
        by: ['agentId'],
        where: {
          organizationId,
          day: { gte: range.from, lte: range.to },
        },
        _sum: {
          assigned: true,
          resolved: true,
          messagesSent: true,
          resolutionSecondsSum: true,
          resolutionCount: true,
        },
      }),
      this.dataThrough(organizationId, 'agentDailyStat'),
    ]);

    return {
      items: grouped.map((row) => ({
        agentId: row.agentId,
        assigned: row._sum.assigned ?? 0,
        resolved: row._sum.resolved ?? 0,
        messagesSent: row._sum.messagesSent ?? 0,
        resolutionSeconds: toMean({
          mean:
            (row._sum.resolutionCount ?? 0) > 0
              ? (row._sum.resolutionSecondsSum ?? 0) /
                (row._sum.resolutionCount ?? 1)
              : null,
          count: row._sum.resolutionCount ?? 0,
        }),
      })),
      dataThrough,
    };
  }

  /**
   * **The last day the rollups cover for this tenant** — 20-doc §4.3.
   *
   * The cheapest thing in this file and the most valuable: a dashboard showing
   * zeros beside *"data through 12 Aug"* diagnoses itself, where the same
   * dashboard showing only zeros looks like a quiet tenant. That distinction is
   * exactly what nobody could make when the rollup jobs turned out to have no
   * scheduler at all — every endpoint answered correctly, and every answer was
   * zero.
   *
   * **Deliberately NOT clipped to the requested range.** "How fresh is our
   * data" must not change its answer because the caller asked about March. A
   * range-clipped version would report `2026-03-31` for a March query and hide
   * that nothing has been rolled up since.
   *
   * `null` for a tenant with no rows at all, which a caller must render as
   * "never" rather than as today.
   *
   * **The known limitation, accepted deliberately.** This is the last day with
   * a ROW, and the job writes a row only for days that had activity — so a
   * tenant with no tickets since Tuesday reports Tuesday however healthy the
   * scheduler is. It answers "what period does this dashboard cover", which is
   * near to but not the same as "is the job running".
   *
   * Kept because it fails in the SAFE direction. A false "your data looks old"
   * costs somebody a glance at the job status; the inverse — a dead scheduler
   * reporting today because it ran and found nothing — is the exact failure
   * 20-doc exists about. "Is it running" is answered separately by the
   * heartbeat table (§4.1), on `/platform/metrics`, where it belongs.
   */
  private async dataThrough(
    organizationId: string,
    table: 'ticketDailyStat' | 'agentDailyStat' = 'ticketDailyStat',
  ): Promise<string | undefined> {
    // `MAX(day)` on the leading column of the primary key — an index-only scan,
    // not a table scan, which is why this can sit on every endpoint.
    const newest =
      table === 'agentDailyStat'
        ? await this.prisma.agentDailyStat.findFirst({
            where: { organizationId },
            orderBy: { day: 'desc' },
            select: { day: true },
          })
        : await this.prisma.ticketDailyStat.findFirst({
            where: { organizationId },
            orderBy: { day: 'desc' },
            select: { day: true },
          });

    return newest ? toIsoDay(newest.day) : undefined;
  }

  /**
   * The rollup rows for a range.
   *
   * `departmentId` absent means EVERY department, including tickets with none —
   * so the filter is applied only when asked for. Defaulting it to "no
   * department" would make the unfiltered dashboard silently exclude every
   * assigned ticket.
   */
  private async dailyRows(
    organizationId: string,
    request: AnalyticsRangeRequest,
    range: { from: Date; to: Date },
  ): Promise<DailyRow[]> {
    const rows = await this.prisma.ticketDailyStat.findMany({
      where: {
        organizationId,
        day: { gte: range.from, lte: range.to },
        ...(request.departmentId ? { departmentId: request.departmentId } : {}),
      },
      orderBy: { day: 'asc' },
    });

    return rows.map((row) => ({
      day: row.day,
      computedAt: row.computedAt,
      ticketsCreated: row.ticketsCreated,
      ticketsResolved: row.ticketsResolved,
      ticketsEscalated: row.ticketsEscalated,
      chatConversations: row.chatConversations,
      chatResolvedWithoutEscalation: row.chatResolvedWithoutEscalation,
      firstResponseSecondsSum: row.firstResponseSecondsSum,
      firstResponseCount: row.firstResponseCount,
      aiFirstResponseSecondsSum: row.aiFirstResponseSecondsSum,
      aiFirstResponseCount: row.aiFirstResponseCount,
      resolutionSecondsSum: row.resolutionSecondsSum,
      resolutionCount: row.resolutionCount,
      feedbackPositive: row.feedbackPositive,
      feedbackNegative: row.feedbackNegative,
      citationAccurateCount: row.citationAccurateCount,
      citationRatedCount: row.citationRatedCount,
    }));
  }

  /** Live, not rolled up — see `getVolume`. */
  private async openTicketCount(
    organizationId: string,
    request: AnalyticsRangeRequest,
  ): Promise<number> {
    return this.prisma.ticket.count({
      where: {
        organizationId,
        deletedAt: null,
        status: { notIn: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
        ...(request.departmentId
          ? { currentDepartmentId: request.departmentId }
          : {}),
      },
    });
  }

  /**
   * The median age of what is still open — the honest counterweight.
   *
   * MEDIAN rather than mean, because the distribution is long-tailed: one
   * ticket open since March drags a mean past every number a reader would
   * believe, and then the figure gets ignored. Computed in SQL because
   * `percentile_cont` is not expressible in Prisma and pulling every open
   * ticket into memory to sort it would defeat the point of the rollups.
   */
  private async openTicketMedianAgeSeconds(
    organizationId: string,
    request: AnalyticsRangeRequest,
  ): Promise<number | null> {
    const rows = await this.prisma.$queryRawUnsafe<{ median: number | null }[]>(
      `
      SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (NOW() - created_at))
             )::bigint AS median
      FROM tickets
      WHERE organization_id = $1::uuid
        AND deleted_at IS NULL
        AND status NOT IN ('RESOLVED', 'CLOSED')
        AND ($2::uuid IS NULL OR current_department_id = $2::uuid)
      `,
      organizationId,
      request.departmentId ?? null,
    );

    const median = rows[0]?.median;

    return median === null || median === undefined ? null : Number(median);
  }

  /** Current status/priority/source counts — live, for the same reason. */
  private async currentBreakdowns(
    organizationId: string,
    request: AnalyticsRangeRequest,
  ): Promise<Pick<VolumeResponse, 'byStatus' | 'byPriority' | 'bySource'>> {
    const where = {
      organizationId,
      deletedAt: null,
      ...(request.departmentId
        ? { currentDepartmentId: request.departmentId }
        : {}),
    };

    const [byStatus, byPriority, bySource] = await Promise.all([
      this.prisma.ticket.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.ticket.groupBy({ by: ['priority'], where, _count: true }),
      this.prisma.ticket.groupBy({ by: ['source'], where, _count: true }),
    ]);

    return {
      byStatus: byStatus.map((row) => ({
        key: row.status,
        count: row._count,
      })),
      byPriority: byPriority.map((row) => ({
        key: row.priority,
        count: row._count,
      })),
      bySource: bySource.map((row) => ({
        key: row.source,
        count: row._count,
      })),
    };
  }
}

/**
 * `YYYY-MM-DD` → the `date` column's domain.
 *
 * Parsed as UTC midnight deliberately: the column is a `date`, which has no
 * timezone at all, and constructing it from the SERVER's zone would shift the
 * boundary by an hour for half the year in half the world.
 */
function parseRange(request: AnalyticsRangeRequest): { from: Date; to: Date } {
  const from = parseDay(request.from, 'from');
  const to = parseDay(request.to, 'to');

  if (from > to) {
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: '`from` must not be after `to`',
    });
  }

  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (days > MAX_ANALYTICS_RANGE_DAYS) {
    // Refused rather than silently truncated. A dashboard that quietly answered
    // a narrower question than it was asked is worse than one that says no.
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: `Range is ${days} days; the maximum is ${MAX_ANALYTICS_RANGE_DAYS}`,
    });
  }

  return { from, to };
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

function granularityOf(request: AnalyticsRangeRequest): AnalyticsGranularity {
  const value = request.granularity as AnalyticsGranularity | undefined;

  return value && Object.values(AnalyticsGranularity).includes(value)
    ? value
    : AnalyticsGranularity.DAY;
}

/**
 * Groups daily rows into the requested bucket, SUMMING counters.
 *
 * Summing rather than averaging is the whole reason the rollup stores sums:
 * a weekly deflection rate is the week's numerator over the week's denominator,
 * not the mean of seven daily rates.
 *
 * **A range spanning a DST boundary has neither a 23- nor a 25-hour day**
 * (19-doc §3.2 test 9), and it comes for free: `day` is a `date`, and a date
 * has no hours to be wrong about. The hour-level arithmetic happened once, in
 * the rollup's `AT TIME ZONE` cast, where Postgres owns the rules.
 */
function bucketBy(
  rows: DailyRow[],
  granularity: AnalyticsGranularity,
): Map<string, TicketStatSums> {
  const buckets = new Map<string, TicketStatSums>();

  for (const row of rows) {
    const key = bucketKey(row.day, granularity);
    buckets.set(
      key,
      addTicketStats(buckets.get(key) ?? EMPTY_TICKET_STATS, row),
    );
  }

  return buckets;
}

function bucketKey(day: Date, granularity: AnalyticsGranularity): string {
  const iso = day.toISOString().slice(0, 10);

  if (granularity === AnalyticsGranularity.DAY) return iso;
  if (granularity === AnalyticsGranularity.MONTH)
    return `${iso.slice(0, 7)}-01`;

  // ISO weeks start Monday. Labelled by the week's Monday rather than by a week
  // number, because "2026-W14" is a label almost nobody can place on a calendar.
  const monday = new Date(day);
  const weekday = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - weekday);

  return monday.toISOString().slice(0, 10);
}

function sumAll(rows: TicketStatSums[]): TicketStatSums {
  return rows.reduce(
    (accumulator, row) => addTicketStats(accumulator, row),
    EMPTY_TICKET_STATS,
  );
}

/** The newest rollup run behind an answer — the cache key's freshness input. */
/** A `date` column as `YYYY-MM-DD` — never a locale-formatted string. */
function toIsoDay(day: Date): string {
  return day.toISOString().slice(0, 10);
}

function latestComputedAt(rows: DailyRow[]) {
  if (rows.length === 0) return undefined;

  const newest = rows.reduce(
    (latest, row) => (row.computedAt > latest ? row.computedAt : latest),
    rows[0].computedAt,
  );

  return toTimestamp(newest);
}

/** Domain → wire. `null` becomes an absent field, never a zero. */
function toRate(value: Rate): RateValue {
  return {
    rate: value.rate ?? undefined,
    numerator: value.numerator,
    denominator: value.denominator,
  };
}

function toMean(value: Mean): MeanValue {
  return { mean: value.mean ?? undefined, count: value.count };
}
