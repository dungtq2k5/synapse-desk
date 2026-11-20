'use client';

import {
  useAnalyticsControllerDeflectionV1,
  useAnalyticsControllerOverviewV1,
  useAnalyticsControllerResponseTimesV1,
  useAnalyticsControllerSatisfactionV1,
  useAnalyticsControllerVolumeV1,
  type DeflectionResponseDto,
  type MeanResponseDto,
  type OverviewResponseDto,
  type RateResponseDto,
  type ResponseTimePointResponseDto,
  type ResponseTimesResponseDto,
  type SatisfactionResponseDto,
  type VolumeResponseDto,
} from '@synapsedesk/api-client';
import { LoadError } from '@/components/settings/settings-frame';
import {
  breakdown,
  change,
  count,
  daysText,
  duration,
  durationUnit,
  type Granularity,
  PER,
  PERIOD_COLUMN,
  percent,
  type Period,
  periodLabel,
  periods as periodsOf,
  periodTitle,
  PRIORITY_WORDS,
  previousWindow,
  rateText,
  SOURCE_WORDS,
  spanDays,
  STATUS_WORDS,
  valuesFor,
} from '@/lib/analytics';
import {
  BarList,
  ChartCard,
  ChartSkeleton,
  Legend,
  type Series,
  TimeChart,
} from './charts';
import { AnalyticsFrame, DataThrough, useAnalyticsFilters } from './frame';
import { FreshnessAlert, StatTiles, type Tile, TileSkeletons } from './tiles';

const UNIT: Record<Granularity, string> = {
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
};

/** Analytics › Overview: the tiles, five charts and three breakdowns. */
export function OverviewView() {
  const filters = useAnalyticsFilters();
  const { from, to, department, by } = filters.filters;
  const params = {
    from,
    to,
    ...(department ? { departmentId: department } : {}),
    granularity: by,
  };
  const query = { query: { enabled: filters.ready } };
  const overview = useAnalyticsControllerOverviewV1(params, query);
  const previous = useAnalyticsControllerOverviewV1(
    { ...params, ...previousWindow(from, to) },
    { query: { enabled: filters.ready, retry: false } },
  );
  const volume = useAnalyticsControllerVolumeV1(params, query);
  const deflection = useAnalyticsControllerDeflectionV1(params, query);
  const satisfaction = useAnalyticsControllerSatisfactionV1(params, query);
  const times = useAnalyticsControllerResponseTimesV1(params, query);
  const data = overview.data?.data;

  let body;
  if (overview.isError) {
    body = (
      <LoadError what="analytics" onRetry={() => void overview.refetch()} />
    );
  } else if (!data) {
    body = (
      <div aria-busy className="flex flex-col gap-4">
        <span className="sr-only" role="status">
          Loading analytics
        </span>
        <TileSkeletons count={8} />
        <ChartSkeleton height={240} />
      </div>
    );
  } else {
    const days = spanDays(from, to);
    const dataThrough = data.dataThrough;
    const daily = periodsOf(from, to, 'DAY', dataThrough);
    const missing = daily.filter((day) => day.noData).map((day) => day.from);
    const shown = periodsOf(from, to, by, dataThrough);
    const before = previous.data?.data;
    body = (
      <div className="flex flex-col gap-6">
        <FreshnessAlert
          computed={dataThrough !== null}
          missingDays={missing}
          totalDays={days}
        />
        <StatTiles
          tiles={tiles(
            data,
            before,
            days,
            missing.length,
            dataThrough !== null,
          )}
        />
        {volume.isError ? (
          <LoadError what="the volume" onRetry={() => void volume.refetch()} />
        ) : volume.data?.data ? (
          <Volume
            data={volume.data.data}
            periods={shown}
            by={by}
            missing={missing}
          />
        ) : (
          <ChartSkeleton height={240} />
        )}
        <div className="grid gap-6 lg:grid-cols-2">
          {deflection.isError ? (
            <LoadError
              what="deflection"
              onRetry={() => void deflection.refetch()}
            />
          ) : deflection.data?.data ? (
            <Deflection data={deflection.data.data} periods={shown} by={by} />
          ) : (
            <ChartSkeleton />
          )}
          {satisfaction.isError ? (
            <LoadError
              what="satisfaction"
              onRetry={() => void satisfaction.refetch()}
            />
          ) : satisfaction.data?.data ? (
            <Satisfaction
              data={satisfaction.data.data}
              periods={shown}
              by={by}
            />
          ) : (
            <ChartSkeleton />
          )}
        </div>
        {times.isError ? (
          <LoadError
            what="response times"
            onRetry={() => void times.refetch()}
          />
        ) : times.data?.data ? (
          <ResponseTimes data={times.data.data} periods={shown} by={by} />
        ) : (
          <ChartSkeleton />
        )}
        {volume.data?.data && <Breakdowns data={volume.data.data} />}
      </div>
    );
  }

  return (
    <AnalyticsFrame
      section="overview"
      filters={filters}
      status={
        data && (
          <DataThrough
            dataThrough={data.dataThrough}
            computedAt={data.computedAt}
          />
        )
      }
    >
      {body}
    </AnalyticsFrame>
  );
}

