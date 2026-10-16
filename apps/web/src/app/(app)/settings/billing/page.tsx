import { CreditCardIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AppHeader } from '@/components/shell/app-header';
import { buttonVariants } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Billing · SynapseDesk' };

/**
 * Where usage and billing notifications lead (`/settings/billing`), until the
 * billing page is built here: a page in the shell that says so, not a 404.
 */
export default function BillingPage() {
  return (
    <>
      <AppHeader crumbs={[{ label: 'Billing' }]} />
      <main id="main" tabIndex={-1} className="p-4 outline-none md:p-6">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
          <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <CreditCardIcon aria-hidden className="size-5" />
          </div>
          <h1 className="text-lg font-semibold">
            Billing isn’t available here yet
          </h1>
          <Link
            href="/notifications"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Back to notifications
          </Link>
        </div>
      </main>
    </>
  );
}
