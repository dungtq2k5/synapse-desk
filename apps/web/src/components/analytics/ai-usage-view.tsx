'use client';

import {
  useAnalyticsControllerAiUsageV1,
  type AiUsageResponseDto,
  type AiUsageSliceResponseDto,
} from '@synapsedesk/api-client';
import { CircleAlertIcon, TriangleAlertIcon } from 'lucide-react';
import { LoadError } from '@/components/settings/settings-frame';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  count,
  daysText,
  type Granularity,
  longDay,
  PERIOD_COLUMN,
  type Period,
  periodLabel,
  periods as periodsOf,
  periodTitle,
  percent,
  PURPOSE_WORDS,
  valuesFor,
} from '@/lib/analytics';
import { aiMoney } from '@/lib/billing';
import { cn } from '@/lib/utils';
import { BarList, ChartCard, TimeChart } from './charts';
import { AnalyticsFrame, DataThrough, useAnalyticsFilters } from './frame';
import { StatTiles } from './tiles';

const UNIT: Record<Granularity, string> = {
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
};

/** Tokens in millions, as the tables write them: "1.92M". */
const tokens = (n: number) => `${(n / 1_000_000).toFixed(2)}M`;

/** A failure rate to a tenth of a percent, with its counts. */
const failures = (rate: AiUsageSliceResponseDto['failureRate']) =>
  rate.rate == null
    ? '—'
    : `${(rate.rate * 100).toFixed(1)}% (${count(rate.numerator)} of ${count(rate.denominator)})`;

const latency = (slice: AiUsageSliceResponseDto) =>
  slice.latencyMs.mean == null
    ? '—'
    : `${(slice.latencyMs.mean / 1000).toFixed(1)} s`;

