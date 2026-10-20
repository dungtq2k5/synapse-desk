/**
 * @file Analytics in words and days: the filters kept in the address, the
 * periods a chart draws, and the numbers as the copy deck writes them.
 *
 * Days are ISO calendar days (`YYYY-MM-DD`), the server's unit: a range is
 * both ends inclusive, and day arithmetic runs in UTC on the date itself so a
 * clock change never moves one.
 */

import { dayDate } from './format';

export type Granularity = 'DAY' | 'WEEK' | 'MONTH';

export const GRANULARITIES: readonly Granularity[] = ['DAY', 'WEEK', 'MONTH'];

/** The filter bar's state, as the address keeps it. */
export type Filters = {
  from: string;
  to: string;
  /** One department's id, or null for all of them. */
  department: string | null;
  by: Granularity;
};

/** A range's length when the address names none. */
export const DEFAULT_DAYS = 30;

/** An export's longest range, whatever the plan. */
export const MAX_EXPORT_DAYS = 92;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const parse = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

/** Today on the reader's calendar. */
export function todayIso(now: Date = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return iso(local);
}

/** @example addDays('2026-10-19', -29) // '2026-09-20' */
export function addDays(day: string, days: number): string {
  const date = parse(day);
  date.setUTCDate(date.getUTCDate() + days);
  return iso(date);
}

/** Days in a range, both ends counted. @example spanDays('2026-09-20', '2026-10-19') // 30 */
export function spanDays(from: string, to: string): number {
  return (
    Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000) + 1
  );
}

/** A real calendar day: '2026-02-30' parses, but to March. */
const isDay = (value: string | null): value is string =>
  value !== null &&
  ISO_DAY.test(value) &&
  !Number.isNaN(parse(value).getTime()) &&
  iso(parse(value)) === value;

/**
 * The filters an address names, held to the plan's limit.
 *
 * A missing or broken range becomes the last {@link DEFAULT_DAYS} days (or the
 * limit, if shorter); a range longer than the limit keeps its end and loses
 * days from its start, and says so (`clamped`), so the page can tell the
 * reader.
 */
export function readFilters(
  params: URLSearchParams,
  limit: number,
  today: string = todayIso(),
): { filters: Filters; clamped: boolean } {
  const by = params.get('by')?.toUpperCase() as Granularity | undefined;
  const department = params.get('department');
  const base = {
    department: department || null,
    by: by && GRANULARITIES.includes(by) ? by : ('DAY' as const),
  };
  const from = params.get('from');
  const to = params.get('to');

  if (!isDay(from) || !isDay(to) || from > to) {
    const days = Math.min(DEFAULT_DAYS, Math.max(limit, 1));
    return {
      filters: { ...base, from: addDays(today, 1 - days), to: today },
      clamped: false,
    };
  }
  if (limit > 0 && spanDays(from, to) > limit) {
    return {
      filters: { ...base, from: addDays(to, 1 - limit), to },
      clamped: true,
    };
  }
  return { filters: { ...base, from, to }, clamped: false };
}

/** The filters as an address's query, defaults left out. */
export function writeFilters(filters: Filters): string {
  const params = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.department) params.set('department', filters.department);
  if (filters.by !== 'DAY') params.set('by', filters.by.toLowerCase());
  return params.toString();
}

