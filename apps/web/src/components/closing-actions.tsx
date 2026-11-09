import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The actions that close a form, a card or a row: a full-width row whose
 * buttons sit on the left on a phone and on the right from `md`. One place
 * for the rule, so every form follows it the same way.
 *
 * @example <ClosingActions><Button type="submit">Save</Button></ClosingActions>
 */
export function ClosingActions({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-slot="closing-actions"
      className={cn('flex flex-wrap gap-2 md:justify-end', className)}
    >
      {children}
    </div>
  );
}
