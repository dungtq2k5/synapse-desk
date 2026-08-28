/**
 * @file The helpers BOTH analytics services need, in one place.
 *
 * `ai-analytics.service.ts` (ingestion) and `analytics.service.ts` (ticket)
 * carried private copies of every function below. Copies of a date parser are
 * cheap to live with and expensive to be wrong about in only one of them: the
 * window that made this visible is enforced in both, and a range accepted by
 * one surface and refused by the other is a difference a tenant experiences as
 * a bug in whichever page they opened second.
 *
 * Nothing here reaches for a proto type — `libs/common` must not depend on
 * `libs/grpc-proto`. The wire shapes are declared structurally instead, which
 * is enough: TypeScript is structural, so the results assign to each service's
 * generated message without either importing the other's.
 */

import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { AnalyticsGranularity, Mean, Rate } from '../configs/analytics.config';

/** A `date` column as `YYYY-MM-DD` — never a locale-formatted string. */
export function toIsoDay(day: Date): string {
  return day.toISOString().slice(0, 10);
}

/**
 * `YYYY-MM-DD` → the `date` column's domain.
 *
 * @throws RpcException `INVALID_ARGUMENT` naming the field, so a caller who
 * sent `01/02/2026` is told which of `from` or `to` was wrong.
 */
export function parseDay(value: string, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) {
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: `\`${field}\` must be YYYY-MM-DD`,
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
 * The day a row is bucketed under, at the requested granularity.
 *
 * ISO weeks start Monday, and a week is labelled by its Monday rather than by a
 * week number — "2026-W14" is a label almost nobody can place on a calendar.
 */
export function bucketKey(
  day: Date,
  granularity: AnalyticsGranularity,
): string {
  const iso = toIsoDay(day);

  if (granularity === AnalyticsGranularity.DAY) return iso;
  if (granularity === AnalyticsGranularity.MONTH)
    return `${iso.slice(0, 7)}-01`;

  const monday = new Date(day);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));

  return toIsoDay(monday);
}

/** An unrecognized granularity reads as DAY rather than failing the request. */
export function granularityOf(value: string | undefined): AnalyticsGranularity {
  const granularity = value as AnalyticsGranularity | undefined;

  return granularity &&
    Object.values(AnalyticsGranularity).includes(granularity)
    ? granularity
    : AnalyticsGranularity.DAY;
}

/**
 * The requested range, bounded by what the TENANT's plan allows.
 *
 * **`maxRangeDays` is threaded in rather than read here**, and that is what
 * keeps this function pure and synchronous: resolving it needs a gRPC call, and
 * making this async would turn six call sites in `ticket-service` — four of
 * them inside `Promise.all` compositions — into awaited ones for no gain. The
 * caller already awaits an organization read.
 *
 * Refused rather than silently truncated: a dashboard that quietly answered a
 * narrower question than it was asked is worse than one that says no.
 *
 * @throws RpcException `INVALID_ARGUMENT` for a malformed day, an inverted
 * range, or a span wider than the tenant's window.
 */
export function parseAnalyticsRange(
  from: string,
  to: string,
  maxRangeDays: number,
): { from: Date; to: Date } {
  const start = parseDay(from, 'from');
  const end = parseDay(to, 'to');

  if (start > end) {
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: '`from` must not be after `to`',
    });
  }

  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;

  if (days > maxRangeDays) {
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: `Range is ${days} days; the maximum is ${maxRangeDays}`,
    });
  }

  return { from: start, to: end };
}

/** A rate on the wire. Structural, so it assigns to either service's message. */
export type RateWire = {
  rate?: number;
  numerator: number;
  denominator: number;
};

/** A mean on the wire. Structural, for the same reason as {@link RateWire}. */
export type MeanWire = { mean?: number; count: number };

/** Domain → wire. `null` becomes an ABSENT field, never a zero. */
export function toRateWire(value: Rate): RateWire {
  return {
    rate: value.rate ?? undefined,
    numerator: value.numerator,
    denominator: value.denominator,
  };
}

/** Domain → wire, with the same null-is-absent rule as {@link toRateWire}. */
export function toMeanWire(value: Mean): MeanWire {
  return { mean: value.mean ?? undefined, count: value.count };
}

/**
 * The newest `computedAt` among rollup rows, or `undefined` for none.
 *
 * **Only the reduce is shared, deliberately.** Both analytics services wrap
 * this in `toProtoTimestamp` to answer "how fresh is this dashboard", and that
 * conversion cannot live here — `libs/` must not import `libs/grpc-proto`. The
 * duplication worth removing was the fold; the two-line wrapper is not it.
 *
 * Generic over the row so neither service's Prisma type has to be named here.
 */
export function newestComputedAt<Row extends { computedAt: Date }>(
  rows: Row[],
): Date | undefined {
  if (rows.length === 0) return undefined;

  return rows.reduce(
    (latest, row) => (row.computedAt > latest ? row.computedAt : latest),
    rows[0].computedAt,
  );
}
