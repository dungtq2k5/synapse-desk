'use client';

import {
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LockIcon,
} from 'lucide-react';
import Link from 'next/link';
import { type KeyboardEvent, type ReactNode, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { addDays, presets, rangeText, spanDays } from '@/lib/analytics';
import { cn } from '@/lib/utils';

type Range = { from: string; to: string };

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** The six-week grid a month is drawn in, Sunday first. */
function monthGrid(month: string): string[] {
  const first = `${month}-01`;
  const weekday = new Date(`${first}T00:00:00.000Z`).getUTCDay();
  const start = addDays(first, -weekday);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

const monthTitle = (month: string) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00.000Z`));

const shiftMonth = (month: string, by: number) => {
  const date = new Date(`${month}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + by);
  return date.toISOString().slice(0, 7);
};

/**
 * The date range button and its picker: presets on the left (a listbox), one
 * month on the right, then the plan's line and Cancel / Apply. Under 768 px
 * it opens as a sheet from the bottom.
 *
 * A preset or a range past the plan's limit is shown, unavailable, with the
 * limit sentence as its description, so it stays reachable and says why.
 */
export function RangePicker({
  value,
  limit,
  today,
  billing,
  onApply,
}: {
  value: Range;
  limit: number;
  today: string;
  /** The reader may open Billing (`organization.read`). */
  billing: boolean;
  onApply: (range: Range) => void;
}) {
  const [open, setOpen] = useState(false);
  const mobile = useIsMobile();
  const trigger = (
    <Button variant="outline" className="w-full justify-start gap-2 md:w-auto">
      <CalendarIcon aria-hidden />
      <span className="truncate">{rangeText(value.from, value.to)}</span>
      <ChevronDownIcon aria-hidden className="ml-auto opacity-60" />
    </Button>
  );
  const body = open && (
    <PickerBody
      key={`${value.from}:${value.to}`}
      value={value}
      limit={limit}
      today={today}
      billing={billing}
      onCancel={() => setOpen(false)}
      onApply={(range) => {
        setOpen(false);
        onApply(range);
      }}
    />
  );

  if (mobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent
          side="bottom"
          className="max-h-[90vh] overflow-y-auto p-4"
        >
          <SheetTitle className="sr-only">Date range</SheetTitle>
          {body}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent aria-label="Date range" className="w-auto">
        {body}
      </PopoverContent>
    </Popover>
  );
}

