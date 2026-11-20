import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * The SynapseDesk lockup in the current theme: two images, one shown per
 * mode, so the right one paints before any script runs.
 */
export function Lockup({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex', className)}>
      <Image
        src="/lockup-light.svg"
        alt="SynapseDesk"
        width={145}
        height={24}
        unoptimized
        priority
        className="dark:hidden"
      />
      <Image
        src="/lockup-dark.svg"
        alt="SynapseDesk"
        width={145}
        height={24}
        unoptimized
        priority
        className="hidden dark:block"
      />
    </span>
  );
}
