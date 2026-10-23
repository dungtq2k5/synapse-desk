import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

/**
 * A page the viewer may not open, or an item that isn't there: design 07's
 * words, so the two can't be told apart. The way back is the area's home.
 *
 * @example <PageUnavailable back={{ href: '/settings', label: 'Settings' }} />
 */
export function PageUnavailable({
  back,
}: {
  back: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
      <h1 className="text-lg font-semibold">This page isn’t available</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        It doesn’t exist, or it isn’t shared with you.
      </p>
      <Link
        href={back.href}
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
      >
        Back to {back.label}
      </Link>
    </div>
  );
}
