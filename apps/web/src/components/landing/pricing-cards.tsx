'use client';

import type { TenantPlanResponseDto } from '@synapsedesk/api-client';
import { CheckIcon } from 'lucide-react';
import Link from 'next/link';
import { useId, useState } from 'react';
import { IntervalSwitch } from '@/components/billing/interval-switch';
import { buttonVariants } from '@/components/ui/button';
import { grantLines, type Interval, money, per, priceAt } from '@/lib/billing';
import { cn } from '@/lib/utils';

/** Where Choose {plan} sends a visitor: sign-up, then Billing with that plan picked out. */
export function chooseHref(planId: string): string {
  const next = `/settings/billing?choose=${encodeURIComponent(planId)}`;
  return `/sign-up?next=${encodeURIComponent(next)}`;
}

/** Free has no price: the plan everyone starts on. */
const isFree = (plan: TenantPlanResponseDto) => plan.prices.length === 0;

/**
 * The plans as a visitor sees them (Billing's card, for a visitor): the
 * name, the price and its interval, the grant lines with checks, and one
 * full-width button. Free shows its first four lines, as Billing does.
 * Monthly by default; Yearly swaps the amounts. The cards are the same height.
 */
export function PricingCards({ plans }: { plans: TenantPlanResponseDto[] }) {
  const [interval, setInterval] = useState<Interval>('month');

  return (
    <div className="mt-10">
      {/* 150 px at both widths, as the landing frames draw it. */}
      <IntervalSwitch
        value={interval}
        onValueChange={setInterval}
        className="w-38 sm:w-38"
      />
      <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} interval={interval} />
        ))}
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  interval,
}: {
  plan: TenantPlanResponseDto;
  interval: Interval;
}) {
  const headingId = useId();
  const free = isFree(plan);
  const price = priceAt(plan, interval);
  const lines = grantLines(plan);

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-xl border bg-card p-6 text-card-foreground"
    >
      <h3 id={headingId} className="text-base font-semibold">
        {plan.name}
      </h3>
      {free ? (
        <p className="text-sm text-muted-foreground">No card needed</p>
      ) : (
        <p className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold">
            {price && price.unitAmount !== null && price.currency
              ? money(price.unitAmount, price.currency)
              : '—'}
          </span>
          <span className="text-sm text-muted-foreground">{per(interval)}</span>
        </p>
      )}
      <ul className="flex flex-col gap-2 text-sm">
        {(free ? lines.slice(0, 4) : lines).map((line) => (
          <li key={line} className="flex items-start gap-2">
            <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            {line}
          </li>
        ))}
      </ul>
      <Link
        href={free ? '/sign-up' : chooseHref(plan.id)}
        className={cn(
          buttonVariants({ variant: free ? 'default' : 'outline' }),
          'mt-auto w-full',
        )}
      >
        {free ? 'Start free' : `Choose ${plan.name}`}
      </Link>
    </section>
  );
}
