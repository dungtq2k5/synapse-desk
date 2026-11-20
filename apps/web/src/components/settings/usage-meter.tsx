import type {
  OrganizationUsageResponseDto,
  UsageMeterResponseDto,
} from '@synapsedesk/api-client';
import {
  CircleAlertIcon,
  HardDriveIcon,
  SparklesIcon,
  TriangleAlertIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { dayDate, fileSize } from '@/lib/format';
import { cn } from '@/lib/utils';

/** How full a meter is: under 90%, from 90%, or full. */
export function meterLevel(
  used: number,
  limit: number,
): 'ok' | 'near' | 'full' {
  if (limit <= 0 || used >= limit) return 'full';
  return used / limit >= 0.9 ? 'near' : 'ok';
}

/**
 * One usage meter: its label, the numbers in words, an 8 px bar and a note.
 * At 90% the bar and note warn; when full they're destructive. A meter the
 * server couldn't read or doesn't have shows that in words, with no bar.
 */
export function UsageMeter({
  icon: Icon,
  label,
  noun,
  meter,
  amount,
  note,
  onRetry,
}: {
  icon: LucideIcon;
  label: string;
  /** "seat", "storage", "AI", for the unavailable sentences. */
  noun: 'seat' | 'storage' | 'AI';
  meter: UsageMeterResponseDto;
  /** The numbers in words: "18 of 20", "62% used". */
  amount: (used: number, limit: number) => string;
  /** Under the bar, by level: the note to show, if any. */
  note?: (
    used: number,
    limit: number,
    level: 'ok' | 'near' | 'full',
  ) => ReactNode;
  onRetry: () => void;
}) {
  const id = useId();
  const Noun = noun === 'AI' ? 'AI' : noun[0].toUpperCase() + noun.slice(1);

  if (!meter.available || meter.used === null || meter.limit === null) {
    const readFailed = meter.unavailableReason !== 'NOT_AVAILABLE';
    return (
      <div className="flex flex-col gap-2">
        <Heading icon={Icon} label={label} id={id}>
          {readFailed ? 'Couldn’t read it' : 'Not available'}
        </Heading>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {readFailed
              ? `Couldn’t read ${noun} use just now. Try again in a moment.`
              : `${Noun} usage isn’t available for this organization.`}
          </p>
          {readFailed && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      </div>
    );
  }

  const { used, limit } = meter;
  const level = meterLevel(used, limit);
  const words = amount(used, limit);
  const shown = note?.(used, limit, level);
  return (
    <div className="flex flex-col gap-2">
      <Heading icon={Icon} label={label} id={id}>
        {words}
      </Heading>
      <Progress
        value={limit > 0 ? Math.min(100, (used / limit) * 100) : 100}
        aria-labelledby={id}
        aria-valuetext={words}
        className={cn(
          'bg-muted',
          level === 'near' && '[&>*]:bg-warning',
          level === 'full' && '[&>*]:bg-destructive',
        )}
      />
      {shown && (
        <p
          className={cn(
            'flex items-start gap-1.5 text-sm',
            level === 'ok' && 'text-muted-foreground',
            level === 'near' && 'text-warning-subtle-foreground',
            level === 'full' && 'text-destructive',
          )}
        >
          {level === 'near' && (
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          )}
          {level === 'full' && (
            <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          )}
          <span>{shown}</span>
        </p>
      )}
    </div>
  );
}

function Heading({
  icon: Icon,
  label,
  id,
  children,
}: {
  icon: LucideIcon;
  label: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span id={id} className="flex items-center gap-2 font-medium">
        <Icon aria-hidden className="size-4 text-muted-foreground" />
        {label}
      </span>
      <span className="text-muted-foreground">{children}</span>
    </div>
  );
}

/**
 * The organization's three meters: seats, document storage and the AI
 * allowance. Organization shows them with their notes; Billing shows the
 * numbers alone, beside the plan.
 */
export function UsageMeters({
  usage,
  onRetry,
  withNotes = false,
}: {
  usage: OrganizationUsageResponseDto;
  onRetry: () => void;
  withNotes?: boolean;
}) {
  return (
    <>
      <UsageMeter
        icon={UsersIcon}
        label="Seats"
        noun="seat"
        meter={usage.seats}
        amount={(used, limit) => `${used} of ${limit}`}
        note={
          withNotes
            ? (used, limit, level) =>
                level === 'full'
                  ? 'No seats left. Revoke a pending invitation or change the plan to add people.'
                  : level === 'near'
                    ? `${limit - used} ${limit - used === 1 ? 'seat' : 'seats'} left. Pending invitations hold seats too.`
                    : null
            : undefined
        }
        onRetry={onRetry}
      />
      <UsageMeter
        icon={HardDriveIcon}
        label="Document storage"
        noun="storage"
        meter={usage.storage}
        amount={(used, limit) => `${fileSize(used)} of ${fileSize(limit)}`}
        onRetry={onRetry}
      />
      <UsageMeter
        icon={SparklesIcon}
        label="AI allowance"
        noun="AI"
        meter={usage.aiTokens}
        amount={(used, limit) =>
          `${limit > 0 ? Math.round((used / limit) * 100) : 100}% used`
        }
        note={
          withNotes
            ? () => `Resets with the billing cycle on ${nextCycle(usage)}.`
            : undefined
        }
        onRetry={onRetry}
      />
    </>
  );
}

/** When the AI allowance resets: the period's end, or a month from its start. */
function nextCycle(usage: OrganizationUsageResponseDto): string {
  if (usage.currentPeriodEnd) return dayDate(usage.currentPeriodEnd);
  const start = new Date(usage.billingCycleStart);
  start.setUTCMonth(start.getUTCMonth() + 1);
  return dayDate(start);
}