type Overview = OverviewResponseDto;

const rateOf = (rate: RateResponseDto) => rate.rate ?? null;
const meanOf = (mean: MeanResponseDto) => mean.mean ?? null;

/** The eight tiles, with each one's change against the window before. */
export function tiles(
  now: Overview,
  before: Overview | undefined,
  days: number,
  missingDays: number,
  computed: boolean,
): Tile[] {
  const period =
    missingDays > 0
      ? `In the ${days - missingDays} days with data`
      : `In the ${days} days`;
  const counted = (
    label: string,
    value: number,
    previous: number | undefined,
    help: string,
  ): Tile =>
    computed
      ? {
          label,
          value: count(value),
          counts: period,
          change: change('count', value, previous, days),
          help,
        }
      : { label, value: null, counts: 'Not computed yet', help };
  const rated = (
    label: string,
    rate: RateResponseDto,
    previous: RateResponseDto | undefined,
    words: (a: string, b: string) => string,
    none: string,
    help: string,
  ): Tile => {
    if (!computed)
      return { label, value: null, counts: 'Not computed yet', help };
    if (rate.rate == null) return { label, value: null, counts: none, help };
    return {
      label,
      value: percent(rate.rate),
      counts: words(count(rate.numerator), count(rate.denominator)),
      change: change(
        'rate',
        rate.rate,
        previous ? rateOf(previous) : null,
        days,
      ),
      help,
    };
  };
  const timed = (
    label: string,
    mean: MeanResponseDto,
    previous: MeanResponseDto | undefined,
    none: string,
    help: string,
  ): Tile => {
    if (!computed)
      return { label, value: null, counts: 'Not computed yet', help };
    if (mean.mean == null) return { label, value: null, counts: none, help };
    return {
      label,
      value: duration(mean.mean),
      counts: `Mean across ${count(mean.count)} tickets`,
      change: change(
        'time',
        mean.mean,
        previous ? meanOf(previous) : null,
        days,
      ),
      help,
    };
  };

  return [
    counted(
      'Tickets created',
      now.ticketsCreated,
      before?.ticketsCreated,
      'Tickets opened in the period, through any channel.',
    ),
    counted(
      'Tickets resolved',
      now.ticketsResolved,
      before?.ticketsResolved,
      'Tickets that reached Resolved in the period.',
    ),
    {
      label: 'Open now',
      value: count(now.openTickets),
      counts:
        now.openTickets === 0 || now.openTicketMedianAgeSeconds == null
          ? 'No open tickets'
          : `Median age ${duration(now.openTicketMedianAgeSeconds)}`,
      help: 'Open tickets right now, whatever the date range. The median age is how long the middle one has been open.',
    },
    rated(
      'Deflection',
      now.deflection,
      before?.deflection,
      (a, b) => `${a} of ${b} chats, no person needed`,
      'No chats yet',
      'Chat conversations the AI resolved without anyone taking over.',
    ),
    rated(
      'Satisfaction (CSAT)',
      now.csat,
      before?.csat,
      (a, b) => `${a} of ${b} ratings positive`,
      'No ratings yet',
      'The share of satisfaction ratings that were positive.',
    ),
    timed(
      'First response, people',
      now.humanFirstResponseSeconds,
      before?.humanFirstResponseSeconds,
      'No replies yet',
      'Mean time from a ticket opening to a person’s first reply.',
    ),
    timed(
      'First response, AI',
      now.aiFirstResponseSeconds,
      before?.aiFirstResponseSeconds,
      'No replies yet',
      'Mean time from a ticket opening to the AI’s first reply.',
    ),
    timed(
      'Resolution time',
      now.resolutionSeconds,
      before?.resolutionSeconds,
      'Nothing resolved yet',
      'Mean time from a ticket opening to Resolved.',
    ),
  ];
}

/** Chart props every time chart here shares. */
const axes = (periods: Period[], by: Granularity) => ({
  periods,
  labels: periods.map((period) => periodLabel(period, by)),
  titles: periods.map((period) => periodTitle(period, by)),
});

/** A table's rows, newest first, "No data" where nothing was computed. */
function rows(
  periods: Period[],
  by: Granularity,
  cells: (index: number) => string[],
): string[][] {
  return periods
    .map((period, index) => [
      periodTitle(period, by),
      ...(period.noData ? cells(index).map(() => 'No data') : cells(index)),
    ])
    .reverse();
}

