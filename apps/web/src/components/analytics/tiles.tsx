'use client';

import {
  ArrowDownIcon,
  ArrowUpIcon,
  CircleHelpIcon,
  InfoIcon,
  MinusIcon,
  RotateCwIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { daysText, direction } from '@/lib/analytics';
import { cn } from '@/lib/utils';

export type Tile = {
  label: string;
  /** The headline, or null for "—" with a reason. */
  value: string | null;
  /** The counts line, or the reason when there's no value. */
  counts: string;
  /** The change against the window before, in words. */
  change?: string | null;
  help?: string;
};

/**
 * Stat tiles: a `dl`, each label the `dt` and its value and counts the `dd`.
 * The change line is neutral (muted, with a decorative arrow): up isn't
 * always good.
 */
export function StatTiles({
  tiles,
  className,
}: {
  tiles: Tile[];
  className?: string;
}) {
  return (
    <dl className={cn('grid grid-cols-2 gap-3 lg:grid-cols-4', className)}>
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-4 text-card-foreground"
        >
          <dt className="flex items-start justify-between gap-2 text-sm">
            {tile.label}
            {tile.help && (
              <Tooltip>
                <TooltipTrigger
                  aria-label={`About ${tile.label.toLowerCase()}`}
                  className="shrink-0 rounded-full text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <CircleHelpIcon aria-hidden className="size-4" />
                </TooltipTrigger>
                <TooltipContent className="max-w-60">
                  {tile.help}
                </TooltipContent>
              </Tooltip>
            )}
          </dt>
          <dd className="flex flex-col gap-1">
            <span
              className={cn(
                'text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl',
                tile.value === null && 'text-muted-foreground',
              )}
            >
              {tile.value ?? '—'}
            </span>
            <span className="text-sm text-muted-foreground">{tile.counts}</span>
            {tile.change && <Change line={tile.change} />}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Change({ line }: { line: string }) {
  const way = direction(line);
  const Icon =
    way === 'up' ? ArrowUpIcon : way === 'down' ? ArrowDownIcon : MinusIcon;
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Icon aria-hidden className="size-3" />
      {line}
    </span>
  );
}

/** Tiles that are loading: skeletons in their shape, said once by the page. */
export function TileSkeletons({ count }: { count: number }) {
  return (
    <div aria-hidden className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="space-y-3 rounded-xl border bg-card p-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

/** The page's freshness alerts: not computed yet, or days with no data. */
export function FreshnessAlert({
  computed,
  missingDays,
  totalDays,
}: {
  computed: boolean;
  /** The range's days after `dataThrough`. */
  missingDays: string[];
  totalDays: number;
}): ReactNode {
  if (!computed) {
    return (
      <Alert variant="warning">
        <TriangleAlertIcon aria-hidden />
        <AlertTitle>Analytics haven’t been computed yet</AlertTitle>
        <AlertDescription>
          Numbers are computed once a day, overnight. The first ones appear
          after the next run; nothing is missing.
        </AlertDescription>
      </Alert>
    );
  }
  if (missingDays.length === 0) return null;
  return (
    <Alert variant="info">
      <InfoIcon aria-hidden />
      <AlertTitle>{`No data for ${daysText(missingDays)}`}</AlertTitle>
      <AlertDescription>
        {`Those days weren’t computed, so they’re left blank rather than drawn as zero. The totals cover the other ${totalDays - missingDays.length} days.`}
      </AlertDescription>
    </Alert>
  );
}

/** A block that couldn't be read: it keeps its title; the rest renders. */
export function Unavailable({
  title,
  what,
  onRetry,
}: {
  title: string;
  /** "The open flags couldn’t be read". */
  what: string;
  onRetry: () => void;
}) {
  return (
    <section
      className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-5"
      aria-label={title}
    >
      <h2 className="font-semibold">{title}</h2>
      <Alert variant="warning">
        <TriangleAlertIcon aria-hidden />
        <AlertTitle>{what}</AlertTitle>
        <AlertDescription>
          <p>The rest of the page is up to date. Try again in a few minutes.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={onRetry}
          >
            <RotateCwIcon aria-hidden />
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    </section>
  );
}
