/**
 * The window a daily rollup job runs over — 19-doc §2.2.
 *
 * Shared because THREE jobs in two services need the identical semantics, and
 * the two ways to get this wrong are both silent:
 *
 *   - **A closed interval double-counts** every row landing exactly on a
 *     boundary. At second granularity that is rare enough to look like noise
 *     and frequent enough to matter over months.
 *   - **UTC bucketing splits a tenant's day.** A tenant at UTC+7 whose Monday
 *     starts at 17:00 Sunday UTC sees every daily figure spread across two rows,
 *     and no consumer can reassemble them.
 *
 * The bucketing itself happens in SQL (`(created_at AT TIME ZONE $tz)::date`),
 * because Postgres is the only thing in the stack that knows a zone's DST rules
 * for a given date. This module owns the WINDOW and the validation; it
 * deliberately does not reimplement the date maths.
 */

/** The default when a tenant has not set one. Wrong, and at least deterministic. */
export const DEFAULT_ROLLUP_TIMEZONE = 'UTC';

/** A half-open `[since, until)` instant range. */
export type RollupWindow = {
  since: Date;
  until: Date;
};

/**
 * Validates an IANA zone name, falling back to UTC.
 *
 * **Validated in the application rather than trusted to Postgres**, because an
 * unknown zone in `AT TIME ZONE` is a runtime ERROR that aborts the statement —
 * so one tenant with a typo'd timezone would fail the rollup for every tenant
 * in the same run. Falling back costs that tenant correct bucketing for a day;
 * throwing costs everyone their numbers.
 */
export function safeTimezone(timezone: string | null | undefined): string {
  if (!timezone) return DEFAULT_ROLLUP_TIMEZONE;

  try {
    // Constructing the formatter is the check: `Intl` throws `RangeError` on an
    // unknown zone and accepts exactly the set Postgres does.
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone });

    return timezone;
  } catch {
    return DEFAULT_ROLLUP_TIMEZONE;
  }
}

/**
 * The window covering the `days` local days ending just before `now`.
 *
 * Deliberately generous at both ends — it is an INSTANT range used only to
 * limit how much of the source table is scanned, while the day a row lands in
 * is decided by the SQL date cast. A window an hour too wide re-computes a day
 * that was already correct; a window an hour too narrow drops rows silently,
 * so the asymmetry is on purpose.
 */
export function trailingWindow(now: Date, days: number): RollupWindow {
  const until = new Date(now);
  const since = new Date(now);

  // The extra day absorbs every offset on earth (UTC-12 to UTC+14) without
  // needing to know the tenant's, which is what lets one window serve a run
  // that spans tenants in different zones.
  since.setUTCDate(since.getUTCDate() - (days + 1));

  return { since, until };
}

/**
 * The window for an explicit backfill over `[fromDay, toDay]` INCLUSIVE.
 *
 * Inclusive on both days because that is what an operator means by "backfill
 * March": excluding the last day is the off-by-one that makes a correction
 * quietly leave the day somebody was complaining about untouched.
 */
export function backfillWindow(fromDay: Date, toDay: Date): RollupWindow {
  const since = new Date(fromDay);
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - 1);

  const until = new Date(toDay);
  until.setUTCHours(0, 0, 0, 0);
  until.setUTCDate(until.getUTCDate() + 2);

  return { since, until };
}
