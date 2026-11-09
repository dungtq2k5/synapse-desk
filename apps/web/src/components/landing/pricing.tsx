import {
  publicPlansControllerListPublicPlansV1,
  type TenantPlanResponseDto,
} from '@synapsedesk/api-client';
import Link from 'next/link';
import { Suspense } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { publicFetcher } from '@/server/public-fetcher';
import { PricingCards } from './pricing-cards';
import { SectionHeader } from './section-header';

/** Seconds the public price list is kept between reads, across every visitor. */
const REVALIDATE = 300;

const DEMO_LINE =
  'This is a demo: payments run in Stripe’s test mode, with the test card 4242 4242 4242 4242.';

/**
 * Pricing: Free and the plans anyone can buy, read on the server without the
 * visitor's cookies and cached for five minutes. The section streams in after
 * the hero; its skeletons are the real loading state. A failed read shows the
 * "unavailable" card and is retried on the next render.
 */
export function Pricing({
  state,
  only,
}: {
  /** Test pages only: hold the section in its loading or unavailable state. */
  state?: 'loading' | 'unavailable';
  /** Test pages only: show just these plans, by name, of what the read returns. */
  only?: readonly string[];
}) {
  return (
    <section
      id="pricing"
      aria-labelledby="pricing-title"
      className="scroll-mt-14 px-4 py-16 md:scroll-mt-16 md:py-24 xl:px-0"
    >
      <div className="mx-auto max-w-300">
        <SectionHeader
          id="pricing-title"
          title="Pricing"
          lead="Start on Free. Change your plan in Billing whenever you need more."
        />
        {state === 'loading' ? (
          <Loading />
        ) : state === 'unavailable' ? (
          <Unavailable />
        ) : (
          <Suspense fallback={<Loading />}>
            <Plans only={only} />
          </Suspense>
        )}
      </div>
    </section>
  );
}

async function Plans({ only }: { only?: readonly string[] }) {
  let plans: TenantPlanResponseDto[];
  try {
    const response = await publicPlansControllerListPublicPlansV1({
      fetcher: publicFetcher(REVALIDATE),
    });
    plans = (response.data ?? []).filter(
      (plan) => !only || only.includes(plan.name),
    );
  } catch {
    return <Unavailable />;
  }
  if (plans.length === 0) return <Unavailable />;

  return (
    <>
      <PricingCards plans={plans} />
      <p className="mt-10 text-sm text-muted-foreground">{DEMO_LINE}</p>
    </>
  );
}

/** A skeleton card per plan, in the cards' shape, under the switch. */
function Loading() {
  return (
    <div className="mt-10">
      <p role="status" className="sr-only">
        Loading plans
      </p>
      <div aria-hidden="true" className="flex h-9 w-38 rounded-lg bg-muted p-1">
        <span className="flex-1 rounded-md bg-background shadow-sm" />
        <span className="flex-1" />
      </div>
      <div
        aria-hidden="true"
        className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4"
      >
        {[4, 7, 7, 7].map((lines, card) => (
          <div key={card} className="flex flex-col gap-3 rounded-xl border p-6">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-8 w-36" />
            {Array.from({ length: lines }, (_, line) => (
              <Skeleton key={line} className="h-4 w-full" />
            ))}
            <Skeleton className="mt-auto h-9 w-full" />
          </div>
        ))}
      </div>
      <p className="mt-10 text-sm text-muted-foreground">{DEMO_LINE}</p>
    </div>
  );
}

/** The plans couldn't be read: the heading stays, with one card and Start free. */
function Unavailable() {
  return (
    <div className="mt-10 flex max-w-150 flex-col items-start gap-4 rounded-xl border p-6">
      <p className="text-sm">
        The plans couldn’t be loaded just now. You’ll see them after you sign
        up.
      </p>
      <Link href="/sign-up" className={buttonVariants({ size: 'sm' })}>
        Start free
      </Link>
    </div>
  );
}