/** A sentence about periods the range cuts short, for the summary. */
function partialSentence(periods: Period[], by: Granularity): string | null {
  const last = periods.at(-1);
  const first = periods[0];
  const unit = UNIT[by];
  const daysOf = (period: Period) => {
    const result: string[] = [];
    let day = period.from;
    for (let index = 0; index < period.days; index++) {
      result.push(day);
      const next = new Date(`${day}T00:00:00.000Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      day = next.toISOString().slice(0, 10);
    }
    return result;
  };
  if (last?.partial && periods.length > 1) {
    return `The last ${unit} holds only ${daysText(daysOf(last))}, so it’s dashed.`;
  }
  if (first?.partial && periods.length > 1) {
    return `The first ${unit} holds only ${daysText(daysOf(first))}, so it’s dashed.`;
  }
  return null;
}

type Volume = VolumeResponseDto;

function Volume({
  data,
  periods,
  by,
  missing,
}: {
  data: Volume;
  periods: Period[];
  by: Granularity;
  missing: string[];
}) {
  const series: Series[] = [
    {
      name: 'Created',
      color: 1,
      values: valuesFor(periods, data.points, (p) => p.created, 0),
    },
    {
      name: 'Resolved',
      color: 2,
      values: valuesFor(periods, data.points, (p) => p.resolved, 0),
    },
    {
      name: 'Escalated',
      color: 3,
      values: valuesFor(periods, data.points, (p) => p.escalated, 0),
    },
  ];
  const sum = (key: 'created' | 'resolved' | 'escalated') =>
    data.points.reduce((total, point) => total + point[key], 0);
  const days = periods.reduce(
    (total, period) => total + (period.noData ? 0 : period.days),
    0,
  );
  const nothing =
    periods.every((period) => period.noData) ||
    series.every((one) => one.values.every((v) => !v));
  const summary = [
    `Over ${days} days: ${count(sum('created'))} created, ${count(sum('resolved'))} resolved, ${count(sum('escalated'))} escalated.`,
    partialSentence(periods, by),
    missing.length > 0 ? `No data for ${daysText(missing)}.` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <ChartCard
      title="Volume"
      lead={`Tickets created, resolved and escalated. ${PER[by]}`}
      legend={<Legend series={series} />}
      summary={summary}
      table={{
        columns: [PERIOD_COLUMN[by], 'Created', 'Resolved', 'Escalated'],
        rows: rows(periods, by, (index) =>
          series.map((one) => count(one.values[index] ?? 0)),
        ),
      }}
    >
      <TimeChart
        title="Volume"
        {...axes(periods, by)}
        series={series}
        height={240}
        axis={(v) => count(v)}
        value={(v) => count(v)}
        empty={nothing ? 'No tickets in this period' : null}
      />
    </ChartCard>
  );
}

type Deflection = DeflectionResponseDto;

function Deflection({
  data,
  periods,
  by,
}: {
  data: Deflection;
  periods: Period[];
  by: Granularity;
}) {
  const values = valuesFor(
    periods,
    data.points,
    (p) => p.deflection.rate,
    null,
  );
  const rates = values.filter((v): v is number => v !== null);
  const total = data.total;
  const summary =
    total.rate == null
      ? 'No chats in this period.'
      : `${percent(total.rate)} across the period (${count(total.numerator)} of ${count(total.denominator)} chats); between ${percent(Math.min(...rates))} and ${percent(Math.max(...rates))} a ${UNIT[by]}.`;
  return (
    <ChartCard
      title="Deflection"
      lead={`Chats solved by the AI without a person. ${PER[by]}`}
      summary={summary}
      table={{
        columns: [PERIOD_COLUMN[by], 'Deflection'],
        rows: rows(periods, by, (index) => {
          const point = data.points.find((p) => p.day === periods[index].key);
          return [point ? rateText(point.deflection) : '—'];
        }),
      }}
    >
      <TimeChart
        title="Deflection"
        {...axes(periods, by)}
        series={[{ name: 'Deflection', color: 1, values }]}
        fixedMax={1}
        endLabels={false}
        axis={percent}
        value={percent}
        empty={total.rate == null ? 'No chats yet' : null}
      />
    </ChartCard>
  );
}

type Satisfaction = SatisfactionResponseDto;

function Satisfaction({
  data,
  periods,
  by,
}: {
  data: Satisfaction;
  periods: Period[];
  by: Granularity;
}) {
  const series: Series[] = [
    {
      name: 'CSAT',
      color: 1,
      values: valuesFor(periods, data.points, (p) => p.csat.rate, null),
    },
    {
      name: 'Citation accuracy',
      endLabel: 'Citations',
      color: 2,
      values: valuesFor(
        periods,
        data.points,
        (p) => p.citationAccuracy.rate,
        null,
      ),
    },
  ];
  const csat = data.csatTotal;
  const citations = data.citationAccuracyTotal;
  const nothing = csat.rate == null && citations.rate == null;
  const summary = nothing
    ? 'No ratings in this period.'
    : `CSAT ${csat.rate == null ? '—' : percent(csat.rate)} (${count(csat.numerator)} of ${count(csat.denominator)} ratings); citation accuracy ${citations.rate == null ? '—' : percent(citations.rate)} (${count(citations.numerator)} of ${count(citations.denominator)} rated citations).`;
  return (
    <ChartCard
      title="Satisfaction"
      lead={`CSAT, and how often the AI’s citations were rated accurate. ${PER[by]}`}
      legend={<Legend series={series} />}
      summary={summary}
      table={{
        columns: [PERIOD_COLUMN[by], 'CSAT', 'Citation accuracy'],
        rows: rows(periods, by, (index) => {
          const point = data.points.find((p) => p.day === periods[index].key);
          return point
            ? [rateText(point.csat), rateText(point.citationAccuracy)]
            : ['—', '—'];
        }),
      }}
    >
      <TimeChart
        title="Satisfaction"
        {...axes(periods, by)}
        series={series}
        fixedMax={1}
        axis={percent}
        value={percent}
        empty={nothing ? 'No ratings yet' : null}
      />
    </ChartCard>
  );
}

type Times = ResponseTimesResponseDto;

function ResponseTimes({
  data,
  periods,
  by,
}: {
  data: Times;
  periods: Period[];
  by: Granularity;
}) {
  const multiples = [
    {
      name: 'People’s first response',
      pick: (p: ResponseTimePointResponseDto) => p.humanFirstResponseSeconds,
      total: data.humanTotal,
    },
    {
      name: 'AI’s first response',
      pick: (p: ResponseTimePointResponseDto) => p.aiFirstResponseSeconds,
      total: data.aiTotal,
    },
    {
      name: 'Resolution time',
      pick: (p: ResponseTimePointResponseDto) => p.resolutionSeconds,
      total: data.resolutionTotal,
    },
  ];
  const averaged = (total: MeanResponseDto) =>
    total.mean == null
      ? '—'
      : `${duration(total.mean)} (${count(total.count)} tickets)`;
  const summary = `People’s first response averaged ${averaged(data.humanTotal)}, the AI’s ${averaged(data.aiTotal)}, and resolution ${averaged(data.resolutionTotal)}.`;
  return (
    <ChartCard
      title="Response times"
      lead={`Means, each on its own scale. ${PER[by]}`}
      summary={summary}
      table={{
        columns: [PERIOD_COLUMN[by], ...multiples.map((one) => one.name)],
        rows: rows(periods, by, (index) => {
          const point = data.points.find((p) => p.day === periods[index].key);
          return multiples.map((one) => {
            const mean = point ? one.pick(point) : null;
            return mean?.mean == null
              ? '—'
              : `${duration(mean.mean)} (${mean.count})`;
          });
        }),
      }}
    >
      <div className="grid gap-6 md:grid-cols-3">
        {multiples.map((one) => {
          const seconds = valuesFor(
            periods,
            data.points,
            (p) => one.pick(p).mean,
            null,
          );
          const unit = durationUnit(
            Math.max(0, ...seconds.filter((v): v is number => v !== null)),
          );
          return (
            <div key={one.name} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{one.name}</h3>
              <TimeChart
                title={one.name}
                {...axes(periods, by)}
                series={[
                  {
                    name: one.name,
                    color: 1,
                    values: seconds.map((v) =>
                      v === null ? null : v / unit.seconds,
                    ),
                  },
                ]}
                height={160}
                endLabels={false}
                axis={(v) => `${Number(v.toFixed(1))} ${unit.suffix}`}
                value={(v) => duration(v * unit.seconds)}
                empty={one.total.mean == null ? 'No replies yet' : null}
              />
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}

function Breakdowns({ data }: { data: Volume }) {
  const cards = [
    {
      title: 'By status',
      lead: 'Created in the period, by where they are now.',
      words: STATUS_WORDS,
      rows: data.byStatus,
    },
    {
      title: 'By priority',
      lead: 'Created in the period.',
      words: PRIORITY_WORDS,
      rows: data.byPriority,
    },
    {
      title: 'By source',
      lead: 'Created in the period.',
      words: SOURCE_WORDS,
      rows: data.bySource,
    },
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {cards.map((card) => (
        <section
          key={card.title}
          aria-label={card.title}
          className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-5"
        >
          <div className="space-y-1">
            <h2 className="font-semibold">{card.title}</h2>
            <p className="text-sm text-muted-foreground">{card.lead}</p>
          </div>
          <BarList
            rows={breakdown(card.words, card.rows).map((row) => ({
              label: row.label,
              value: row.count,
              text: count(row.count),
            }))}
          />
        </section>
      ))}
    </div>
  );
}
