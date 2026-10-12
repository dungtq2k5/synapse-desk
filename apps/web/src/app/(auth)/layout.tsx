import type { ReactNode } from 'react';
import { Lockup } from '@/components/brand/lockup';

/** The sign-in screens: the lockup, then one narrow column. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-svh flex-col items-center gap-8 px-4 py-12 md:py-20">
      <Lockup />
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