/** The window of the same length just before this one. */
export function previousWindow(
  from: string,
  to: string,
): { from: string; to: string } {
  const days = spanDays(from, to);
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

export type Preset = {
  label: string;
  from: string;
  to: string;
  days: number;
  /** Longer than the plan allows: shown, not chosen. */
  locked: boolean;
};

/** The picker's presets, in the deck's order. */
export function presets(today: string, limit: number): Preset[] {
  const last = (days: number) => ({
    label: `Last ${days} days`,
    from: addDays(today, 1 - days),
    to: today,
  });
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = addDays(monthStart, -1);
  return [
    last(7),
    last(30),
    last(90),
    last(180),
    { label: 'This month', from: monthStart, to: today },
    {
      label: 'Last month',
      from: `${lastMonthEnd.slice(0, 8)}01`,
      to: lastMonthEnd,
    },
  ].map((preset) => {
    const days = spanDays(preset.from, preset.to);
    return { ...preset, days, locked: days > limit };
  });
}

/** A day without its year, as the axes write one. @example shortDay('2026-09-20') // '20 Sept' */
export function shortDay(day: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(parse(day));
}

/** A whole day, as the rest of the product writes one: '19 Oct 2026'. */
export function longDay(day: string): string {
  return dayDate(parse(day), 'UTC');
}

/** @example rangeWords('2026-09-20', '2026-10-19') // '20 Sept – 19 Oct 2026' */
export function rangeWords(from: string, to: string): string {
  const start =
    from.slice(0, 4) === to.slice(0, 4) ? shortDay(from) : longDay(from);
  return `${start} – ${longDay(to)}`;
}

/** @example rangeText('2026-09-20', '2026-10-19') // '20 Sept – 19 Oct 2026 · 30 days' */
export function rangeText(from: string, to: string): string {
  const days = spanDays(from, to);
  return `${rangeWords(from, to)} · ${days} ${days === 1 ? 'day' : 'days'}`;
}

/** A list of days in words: "8 Oct", "8–9 Oct", "8 Oct and 10 Oct". */
export function daysText(days: string[]): string {
  if (days.length === 0) return '';
  const first = days[0];
  const last = days.at(-1) ?? first;
  if (days.length === 1) return shortDay(first);
  if (spanDays(first, last) === days.length) {
    return first.slice(0, 7) === last.slice(0, 7)
      ? `${Number(first.slice(8))}–${shortDay(last)}`
      : `${shortDay(first)} – ${shortDay(last)}`;
  }
  return `${days.slice(0, -1).map(shortDay).join(', ')} and ${shortDay(last)}`;
}

// ------------------------------------------------------------------ numbers

/**
 * A duration in words, at most two units.
 *
 * @example duration(8) // '8 s'
 * @example duration(8460) // '2 h 21 min'
 * @example duration(97_200) // '1 d 3 h'
 */
export function duration(seconds: number): string {
  const s = Math.round(Math.abs(seconds));
  if (s < 60) return `${s} s`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days} d ${rest} h` : `${days} d`;
}

/** A whole percentage. @example percent(0.846) // '85%' */
export function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export type Rate = {
  rate?: number | null;
  numerator: number;
  denominator: number;
};
export type Mean = { mean?: number | null; count: number };

/** A rate with its counts. @example rateText({ rate: 0.85, numerator: 170, denominator: 200 }) // '85% (170 of 200)' */
export function rateText(rate: Rate, locale?: string): string {
  if (rate.rate == null) return '—';
  return `${percent(rate.rate)} (${count(rate.numerator, locale)} of ${count(rate.denominator, locale)})`;
}

export const count = (n: number, locale?: string) => n.toLocaleString(locale);

const MINUS = '−';

/**
 * How a tile moved against the window before, in neutral words — or null
 * when there's nothing to compare against.
 *
 * @example change('count', 415, 392, 30) // '+6% vs the previous 30 days'
 * @example change('rate', 0.62, 0.59, 30) // '+3 points vs the previous 30 days'
 * @example change('time', 8460, 9180, 30) // '−12 min vs the previous 30 days'
 */
export function change(
  kind: 'count' | 'rate' | 'time',
  now: number | null | undefined,
  before: number | null | undefined,
  days: number,
): string | null {
  if (now == null || before == null) return null;
  const tail = `vs the previous ${days} days`;
  const same = `No change ${tail}`;
  if (kind === 'count') {
    if (before === 0) return now === 0 ? same : null;
    const moved = Math.round(((now - before) / before) * 100);
    return moved === 0 ? same : `${sign(moved)}${Math.abs(moved)}% ${tail}`;
  }
  if (kind === 'rate') {
    const points = Math.round((now - before) * 100);
    if (points === 0) return same;
    return `${sign(points)}${Math.abs(points)} ${Math.abs(points) === 1 ? 'point' : 'points'} ${tail}`;
  }
  const delta = now - before;
  const words = duration(delta);
  return words === '0 s' ? same : `${sign(delta)}${words} ${tail}`;
}

/** Which way a change line points, for its decorative arrow. */
export function direction(line: string | null): 'up' | 'down' | 'same' | null {
  if (!line) return null;
  if (line.startsWith('+')) return 'up';
  if (line.startsWith(MINUS)) return 'down';
  return 'same';
}

const sign = (n: number) => (n > 0 ? '+' : MINUS);

// ------------------------------------------------------------------ periods

/** One period a chart draws. */
export type Period = {
  /** The bucket's first day, as the server keys it. */
  key: string;
  /** The range's own days in this period. */
  from: string;
  to: string;
  days: number;
  /** Cut short by the range (a week or month it doesn't cover whole). */
  partial: boolean;
  /** Not computed yet: every day is after `dataThrough`. */
  noData: boolean;
};

const bucketStart = (day: string, by: Granularity): string => {
  if (by === 'DAY') return day;
  if (by === 'MONTH') return `${day.slice(0, 8)}01`;
  const date = parse(day);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return iso(date);
};

const bucketLength = (start: string, by: Granularity): number => {
  if (by === 'DAY') return 1;
  if (by === 'WEEK') return 7;
  const date = parse(start);
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
};

/**
 * The periods a range draws at a granularity, oldest first, keyed as the
 * server keys its points (a week starts on Monday, a month on the 1st).
 *
 * The server sends a point only for a period with activity, so a period with
 * no point is zero — unless it's after `dataThrough`, which is "no data":
 * those days weren't computed, and are drawn as a gap, never as zero.
 */
export function periods(
  from: string,
  to: string,
  by: Granularity,
  dataThrough: string | null,
): Period[] {
  const result: Period[] = [];
  let day = from;
  while (day <= to) {
    const key = bucketStart(day, by);
    const length = bucketLength(key, by);
    const end = addDays(key, length - 1);
    const last = end < to ? end : to;
    const days = spanDays(day, last);
    result.push({
      key,
      from: day,
      to: last,
      days,
      partial: days < length,
      noData: dataThrough === null || day > dataThrough,
    });
    day = addDays(last, 1);
  }
  return result;
}

/** A period's label on an axis or a table row. */
export function periodLabel(period: Period, by: Granularity): string {
  if (by === 'MONTH') {
    return new Intl.DateTimeFormat('en-GB', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(parse(period.key));
  }
  const label = shortDay(period.from);
  return period.partial && by === 'WEEK'
    ? `${label} (${period.days} ${period.days === 1 ? 'day' : 'days'})`
    : label;
}

// ------------------------------------------------------------------ words

/** What each AI purpose is, as the bar list and tables name it. */
export const PURPOSE_WORDS: Record<string, string> = {
  CHAT_ANSWER: 'Answers in Ask and chat',
  DRAFT: 'Reply drafts for agents',
  REVIEW: 'Draft reviews',
  SUMMARY: 'Ticket summaries',
  SUGGESTIONS: 'Next-step suggestions for agents',
  CLASSIFY: 'Ticket classification',
  INJECTION_CLASSIFY: 'Safety checks',
  GREETING_CLASSIFY: 'Greeting checks (chat)',
  REFORMULATION: 'Question rewording',
  EMBEDDING: 'Search indexing (embeddings)',
};

export const STATUS_WORDS: Record<string, string> = {
  NEW: 'New',
  OPEN: 'Open',
  PENDING_AGENT: 'Pending agent',
  ESCALATED: 'Escalated',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export const PRIORITY_WORDS: Record<string, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

export const SOURCE_WORDS: Record<string, string> = {
  WEB: 'Web',
  EMAIL: 'Email',
  CHAT: 'Chat',
  API: 'API',
};

/**
 * A breakdown in the deck's order, every key present (a missing one is 0).
 */
export function breakdown(
  words: Record<string, string>,
  rows: { key: string; count: number }[],
): { key: string; label: string; count: number }[] {
  const counts = new Map(rows.map((row) => [row.key, row.count]));
  return Object.entries(words).map(([key, label]) => ({
    key,
    label,
    count: counts.get(key) ?? 0,
  }));
}

// ------------------------------------------------------------------ series

/**
 * One value per period from the server's sparse points, keyed by bucket.
 *
 * A period with no point is zero for a count (`missing: 0`) and null for a
 * rate or a mean (`missing: null`: nothing to measure); a period after
 * `dataThrough` is always null, drawn as "No data".
 */
export function valuesFor<T extends { day: string }>(
  periods: Period[],
  points: T[],
  pick: (point: T) => number | null | undefined,
  missing: 0 | null,
): (number | null)[] {
  const byDay = new Map(points.map((point) => [point.day, point]));
  return periods.map((period) => {
    if (period.noData) return null;
    const point = byDay.get(period.key);
    return point ? (pick(point) ?? null) : missing;
  });
}

/** A period as the tooltip and the table name it. */
export function periodTitle(period: Period, by: Granularity): string {
  if (by === 'DAY') return longDay(period.from);
  if (by === 'WEEK') return `Week of ${longDay(period.key)}`;
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parse(period.key));
}

/** The table's first column: Day, Week of or Month. */
export const PERIOD_COLUMN: Record<Granularity, string> = {
  DAY: 'Day',
  WEEK: 'Week of',
  MONTH: 'Month',
};

/** "Per day." / "Per week." / "Per month." */
export const PER: Record<Granularity, string> = {
  DAY: 'Per day.',
  WEEK: 'Per week.',
  MONTH: 'Per month.',
};

/**
 * The unit a duration chart reads best in, by its largest value: the chart
 * draws values divided by `seconds`, so its gridlines fall on whole units.
 *
 * @example durationUnit(18_000) // { seconds: 3600, suffix: 'h' }
 */
export function durationUnit(max: number): { seconds: number; suffix: string } {
  if (max >= 2 * 86_400) return { seconds: 86_400, suffix: 'd' };
  if (max >= 2 * 3600) return { seconds: 3600, suffix: 'h' };
  if (max >= 120) return { seconds: 60, suffix: 'min' };
  return { seconds: 1, suffix: 's' };
}