function PickerBody({
  value,
  limit,
  today,
  billing,
  onCancel,
  onApply,
}: {
  value: Range;
  limit: number;
  today: string;
  billing: boolean;
  onCancel: () => void;
  onApply: (range: Range) => void;
}) {
  const [start, setStart] = useState(value.from);
  const [end, setEnd] = useState<string | null>(value.to);
  const [month, setMonth] = useState(value.to.slice(0, 7));
  const limitLine = `Your plan shows up to ${limit} days at a time.`;
  const options = presets(today, limit);
  const chosen = options.find(
    (preset) => preset.from === start && preset.to === end,
  );

  const pick = (day: string) => {
    if (end === null && day >= start) {
      setEnd(day);
      return;
    }
    setStart(day);
    setEnd(null);
  };
  /** A day the picker won't take: in the future, or past the limit from the start. */
  const blocked = (day: string) =>
    day > today ||
    (end === null && day > start && spanDays(start, day) > limit);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 md:flex-row">
        <ul
          role="listbox"
          aria-label="Presets"
          className="flex min-w-44 flex-col gap-0.5 md:border-r md:pr-3"
        >
          {options.map((preset) => (
            <li
              key={preset.label}
              role="option"
              aria-selected={chosen?.label === preset.label}
              aria-disabled={preset.locked || undefined}
              aria-describedby={preset.locked ? 'range-limit' : undefined}
              tabIndex={0}
              onClick={() => {
                if (preset.locked) return;
                setStart(preset.from);
                setEnd(preset.to);
                setMonth(preset.to.slice(0, 7));
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                event.currentTarget.click();
              }}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                chosen?.label === preset.label &&
                  'bg-accent text-accent-foreground',
                preset.locked && 'cursor-default text-muted-foreground',
              )}
            >
              {preset.label}
              {preset.locked ? (
                <LockIcon aria-hidden className="size-4" />
              ) : chosen?.label === preset.label ? (
                <CheckIcon aria-hidden className="size-4" />
              ) : null}
            </li>
          ))}
        </ul>
        <Month
          month={month}
          start={start}
          end={end}
          today={today}
          blocked={blocked}
          onMonth={setMonth}
          onPick={pick}
        />
      </div>
      <div className="flex flex-col gap-3 border-t pt-3">
        {options.some((preset) => preset.locked) && (
          <p id="range-limit" className="flex items-start gap-2 text-sm">
            <LockIcon
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            />
            <span>
              {limitLine}
              {billing && (
                <>
                  {' '}
                  <Link
                    href="/settings/billing"
                    className="text-primary underline underline-offset-4"
                  >
                    See plans in Billing
                  </Link>
                </>
              )}
            </span>
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={end === null}
            onClick={() => {
              if (end !== null) onApply({ from: start, to: end });
            }}
          >
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}

function Month({
  month,
  start,
  end,
  today,
  blocked,
  onMonth,
  onPick,
}: {
  month: string;
  start: string;
  end: string | null;
  today: string;
  blocked: (day: string) => boolean;
  onMonth: (month: string) => void;
  onPick: (day: string) => void;
}) {
  const days = monthGrid(month);
  const grid = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(end ?? start);
  const focusable = days.includes(focus) ? focus : `${month}-01`;

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    if (!(event.key in steps)) return;
    event.preventDefault();
    const next = addDays(focusable, steps[event.key]);
    setFocus(next);
    if (next.slice(0, 7) !== month) onMonth(next.slice(0, 7));
    requestAnimationFrame(() =>
      grid.current
        ?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)
        ?.focus(),
    );
  };

  const nav = (label: string, by: number, icon: ReactNode) => (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      onClick={() => onMonth(shiftMonth(month, by))}
      disabled={by > 0 && shiftMonth(month, 1) > today.slice(0, 7)}
    >
      {icon}
    </Button>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {nav('Previous month', -1, <ChevronLeftIcon aria-hidden />)}
        <p className="text-sm font-medium" aria-live="polite">
          {monthTitle(month)}
        </p>
        {nav('Next month', 1, <ChevronRightIcon aria-hidden />)}
      </div>
      <div
        ref={grid}
        role="group"
        aria-label={monthTitle(month)}
        onKeyDown={move}
        className="grid grid-cols-7 gap-0.5"
      >
        {WEEKDAYS.map((day) => (
          <span
            key={day}
            aria-hidden
            className="py-1 text-center text-xs text-muted-foreground"
          >
            {day}
          </span>
        ))}
        {days.map((day) => {
          const inMonth = day.slice(0, 7) === month;
          const isEnd = day === start || day === end;
          const inRange = end !== null && day > start && day < end;
          const off = blocked(day);
          return (
            <button
              key={day}
              type="button"
              data-day={day}
              tabIndex={day === focusable ? 0 : -1}
              aria-pressed={isEnd || inRange}
              aria-disabled={off || undefined}
              aria-label={new Intl.DateTimeFormat('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                timeZone: 'UTC',
              }).format(new Date(`${day}T00:00:00.000Z`))}
              onClick={() => {
                setFocus(day);
                if (!off) onPick(day);
              }}
              className={cn(
                'size-9 rounded-md text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                !inMonth && 'text-muted-foreground',
                inRange && 'bg-accent text-accent-foreground',
                isEnd && 'bg-primary text-primary-foreground',
                off && 'cursor-default text-muted-foreground opacity-60',
              )}
            >
              {Number(day.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