/** Analytics › AI usage: the allowance, where it goes, how well it's used. */
export function AiUsageView() {
  const filters = useAnalyticsFilters();
  const { from, to, by } = filters.filters;
  const usage = useAnalyticsControllerAiUsageV1(
    { from, to, granularity: by },
    { query: { enabled: filters.ready } },
  );
  const data = usage.data?.data;

  let body;
  if (usage.isError) {
    body = <LoadError what="analytics" onRetry={() => void usage.refetch()} />;
  } else if (!data) {
    body = (
      <div aria-busy>
        <span className="sr-only" role="status">
          Loading analytics
        </span>
        <Skeleton aria-hidden className="h-80 w-full rounded-xl" />
      </div>
    );
  } else {
    const shown = periodsOf(from, to, by, data.dataThrough);
    const over =
      data.cycleSpentMicros !== null &&
      data.monthlyBudgetMicros > 0 &&
      data.cycleSpentMicros >= data.monthlyBudgetMicros;
    const resets = longDay(data.cycleResetsAt.slice(0, 10));
    body = (
      <div className="flex flex-col gap-6">
        {over && (
          <Alert variant="warning">
            <TriangleAlertIcon aria-hidden />
            <AlertTitle>Over this month’s AI allowance</AlertTitle>
            <AlertDescription>
              <p>{`Until it resets on ${resets}, with the next billing cycle:`}</p>
              <ul className="list-disc pl-5">
                <li>AI answers hand the question to a person.</li>
                <li>
                  Drafts, summaries, Ask and classification pause (an
                  escalation’s summary may use up to 10% more first).
                </li>
                <li>
                  Knowledge search and suggested articles carry on with keywords
                  only.
                </li>
                <li>New documents wait to be processed.</li>
              </ul>
              <p>Nothing extra is billed, and the model tier doesn’t change.</p>
            </AlertDescription>
          </Alert>
        )}
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,3fr)]">
          <Allowance data={data} over={over} resets={resets} />
          <StatTiles
            className="lg:grid-cols-3"
            tiles={[
              {
                label: 'Spend',
                value: aiMoney(data.totalCostMicros),
                counts: `${count(data.totalGenerations)} generations in the range`,
                help: 'What AI calls cost in the range, from the provider’s prices.',
              },
              data.draftAcceptance.rate == null
                ? {
                    label: 'Draft acceptance',
                    value: null,
                    counts: 'No drafts yet',
                    help: 'How often agents sent the AI’s draft without editing it.',
                  }
                : {
                    label: 'Draft acceptance',
                    value: percent(data.draftAcceptance.rate),
                    counts: `${count(data.draftAcceptance.numerator)} of ${count(data.draftAcceptance.denominator)} drafts sent as written`,
                    help: 'How often agents sent the AI’s draft without editing it.',
                  },
              data.emptyRetrievalRate.rate == null
                ? {
                    label: 'Answers that found no documents',
                    value: null,
                    counts: 'No answers yet',
                    help: 'Answers where search found nothing to cite.',
                  }
                : {
                    label: 'Answers that found no documents',
                    value: percent(data.emptyRetrievalRate.rate),
                    counts: `${count(data.emptyRetrievalRate.numerator)} of ${count(data.emptyRetrievalRate.denominator)} answers`,
                    help: 'Answers where search found nothing to cite.',
                  },
            ]}
          />
        </div>
        <Spend data={data} periods={shown} by={by} />
        <Purposes data={data} />
        <FullTable
          title="By purpose, in full"
          first="Purpose"
          slices={[...data.byPurpose].sort(
            (a, b) => b.costMicros - a.costMicros,
          )}
          name={(slice) => PURPOSE_WORDS[slice.purpose] ?? slice.purpose}
        />
        <FullTable
          title="By model"
          lead={tierSentence(data)}
          first="Model"
          slices={[...data.byModel].sort((a, b) => b.costMicros - a.costMicros)}
          name={(slice) => slice.modelName}
        />
      </div>
    );
  }

  return (
    <AnalyticsFrame
      section="ai-usage"
      filters={filters}
      departments={false}
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

function Allowance({
  data,
  over,
  resets,
}: {
  data: AiUsageResponseDto;
  over: boolean;
  resets: string;
}) {
  const spent = data.cycleSpentMicros;
  const used =
    spent === null || data.monthlyBudgetMicros === 0
      ? null
      : Math.round((spent / data.monthlyBudgetMicros) * 100);
  const tier = data.aiModelTier === 'QUALITY' ? 'Quality' : 'Fast';
  return (
    <section
      aria-labelledby="allowance-title"
      className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4"
    >
      <h2 id="allowance-title" className="font-semibold">
        This month’s AI allowance
      </h2>
      <p className="text-sm text-muted-foreground">
        {`${data.planName} plan · ${tier} model tier`}
      </p>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-2xl font-semibold tabular-nums">
          {spent === null
            ? `— of ${aiMoney(data.monthlyBudgetMicros)}`
            : `${aiMoney(spent)} of ${aiMoney(data.monthlyBudgetMicros)}`}
        </span>
        {used !== null && (
          <span
            className={cn(
              'text-xs text-muted-foreground',
              over && 'text-destructive',
            )}
          >
            {`${used}% used`}
          </span>
        )}
      </p>
      <Progress
        aria-label="This month’s AI allowance used"
        value={Math.min(used ?? 0, 100)}
        className={cn('h-2', over && '[&>*]:bg-destructive')}
      />
      <p
        className={cn(
          'flex items-start gap-1.5 text-sm',
          over ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {over && (
          <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        )}
        {spent === null
          ? `The spend couldn’t be read. The allowance resets on ${resets}.`
          : over
            ? `This month’s allowance is spent. It resets on ${resets}.`
            : `The allowance resets on ${resets}.`}
      </p>
    </section>
  );
}

function Spend({
  data,
  periods,
  by,
}: {
  data: AiUsageResponseDto;
  periods: Period[];
  by: Granularity;
}) {
  const values = valuesFor(
    periods,
    data.points,
    (p) => p.costMicros / 1_000_000,
    0,
  );
  const days = periods.reduce(
    (total, period) => total + (period.noData ? 0 : period.days),
    0,
  );
  const most = Math.max(0, ...values.filter((v): v is number => v !== null));
  const mostDays = periods
    .filter((_, index) => values[index] === most)
    .map((period) => period.from);
  const unit = UNIT[by];
  const summary =
    data.totalGenerations === 0
      ? 'No AI use in this period.'
      : `${aiMoney(data.totalCostMicros)} over ${days} days; the most on one ${unit} was ${aiMoney(most * 1_000_000)} (${daysText(mostDays)}).`;
  return (
    <ChartCard
      title={`Spend per ${unit}`}
      lead="In US dollars, from what each call cost."
      summary={summary}
      table={{
        columns: [PERIOD_COLUMN[by], 'Generations', 'Spend'],
        rows: periods
          .map((period, index) => {
            const point = data.points.find((p) => p.day === period.key);
            return [
              periodTitle(period, by),
              period.noData ? 'No data' : count(point?.generations ?? 0),
              period.noData
                ? 'No data'
                : aiMoney((values[index] ?? 0) * 1_000_000),
            ];
          })
          .reverse(),
      }}
    >
      <TimeChart
        title={`Spend per ${unit}`}
        kind="column"
        periods={periods}
        labels={periods.map((period) => periodLabel(period, by))}
        titles={periods.map((period) => periodTitle(period, by))}
        series={[{ name: 'Spend', color: 1, values }]}
        axis={(v) => aiMoney(v * 1_000_000)}
        value={(v) => aiMoney(v * 1_000_000)}
        empty={data.totalGenerations === 0 ? 'No AI use yet' : null}
      />
    </ChartCard>
  );
}

function Purposes({ data }: { data: AiUsageResponseDto }) {
  const slices = [...data.byPurpose].sort(
    (a, b) => b.costMicros - a.costMicros,
  );
  const total = data.totalCostMicros;
  const answering = slices
    .filter(
      (slice) => slice.purpose === 'CHAT_ANSWER' || slice.purpose === 'DRAFT',
    )
    .reduce((sum, slice) => sum + slice.costMicros, 0);
  const indexing =
    slices.find((slice) => slice.purpose === 'EMBEDDING')?.costMicros ?? 0;
  const indexingShare = total === 0 ? 0 : indexing / total;
  const summary =
    total === 0
      ? 'Nothing spent in this period.'
      : `Answers and reply drafts are ${percent(answering / total)} of the spend (${aiMoney(answering)} of ${aiMoney(total)}); search indexing is ${indexingShare < 0.01 ? 'under 1%' : percent(indexingShare)}.`;
  return (
    <ChartCard
      title="Where it goes: by purpose"
      lead="What the allowance is spent on, by cost. The table adds generations, tokens, latency and failures."
      summary={summary}
      table={{
        columns: [
          'Purpose',
          'Generations',
          'Tokens',
          'Cost',
          'Mean latency',
          'Failure rate',
        ],
        rows: slices.map((slice) => [
          PURPOSE_WORDS[slice.purpose] ?? slice.purpose,
          count(slice.generations),
          tokens(slice.promptTokens + slice.completionTokens),
          aiMoney(slice.costMicros),
          latency(slice),
          failures(slice.failureRate),
        ]),
      }}
    >
      <BarList
        rows={slices.map((slice) => ({
          label: PURPOSE_WORDS[slice.purpose] ?? slice.purpose,
          value: slice.costMicros,
          text: aiMoney(slice.costMicros),
        }))}
      />
    </ChartCard>
  );
}

/** "Quality tier: {model} writes answers, drafts, reviews and summaries; …". */
function tierSentence(data: AiUsageResponseDto): string | undefined {
  const writer = data.byPurpose.find(
    (slice) => slice.purpose === 'CHAT_ANSWER',
  )?.modelName;
  if (!writer) return undefined;
  const tier = data.aiModelTier === 'QUALITY' ? 'Quality' : 'Fast';
  return `${tier} tier: ${writer} writes answers, drafts, reviews and summaries; the cheaper models do the rest.`;
}

function FullTable({
  title,
  lead,
  first,
  slices,
  name,
}: {
  title: string;
  lead?: string;
  first: string;
  slices: AiUsageSliceResponseDto[];
  name: (slice: AiUsageSliceResponseDto) => string;
}) {
  return (
    <section
      aria-label={title}
      className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-5"
    >
      <div className="space-y-1">
        <h2 className="font-semibold">{title}</h2>
        {lead && <p className="text-sm text-muted-foreground">{lead}</p>}
      </div>
      {slices.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No AI use in this period.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <Table scrollLabel={title}>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>{first}</TableHead>
                {[
                  'Generations',
                  'Tokens',
                  'Cost',
                  'Mean latency',
                  'Failure rate',
                ].map((column) => (
                  <TableHead key={column} className="text-right">
                    {column}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {slices.map((slice) => (
                <TableRow key={`${slice.purpose}:${slice.modelName}`}>
                  <TableCell>{name(slice)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {count(slice.generations)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {tokens(slice.promptTokens + slice.completionTokens)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {aiMoney(slice.costMicros)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {latency(slice)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {failures(slice.failureRate)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
