import { LoaderCircleIcon, type LucideProps } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The app's one "working" icon: a loader circle that turns, unless the
 * viewer asks for reduced motion. The words beside it ("Saving…",
 * "Processing") say it's working either way.
 *
 * @example <Spinner className="size-4" />
 */
export function Spinner({ className, ...props }: LucideProps) {
  return (
    <LoaderCircleIcon
      aria-hidden
      {...props}
      className={cn('motion-safe:animate-spin', className)}
    />
  );
}
