'use client';

import { ChartLineIcon, TableIcon } from 'lucide-react';
import {
  type KeyboardEvent,
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { Period } from '@/lib/analytics';
import { announce } from '@/lib/toast';
import { cn } from '@/lib/utils';

/** A chart's series: its name and one value per period, null for no data. */
export type Series = {
  name: string;
  /** Its slot, 1–5, in the fixed categorical order. */
  color: 1 | 2 | 3 | 4 | 5;
  values: (number | null)[];
  /** The direct label at the line's end, when it differs from the name. */
  endLabel?: string;
};

const stroke = (slot: Series['color']) => `var(--chart-${slot})`;

/** The width a chart has to draw in, followed as its card resizes. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Round axis steps: the top of the scale and the gaps between gridlines.
 *
 * @example niceScale(19) // { max: 20, step: 5 }
 */
export function niceScale(
  max: number,
  ticks = 5,
): { max: number; step: number } {
  if (max <= 0) return { max: ticks, step: 1 };
  const raw = max / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ??
    10 * magnitude;
  return { max: Math.ceil(max / step) * step, step };
}

/** Which periods carry an axis label: about five, a week apart on a daily month. */
function labelled(
  count: number,
  daily: boolean,
  room: number,
  longest: number,
): number[] {
  // As many as fit, each as wide as the longest label: a week at a time on a
  // daily month, two weeks on a narrow plot.
  const most = Math.max(2, Math.floor(room / Math.max(64, longest * 6.5 + 16)));
  let every = count <= 8 ? 1 : daily && count <= 62 ? 7 : Math.ceil(count / 5);
  while (Math.ceil(count / every) > most) every += daily && every >= 7 ? 7 : 1;
  const result: number[] = [];
  for (let index = 0; index < count; index += every) result.push(index);
  return result;
}

type TimeChartProps = {
  /** Names the chart for the keyboard: "Volume". */
  title: string;
  periods: Period[];
  /** Each period's axis label. */
  labels: string[];
  /** Each period as the tooltip and the live region date it. */
  titles: string[];
  series: Series[];
  kind?: 'line' | 'column';
  height?: number;
  /** A fixed top for the scale (1 for a rate). */
  fixedMax?: number;
  /** An axis value in words: "75%", "2 h", "$0.30". */
  axis: (value: number) => string;
  /** A value in the tooltip. */
  value: (value: number) => string;
  /** When there's nothing to draw at all: the reason in words. */
  empty?: string | null;
  /** Leave room at the right for direct labels at line ends. */
  endLabels?: boolean;
};

const MARGIN = { top: 8, bottom: 24, left: 44 };

/**
 * A chart over time: lines (one per series) or columns (one series).
 *
 * The plot is drawn for the eye and hidden from assistive technology; its
 * text is the card's summary and table. The plot is one tab stop: ←/→ move a
 * period, Home/End jump to the ends, and a polite live region reads the
 * focused period. Days the job hasn't computed are a "No data" band and the
 * line breaks there; a period the range cuts short is dashed to a hollow
 * marker.
 */
export function TimeChart({
  title,
  periods,
  labels,
  titles,
  series,
  kind = 'line',
  height = 200,
  fixedMax,
  axis,
  value,
  empty,
  endLabels = kind === 'line',
}: TimeChartProps) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const count = periods.length;
  const right = endLabels ? 88 : 12;
  const plotWidth = Math.max(width - MARGIN.left - right, 10);
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  const highest = Math.max(
    0,
    ...series.flatMap((one) =>
      one.values.filter((v): v is number => v !== null),
    ),
  );
  const scale = fixedMax
    ? { max: fixedMax, step: fixedMax / 4 }
    : niceScale(highest);
  const slot =
    count > 0
      ? plotWidth / (kind === 'column' ? count : Math.max(count - 1, 1))
      : 0;
  const x = (index: number) =>
    MARGIN.left +
    (kind === 'column'
      ? slot * (index + 0.5)
      : count === 1
        ? plotWidth / 2
        : slot * index);
  const y = (v: number) =>
    MARGIN.top + plotHeight - (v / scale.max) * plotHeight;
  const ticks = Array.from(
    { length: Math.round(scale.max / scale.step) + 1 },
    (_, index) => index * scale.step,
  );

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (count === 0) return;
    const keys: Record<string, number> = {
      ArrowLeft: (active ?? count) - 1,
      ArrowRight: (active ?? -1) + 1,
      Home: 0,
      End: count - 1,
    };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const next = Math.min(Math.max(keys[event.key], 0), count - 1);
    setActive(next);
    announce(readout(next));
  };
  const readout = (index: number) =>
    `${titles[index]}: ${series
      .map((one) => {
        const v = one.values[index];
        return `${one.name.toLowerCase()} ${v === null ? 'no data' : value(v)}`;
      })
      .join(', ')}`;

  const bands = runs(periods.map((period) => period.noData));
  const nothing = empty ?? null;

  return (
    <div
      ref={ref}
      className="relative w-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-md"
      tabIndex={count > 0 && !nothing ? 0 : -1}
      role="group"
      aria-label={`${title}. Use the arrow keys to read each period.`}
      onKeyDown={move}
      onBlur={() => setActive(null)}
      onMouseLeave={() => setActive(null)}
      onMouseMove={(event) => {
        if (count === 0 || nothing) return;
        const box = event.currentTarget.getBoundingClientRect();
        const offset = event.clientX - box.left - MARGIN.left;
        const index =
          kind === 'column'
            ? Math.floor(offset / slot)
            : Math.round(offset / slot);
        setActive(Math.min(Math.max(index, 0), count - 1));
      }}
      style={{ height }}
    >
      {width > 0 && (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden
          className="block w-full overflow-visible"
          style={{ height }}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                x2={MARGIN.left + plotWidth}
                y1={y(tick)}
                y2={y(tick)}
                className="stroke-border"
              />
              <text
                x={MARGIN.left - 8}
                y={y(tick)}
                dy="0.32em"
                textAnchor="end"
                className="fill-muted-foreground text-xs"
              >
                {axis(tick)}
              </text>
            </g>
          ))}
          {bands.map(([start, end]) => {
            const half = kind === 'column' ? slot / 2 : slot / 2;
            const left = Math.max(x(start) - half, MARGIN.left);
            const rightEdge = Math.min(x(end) + half, MARGIN.left + plotWidth);
            return (
              <g key={start}>
                <rect
                  x={left}
                  y={MARGIN.top}
                  width={Math.max(rightEdge - left, 2)}
                  height={plotHeight}
                  className="fill-muted"
                />
                <text
                  x={(left + rightEdge) / 2}
                  y={MARGIN.top + 14}
                  textAnchor="middle"
                  className="fill-muted-foreground text-xs"
                >
                  No data
                </text>
              </g>
            );
          })}
          {labelled(
            count,
            periods[0]?.to === periods[0]?.from,
            plotWidth,
            Math.max(0, ...labels.map((label) => label.length)),
          ).map((index) => (
            <text
              key={index}
              x={x(index)}
              y={height - 6}
              textAnchor={
                kind === 'line' && count > 1 && index === 0
                  ? 'start'
                  : kind === 'line' && count > 1 && index === count - 1
                    ? 'end'
                    : 'middle'
              }
              className="fill-muted-foreground text-xs"
            >
              {labels[index]}
            </text>
          ))}
          {!nothing &&
            (kind === 'column'
              ? series
                  .slice(0, 1)
                  .map((one) =>
                    one.values.map((v, index) =>
                      v === null || v <= 0 ? null : (
                        <path
                          key={index}
                          d={column(
                            x(index),
                            y(v),
                            Math.max(slot - 2, 1),
                            y(0),
                          )}
                          style={{ fill: stroke(one.color) }}
                        />
                      ),
                    ),
                  )
              : series.map((one) => (
                  <Line
                    key={one.name}
                    series={one}
                    periods={periods}
                    x={x}
                    y={y}
                    dots={count <= 12}
                  />
                )))}
          {!nothing && endLabels && kind === 'line' && (
            <EndLabels series={series} x={x} y={y} />
          )}
          {active !== null && !nothing && (
            <g>
              <line
                x1={x(active)}
                x2={x(active)}
                y1={MARGIN.top}
                y2={MARGIN.top + plotHeight}
                className="stroke-muted-foreground"
              />
              {kind === 'line' &&
                series.map((one) => {
                  const v = one.values[active];
                  return v === null ? null : (
                    <circle
                      key={one.name}
                      cx={x(active)}
                      cy={y(v)}
                      r={4}
                      className="stroke-card"
                      strokeWidth={2}
                      style={{ fill: stroke(one.color) }}
                    />
                  );
                })}
            </g>
          )}
        </svg>
      )}
      {nothing && (
        // Over the plot, outside the hidden drawing, so it's read out.
        <p
          className="absolute flex items-center justify-center text-sm text-muted-foreground"
          style={{
            left: MARGIN.left,
            right,
            top: MARGIN.top,
            bottom: MARGIN.bottom,
          }}
        >
          <span className="bg-card px-2">{nothing}</span>
        </p>
      )}
      {active !== null && !nothing && width > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow-md"
          style={
            x(active) > width / 2
              ? { right: width - x(active) + 12 }
              : { left: x(active) + 12 }
          }
        >
          <p className="mb-1 font-medium">{titles[active]}</p>
          {series.map((one) => {
            const v = one.values[active];
            return (
              <p key={one.name} className="flex items-center gap-2">
                <Swatch color={one.color} kind={kind} />
                <span className="text-muted-foreground">{one.name}</span>
                <span className="ml-auto tabular-nums">
                  {v === null ? 'No data' : value(v)}
                </span>
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A column with a 2 px rounded top. */
function column(
  center: number,
  top: number,
  width: number,
  bottom: number,
): string {
  const left = center - width / 2;
  const r = Math.min(2, width / 2, bottom - top);
  return `M${left},${bottom}V${top + r}Q${left},${top} ${left + r},${top}H${left + width - r}Q${left + width},${top} ${left + width},${top + r}V${bottom}Z`;
}

/** Runs of true, as [first, last] index pairs. */
function runs(flags: boolean[]): [number, number][] {
  const result: [number, number][] = [];
  flags.forEach((flag, index) => {
    if (!flag) return;
    const last = result.at(-1);
    if (last && last[1] === index - 1) last[1] = index;
    else result.push([index, index]);
  });
  return result;
}

function Line({
  series,
  periods,
  x,
  y,
  dots,
}: {
  series: Series;
  periods: Period[];
  x: (index: number) => number;
  y: (value: number) => number;
  dots: boolean;
}) {
  const color = stroke(series.color);
  const { values } = series;
  // Consecutive pairs of values, joined into runs; a pair touching a period
  // the range cuts short is dashed.
  const pieces: { d: string; dashed: boolean; end: number }[] = [];
  for (let index = 1; index < values.length; index++) {
    const a = values[index - 1];
    const b = values[index];
    if (a === null || b === null) continue;
    const dashed = periods[index].partial || periods[index - 1].partial;
    const step = `L${x(index)},${y(b)}`;
    const previous = pieces.at(-1);
    if (previous && previous.dashed === dashed && previous.end === index - 1) {
      previous.d += step;
      previous.end = index;
    } else {
      pieces.push({ d: `M${x(index - 1)},${y(a)}${step}`, dashed, end: index });
    }
  }
  const alone = (index: number) =>
    values[index] !== null &&
    (values[index - 1] ?? null) === null &&
    (values[index + 1] ?? null) === null;
  const last = series.values.findLastIndex((v) => v !== null);

  return (
    <g
      fill="none"
      style={{ stroke: color }}
      strokeWidth={2}
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      {pieces.map((piece) => (
        <path
          key={piece.d}
          d={piece.d}
          strokeDasharray={piece.dashed ? '4 3' : undefined}
        />
      ))}
      {series.values.map((v, index) => {
        if (v === null) return null;
        const partial = periods[index].partial;
        const end = index === last;
        if (!dots && !end && !partial && !alone(index)) return null;
        return (
          <circle
            key={index}
            cx={x(index)}
            cy={y(v)}
            r={end ? 4 : 3}
            className={partial ? 'fill-card' : 'stroke-card'}
            strokeWidth={partial ? 2 : end ? 2 : 0}
            style={partial ? { stroke: color } : { fill: color }}
          />
        );
      })}
    </g>
  );
}

/** Names at the lines' ends, nudged apart so they never overlap. */
function EndLabels({
  series,
  x,
  y,
}: {
  series: Series[];
  x: (index: number) => number;
  y: (value: number) => number;
}) {
  const placed = series
    .map((one) => {
      const index = one.values.findLastIndex((v) => v !== null);
      return index < 0
        ? null
        : {
            text: one.endLabel ?? one.name,
            // At the plot's edge, past any no-data band at the end.
            x: x(one.values.length - 1) + 10,
            y: y(one.values[index] ?? 0),
          };
    })
    .filter(
      (one): one is { text: string; x: number; y: number } => one !== null,
    )
    .sort((a, b) => a.y - b.y);
  for (let index = 1; index < placed.length; index++) {
    placed[index].y = Math.max(placed[index].y, placed[index - 1].y + 16);
  }
  return (
    <g>
      {placed.map((label) => (
        <text
          key={label.text}
          x={label.x}
          y={label.y}
          dy="0.32em"
          className="fill-foreground text-xs"
        >
          {label.text}
        </text>
      ))}
    </g>
  );
}

function Swatch({
  color,
  kind,
}: {
  color: Series['color'];
  kind: 'line' | 'column';
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block shrink-0',
        kind === 'line' ? 'h-0.5 w-3' : 'size-2.5 rounded-sm',
      )}
      style={{ background: stroke(color) }}
    />
  );
}

/** The legend: for two or more series, never one. */
export function Legend({
  series,
  kind = 'line',
}: {
  series: Series[];
  kind?: 'line' | 'column';
}) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Legend">
      {series.map((one) => (
        <li key={one.name} className="flex items-center gap-2">
          <Swatch color={one.color} kind={kind} />
          {one.name}
        </li>
      ))}
    </ul>
  );
}

/** A breakdown: label, bar, and the value as text. */
export function BarList({
  rows,
  color = 1,
}: {
  rows: { label: string; value: number; text: string }[];
  color?: Series['color'];
}) {
  const highest = Math.max(1, ...rows.map((row) => row.value));
  return (
    <dl className="grid grid-cols-[minmax(6rem,auto)_1fr_auto] items-center gap-x-3 gap-y-2 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt>{row.label}</dt>
          <div aria-hidden className="h-2">
            <div
              className="h-2 rounded-r-sm"
              style={{
                width: `${Math.max((row.value / highest) * 100, row.value > 0 ? 1 : 0)}%`,
                background: stroke(color),
              }}
            />
          </div>
          <dd className="text-right tabular-nums">{row.text}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The table a chart's Table view holds: one row per period, newest first. */
export type ChartTable = { columns: string[]; rows: string[][] };

/**
 * A chart's card: its title and lead, Chart / Table, the legend, the plot or
 * the table, and the summary sentence that is the chart's text equivalent.
 */
export function ChartCard({
  title,
  lead,
  summary,
  legend,
  table,
  children,
  className,
  headingLevel = 'h2',
}: {
  title: string;
  lead: string;
  summary: ReactNode;
  legend?: ReactNode;
  table: ChartTable;
  children: ReactNode;
  className?: string;
  headingLevel?: 'h2' | 'h3';
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const Heading = headingLevel;
  const captionId = useId();
  return (
    <figure
      aria-labelledby={`${captionId}-title`}
      className={cn(
        'flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground md:p-5',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Heading id={`${captionId}-title`} className="min-w-0 font-semibold">
          {title}
        </Heading>
        <ToggleGroup
          type="single"
          aria-label={`View ${title.toLowerCase()} as`}
          value={view}
          onValueChange={(next) => {
            if (next === 'chart' || next === 'table') setView(next);
          }}
          className="rounded-lg bg-muted p-1"
        >
          <ToggleGroupItem
            value="chart"
            size="sm"
            className="gap-1.5 px-2.5 data-[state=on]:bg-background data-[state=on]:shadow-sm"
          >
            <ChartLineIcon aria-hidden />
            Chart
          </ToggleGroupItem>
          <ToggleGroupItem
            value="table"
            size="sm"
            className="gap-1.5 px-2.5 data-[state=on]:bg-background data-[state=on]:shadow-sm"
          >
            <TableIcon aria-hidden />
            Table
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <p className="-mt-3 text-sm text-muted-foreground">{lead}</p>
      {view === 'chart' ? (
        <>
          {legend}
          {children}
        </>
      ) : (
        <Table
          scrollLabel={`${title} as a table`}
          containerClassName="max-h-80 overflow-auto rounded-md border"
        >
          <TableHeader className="sticky top-0 bg-card">
            <TableRow>
              {table.columns.map((column, index) => (
                <TableHead
                  key={column}
                  className={index > 0 ? 'text-right' : undefined}
                >
                  {column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.rows.map((row) => (
              <TableRow key={row[0]}>
                {row.map((cell, index) => (
                  <TableCell
                    key={index}
                    className={
                      index > 0 ? 'text-right tabular-nums' : undefined
                    }
                  >
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <figcaption className="text-sm text-muted-foreground">
        {summary}
      </figcaption>
    </figure>
  );
}

/** A chart that's loading: a skeleton the shape of the card. */
export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div aria-hidden className="space-y-3 rounded-xl border bg-card p-5">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="w-full" style={{ height }} />
    </div>
  );
}
