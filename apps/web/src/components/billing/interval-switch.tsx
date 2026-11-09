'use client';

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { Interval } from '@/lib/billing';
import { announce } from '@/lib/toast';
import { cn } from '@/lib/utils';

const ITEM = 'flex-1 data-[state=on]:bg-background data-[state=on]:shadow-sm';

/**
 * Monthly or Yearly, for a plan list: Billing's and the landing page's
 * pricing. Labelled "Billing interval", and a change is announced.
 *
 * @example <IntervalSwitch value={interval} onValueChange={setInterval} />
 */
export function IntervalSwitch({
  value,
  onValueChange,
  className,
}: {
  value: Interval;
  onValueChange: (value: Interval) => void;
  className?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      aria-label="Billing interval"
      value={value}
      onValueChange={(next) => {
        if (next !== 'month' && next !== 'year') return;
        onValueChange(next);
        announce(
          next === 'year' ? 'Showing yearly prices' : 'Showing monthly prices',
        );
      }}
      className={cn('w-full rounded-lg bg-muted p-1 sm:w-50', className)}
    >
      <ToggleGroupItem value="month" className={ITEM}>
        Monthly
      </ToggleGroupItem>
      <ToggleGroupItem value="year" className={ITEM}>
        Yearly
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
