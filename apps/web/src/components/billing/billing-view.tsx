'use client';

import {
  getBillingControllerGetSubscriptionV1QueryKey,
  useBillingControllerGetSubscriptionV1,
  useBillingControllerListInvoicesV1,
  useBillingControllerListPlansV1,
  useDocumentsControllerStorageUsageV1,
  useOrganizationsControllerGetUsageV1,
  useOrganizationsControllerGetV1,
  type InvoiceResponseDto,
  type OverLimit,
  type PlanChangeResponseDto,
  type SubscriptionResponseDto,
  type TenantPlanResponseDto,
} from '@synapsedesk/api-client';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  ClockIcon,
  ExternalLinkIcon,
  FileTextIcon,
  HandshakeIcon,
  InfoIcon,
  LifeBuoyIcon,
  LoaderCircleIcon,
  MinusIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Status } from '@/components/settings/badges';
import {
  LoadError,
  PageHeading,
  SettingsFrame,
  SettingsUnavailable,
} from '@/components/settings/settings-frame';
import { UsageMeters } from '@/components/settings/usage-meter';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useViewer } from '@/hooks/use-viewer';
import {
  comparison,
  directions,
  grantLabel,
  grantLines,
  money,
  per,
  planAction,
  priceAt,
  priceText,
  tooSmall,
  overLimitSentence,
  type Grants,
  type Interval,
  type PlanAction,
} from '@/lib/billing';
import { dayDate } from '@/lib/format';
import { useSupportEmail } from '@/lib/support';
import { announce } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  ChangeDialog,
  DoesntFitDialog,
  StartDialog,
  type ChangeIntent,
  type StartIntent,
} from './plan-dialogs';
import { useOpenPortal } from './use-open-portal';

/** How often the page re-reads the subscription while it waits. */
const POLL_MS = 2_000;
/** When the wait says it's taking longer than usual. */
const LONG_WAIT_MS = 60_000;

/** Now, for when a wait began: called from handlers, never while rendering. */
const clock = () => Date.now();

/** A change or a Checkout the page is waiting for Stripe to confirm. */
type Waiting = {
  kind: 'change' | 'checkout';
  planName: string;
  /** The price the subscription should name; any, after Checkout. */
  priceId: string | null;
  creditIssued?: boolean | null;
  oldPlan?: string;
  since: number;
};

/**
 * Settings › Billing (design 09): the plan and usage, the plans with the
 * monthly/yearly switch, the portal and the invoices, by permission. A change
 * or a Checkout is confirmed by Stripe's event, so the page waits on the
 * subscription read until it names the new price.
 */
export function BillingView() {
  const { can, query: viewer } = useViewer();
  const readable = can('organization.read');
  const subscription = useBillingControllerGetSubscriptionV1({
    query: { enabled: readable },
  });

  if (viewer.isSuccess && !readable) {
    return (
      <SettingsFrame crumbs={[{ label: 'Billing' }]}>
        <SettingsUnavailable />
      </SettingsFrame>
    );
  }

  const current = subscription.data?.data;
  return (
    <SettingsFrame crumbs={[{ label: 'Billing' }]}>
      <PageHeading
        title="Billing"
        description="Your plan, what it includes, and how you pay. Payments are handled by Stripe."
      />
      {current ? (
        <Billing subscription={current} />
      ) : subscription.isError ? (
        <LoadError what="billing" onRetry={() => void subscription.refetch()} />
      ) : (
        <div aria-busy className="flex flex-col gap-6">
          <span className="sr-only" role="status">
            Loading billing
          </span>
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-80 w-full" />
            <Skeleton className="h-80 w-full" />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-96 w-full" />
            <Skeleton className="h-96 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        </div>
      )}
    </SettingsFrame>
  );
}

function Billing({ subscription }: { subscription: SubscriptionResponseDto }) {
  const { can } = useViewer();
  const admin = can('organization.update');
  const queryClient = useQueryClient();
  const router = useRouter();
  const search = useSearchParams();
  const organization = useOrganizationsControllerGetV1({
    query: { retry: false },
  });
  const name = organization.data?.data?.name ?? 'Your organization';
  const plans = useBillingControllerListPlansV1();
  const usage = useOrganizationsControllerGetUsageV1();
  const storage = useDocumentsControllerStorageUsageV1({
    query: { enabled: can('document.read'), retry: false },
  });
  const invoices = useBillingControllerListInvoicesV1(undefined, {
    query: { enabled: admin && Boolean(subscription.stripeCustomerId) },
  });

  const paid = Boolean(subscription.stripeSubscriptionId);
  const held = plans.data?.data.find((plan) =>
    plan.prices.some((price) => price.stripePriceId === subscription.priceId),
  );
  const heldPrice = held?.prices.find(
    (price) => price.stripePriceId === subscription.priceId,
  );
  const currentGrants: Grants = held ?? {
    name: subscription.planName,
    maxAgentSeats: subscription.maxAgentSeats,
    maxStorageBytes: subscription.maxStorageBytes,
    monthlyAiTokenBudget: subscription.monthlyAiTokenBudget,
    aiModelTier: subscription.aiModelTier,
  };

  const [interval, setInterval] = useState<Interval>(
    subscription.interval === 'year' ? 'year' : 'month',
  );
  // Back from Checkout: what the address says, read once on the first render
  // (the success address names the plan), then dropped from the address.
  const [waiting, setWaiting] = useState<Waiting | null>(() =>
    search.get('checkout') === 'success'
      ? {
          kind: 'checkout',
          planName: search.get('plan') ?? 'Your plan',
          priceId: null,
          since: Date.now(),
        }
      : null,
  );
  const [canceled] = useState(() => search.get('checkout') === 'canceled');
  const [change, setChange] = useState<ChangeIntent | null>(null);
  const [start, setStart] = useState<StartIntent | null>(null);
  const [refused, setRefused] = useState<{
    planName: string;
    items: OverLimit[];
  } | null>(null);

  const returned = search.get('checkout');
  useEffect(() => {
    if (returned) router.replace('/settings/billing', { scroll: false });
  }, [returned, router]);

  // The wait: re-read the subscription until it names the new price.
  const confirmed =
    waiting !== null &&
    (waiting.priceId === null
      ? paid
      : subscription.priceId === waiting.priceId);
  const pending = waiting !== null && !confirmed;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!pending) return;
    const tick = globalThis.setInterval(() => {
      setNow(Date.now());
      void queryClient.invalidateQueries({
        queryKey: getBillingControllerGetSubscriptionV1QueryKey(),
      });
    }, POLL_MS);
    return () => globalThis.clearInterval(tick);
  }, [pending, queryClient]);

  // Done, said once per wait.
  const said = useRef<number | null>(null);
  useEffect(() => {
    if (!waiting || !confirmed || said.current === waiting.since) return;
    said.current = waiting.since;
    void queryClient.invalidateQueries();
    if (waiting.kind === 'checkout') {
      toast.success(`Welcome to ${waiting.planName}`, {
        description:
          'Your subscription is active. Its first invoice is under Invoices.',
      });
    } else {
      toast.success(`You’re on ${waiting.planName}`, {
        description:
          waiting.creditIssued === true
            ? `A credit for the unused part of ${waiting.oldPlan} goes toward your next invoice.`
            : waiting.creditIssued === false
              ? 'The difference for the rest of this period is on a new invoice.'
              : undefined,
      });
    }
  }, [waiting, confirmed, queryClient]);
  const longWait = pending && now - waiting.since >= LONG_WAIT_MS;
  useEffect(() => {
    if (longWait)
      announce('Still confirming. This is taking longer than usual.');
  }, [longWait]);

  const inUse = {
    people: usage.data?.data.seats.used ?? null,
    storageBytes: usage.data?.data.storage.used ?? null,
    documents: storage.data?.data.documentCount ?? null,
  };

  const pricePart = (plan: TenantPlanResponseDto, at: Interval) => {
    const price = priceAt(plan, at);
    return price ? (priceText(price) ?? '') : '';
  };
  const heldText = heldPrice ? (priceText(heldPrice) ?? '') : 'Free';

  const choose = (plan: TenantPlanResponseDto, action: PlanAction) => {
    const price = priceAt(plan, interval);
    if (!price) return;
    const to = { ...plan, price: priceText(price) ?? '' };
    const from = { ...currentGrants, price: heldText };
    if (action.kind === 'choose') {
      setStart({
        planName: plan.name,
        priceId: price.stripePriceId,
        price: priceText(price) ?? '',
        rows: comparison(from, to),
      });
      return;
    }
    const renewal = subscription.currentPeriodEnd
      ? dayDate(subscription.currentPeriodEnd)
      : null;
    const after = `After that, ${plan.name} is ${pricePart(plan, interval)}.`;
    if (action.kind === 'switch') {
      const anchor = new Date();
      if (action.to === 'year') anchor.setFullYear(anchor.getFullYear() + 1);
      else anchor.setMonth(anchor.getMonth() + 1);
      setChange({
        kind: 'switch',
        planId: plan.id,
        planName: plan.name,
        priceId: price.stripePriceId,
        title: `Switch ${plan.name} to ${action.to === 'year' ? 'yearly' : 'monthly'} billing?`,
        lead: `You’re charged ${price.unitAmount !== null && price.currency ? money(price.unitAmount, price.currency) : 'the new price'} today, less a credit for the unused part of this ${action.to === 'year' ? 'month' : 'year'}. ${plan.name} then renews on ${dayDate(anchor)}.`,
        note: `What ${plan.name} includes stays the same.`,
        action: action.to === 'year' ? 'Switch to yearly' : 'Switch to monthly',
        rows: comparison(from, to).slice(0, 1),
      });
      return;
    }
    setChange({
      kind: action.kind === 'upgrade' ? 'upgrade' : 'change',
      planId: plan.id,
      planName: plan.name,
      priceId: price.stripePriceId,
      title:
        action.kind === 'upgrade'
          ? `Upgrade to ${plan.name}?`
          : `Change to ${plan.name}?`,
      lead:
        action.kind === 'upgrade'
          ? `Today you’re charged the difference for the rest of this period${renewal ? `, to ${renewal}` : ''}. ${after}`
          : `The unused part of ${currentGrants.name} for this period becomes a credit toward your next invoice. ${after}`,
      note:
        action.kind === 'change'
          ? `Everything you use today fits ${plan.name}.`
          : undefined,
      action:
        action.kind === 'upgrade'
          ? `Upgrade to ${plan.name}`
          : `Change to ${plan.name}`,
      rows: comparison(from, to),
    });
  };

  const changed = (answer: PlanChangeResponseDto, intent: ChangeIntent) => {
    setChange(null);
    setWaiting({
      kind: 'change',
      planName: intent.planName,
      priceId: intent.priceId,
      creditIssued: answer.creditIssued,
      oldPlan: currentGrants.name,
      since: clock(),
    });
  };

  const open = invoices.data?.data.find((invoice) => invoice.status === 'open');
  const negotiated = subscription.negotiated;

  return (
    <div className="flex flex-col gap-6">
      {pending && <WaitingAlert waiting={waiting} longWait={longWait} />}
      {canceled && (
        <Alert variant="info" role="status">
          <InfoIcon aria-hidden />
          <AlertTitle>Checkout canceled</AlertTitle>
          <AlertDescription>
            Nothing changed, and you weren’t charged.
          </AlertDescription>
        </Alert>
      )}
      {subscription.status === 'SUSPENDED_PAST_DUE' && admin && (
        <PaymentFailed invoice={open} organization={name} />
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <CurrentPlan
          subscription={subscription}
          grants={currentGrants}
          price={heldText === 'Free' ? null : heldText}
          organization={name}
        />
        <section
          aria-labelledby="billing-usage"
          className="flex flex-col gap-5 rounded-xl border bg-card p-6 text-card-foreground shadow-sm"
        >
          <header className="flex flex-col gap-1">
            <h2 id="billing-usage" className="text-base font-semibold">
              Usage
            </h2>
            {usage.data?.data && (
              <p className="text-sm text-muted-foreground">
                {`This billing period, since ${dayDate(usage.data.data.billingCycleStart)}. The same meters as Organization.`}
              </p>
            )}
          </header>
          {usage.data?.data ? (
            <UsageMeters
              usage={usage.data.data}
              onRetry={() => void usage.refetch()}
            />
          ) : usage.isError ? (
            <LoadError what="the usage" onRetry={() => void usage.refetch()} />
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </section>
      </div>

      <section
        aria-labelledby="billing-plans"
        className="flex flex-col gap-5 rounded-xl border bg-card p-6 text-card-foreground shadow-sm"
      >
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex max-w-xl flex-col gap-1">
            <h2 id="billing-plans" className="text-base font-semibold">
              Plans
            </h2>
            {!negotiated && (
              <p className="text-sm text-muted-foreground">
                {paid
                  ? 'Prices come from Stripe. A change takes effect right away, and the difference for the rest of the period is charged or credited now.'
                  : 'Prices come from Stripe. Choosing a plan takes you to Stripe to pay; you come back here when it’s done.'}
              </p>
            )}
          </div>
          {!negotiated && (
            <ToggleGroup
              type="single"
              aria-label="Billing interval"
              value={interval}
              onValueChange={(value) => {
                if (value !== 'month' && value !== 'year') return;
                setInterval(value);
                announce(
                  value === 'year'
                    ? 'Showing yearly prices'
                    : 'Showing monthly prices',
                );
              }}
              className="w-full rounded-lg bg-muted p-1 sm:w-50"
            >
              <ToggleGroupItem
                value="month"
                className="flex-1 data-[state=on]:bg-background data-[state=on]:shadow-sm"
              >
                Monthly
              </ToggleGroupItem>
              <ToggleGroupItem
                value="year"
                className="flex-1 data-[state=on]:bg-background data-[state=on]:shadow-sm"
              >
                Yearly
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        </header>
        {negotiated ? (
          <Negotiated />
        ) : plans.data ? (
          <ul aria-label="Plans" className="grid gap-4 lg:grid-cols-3">
            {plans.data.data.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                interval={interval}
                current={currentGrants}
                isCurrent={plan.id === held?.id}
                action={
                  admin
                    ? planAction(plan, interval, subscription, currentGrants)
                    : null
                }
                tooSmall={tooSmall(plan, inUse)}
                disabled={pending}
                onChoose={(action) => choose(plan, action)}
              />
            ))}
          </ul>
        ) : plans.isError ? (
          <LoadError what="the plans" onRetry={() => void plans.refetch()} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-96 w-full" />
            <Skeleton className="h-96 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        )}
        {!admin && (
          <p className="text-sm text-muted-foreground">
            Only people who can update the organization can change the plan or
            see invoices.
          </p>
        )}
      </section>

      {admin && subscription.stripeCustomerId && (
        <>
          <PaymentDetails />
          <Invoices
            invoices={invoices.data?.data}
            failed={invoices.isError}
            onRetry={() => void invoices.refetch()}
          />
        </>
      )}

      <ChangeDialog
        intent={change}
        onClose={() => setChange(null)}
        onChanged={changed}
        onDoesntFit={(planName, items) => {
          setChange(null);
          setRefused({ planName, items });
        }}
      />
      <StartDialog
        intent={start}
        onClose={() => setStart(null)}
        onDoesntFit={(planName, items) => {
          setStart(null);
          setRefused({ planName, items });
        }}
      />
      <DoesntFitDialog
        refused={refused}
        organization={name}
        onClose={() => setRefused(null)}
      />
    </div>
  );
}

function WaitingAlert({
  waiting,
  longWait,
}: {
  waiting: Waiting;
  longWait: boolean;
}) {
  const what = waiting.kind === 'checkout' ? 'subscription' : 'new plan';
  return (
    <Alert variant="info" role="status">
      {longWait ? (
        <ClockIcon aria-hidden />
      ) : (
        <LoaderCircleIcon aria-hidden className="animate-spin" />
      )}
      <AlertTitle>
        {longWait
          ? `Still confirming your ${what}`
          : `Confirming your ${what}…`}
      </AlertTitle>
      <AlertDescription>
        {longWait
          ? 'This is taking longer than usual. It can take a few minutes, and this page updates on its own. You can leave it; nothing else is needed.'
          : waiting.kind === 'checkout'
            ? `${waiting.planName} will show here as soon as Stripe confirms your payment, usually within a few seconds.`
            : `${waiting.planName} will show here as soon as Stripe confirms it, usually within a few seconds.`}
      </AlertDescription>
    </Alert>
  );
}

/** Past due, for the people who can pay: the open invoice first. */
function PaymentFailed({
  invoice,
  organization,
}: {
  invoice: InvoiceResponseDto | undefined;
  organization: string;
}) {
  const portal = useOpenPortal();
  const amount = invoice ? money(invoice.amountDue, invoice.currency) : null;
  return (
    <Alert variant="destructive" role="alert">
      <CircleAlertIcon aria-hidden />
      <AlertTitle>A payment failed</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <p>
          {invoice && amount && invoice.created
            ? `Stripe couldn’t collect ${amount} for ${dayDate(invoice.created)}. `
            : ''}
          {`Until it’s paid, ${organization} is read-only. Pay the invoice on Stripe, or update your card there first.`}
        </p>
        <div className="flex flex-wrap gap-2">
          {invoice && amount && (
            <a
              href={invoice.hostedInvoiceUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ size: 'sm' })}
            >
              {`Pay ${amount} on Stripe`}
              <span className="sr-only"> (opens in a new tab)</span>
              <ExternalLinkIcon aria-hidden />
            </a>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={portal.busy}
            onClick={() => void portal.open()}
          >
            {portal.busy ? 'Opening Stripe…' : 'Manage billing on Stripe'}
            <span className="sr-only"> (opens Stripe)</span>
            <ExternalLinkIcon aria-hidden />
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

function SubscriptionBadge({
  subscription,
}: {
  subscription: SubscriptionResponseDto;
}) {
  if (subscription.negotiated) {
    return (
      <Status tone="info" icon={HandshakeIcon}>
        Negotiated
      </Status>
    );
  }
  if (!subscription.stripeSubscriptionId) {
    return (
      <Status tone="muted" icon={MinusIcon}>
        No subscription
      </Status>
    );
  }
  if (subscription.status === 'SUSPENDED_PAST_DUE') {
    return (
      <Status tone="warning" icon={TriangleAlertIcon}>
        Past due
      </Status>
    );
  }
  if (subscription.cancelAtPeriodEnd) {
    return (
      <Status tone="warning" icon={CalendarIcon}>
        Canceled
      </Status>
    );
  }
  return (
    <Status tone="success" icon={CircleCheckIcon}>
      Active
    </Status>
  );
}

function CurrentPlan({
  subscription,
  grants,
  price,
  organization,
}: {
  subscription: SubscriptionResponseDto;
  grants: Grants;
  price: string | null;
  organization: string;
}) {
  const end = subscription.currentPeriodEnd
    ? dayDate(subscription.currentPeriodEnd)
    : null;
  let line: { icon: ReactNode; text: string; warn?: boolean } | null = null;
  if (subscription.negotiated) {
    line = {
      icon: <HandshakeIcon aria-hidden className="size-4 shrink-0" />,
      text: 'Agreed with the SynapseDesk team. To change it, contact support.',
    };
  } else if (!subscription.stripeSubscriptionId) {
    line = {
      icon: <InfoIcon aria-hidden className="size-4 shrink-0" />,
      text: 'Every new organization starts on Free. Choose a plan below to add more.',
    };
  } else if (subscription.status === 'SUSPENDED_PAST_DUE') {
    line = {
      icon: <TriangleAlertIcon aria-hidden className="size-4 shrink-0" />,
      text: 'A payment failed. Update your card on Stripe to settle it.',
      warn: true,
    };
  } else if (subscription.cancelAtPeriodEnd && end) {
    line = {
      icon: <CalendarIcon aria-hidden className="size-4 shrink-0" />,
      text: `Ends on ${end}. After that, ${organization} is frozen until support restores it.`,
      warn: true,
    };
  } else if (end) {
    line = {
      icon: <CalendarIcon aria-hidden className="size-4 shrink-0" />,
      text: `Renews on ${end}`,
    };
  }

  return (
    <section
      aria-labelledby="billing-current"
      className="flex flex-col gap-4 rounded-xl border bg-card p-6 text-card-foreground shadow-sm"
    >
      <header className="flex flex-wrap items-center gap-2">
        <h2 id="billing-current" className="text-base font-semibold">
          Current plan
        </h2>
        <SubscriptionBadge subscription={subscription} />
      </header>
      <div className="flex flex-col gap-1.5">
        <p className="flex flex-wrap items-baseline gap-2">
          <span className="text-2xl font-semibold">{grants.name}</span>
          {price && (
            <span className="text-sm text-muted-foreground">{price}</span>
          )}
        </p>
        {line && (
          <p
            className={cn(
              'flex items-start gap-2 text-sm',
              line.warn
                ? 'text-warning-subtle-foreground'
                : 'text-muted-foreground',
            )}
          >
            <span className="mt-0.5">{line.icon}</span>
            {line.text}
          </p>
        )}
      </div>
      <hr />
      <ul className="flex flex-col gap-2 text-sm">
        {grantLines(grants).map((grant) => (
          <li key={grant} className="flex items-start gap-2">
            <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            {grant}
          </li>
        ))}
      </ul>
    </section>
  );
}

const ACTION_LABEL = (action: PlanAction, plan: string): string => {
  switch (action.kind) {
    case 'current':
      return 'Current plan';
    case 'switch':
      return action.to === 'year' ? 'Switch to yearly' : 'Switch to monthly';
    case 'upgrade':
      return `Upgrade to ${plan}`;
    case 'change':
      return `Change to ${plan}`;
    case 'choose':
      return `Choose ${plan}`;
  }
};

function PlanCard({
  plan,
  interval,
  current,
  isCurrent,
  action,
  tooSmall: overLimit,
  disabled,
  onChoose,
}: {
  plan: TenantPlanResponseDto;
  interval: Interval;
  current: Grants;
  isCurrent: boolean;
  action: PlanAction | null;
  tooSmall: OverLimit[];
  disabled: boolean;
  onChoose: (action: PlanAction) => void;
}) {
  const warningId = useId();
  const headingId = useId();
  const price = priceAt(plan, interval);
  const lines = grantLines(plan);
  const ways = directions(plan, current);
  // Too small only blocks moving onto it; the plan held is the plan held.
  const blocked = !isCurrent && overLimit.length > 0;
  const primary = action?.kind === 'upgrade' || action?.kind === 'choose';

  return (
    <li
      aria-labelledby={headingId}
      aria-current={isCurrent ? 'true' : undefined}
      className={cn(
        'flex flex-col gap-4 rounded-xl border p-5',
        isCurrent && 'border-2 border-primary',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3
          id={headingId}
          aria-label={isCurrent ? `${plan.name}, your current plan` : undefined}
          className="text-lg font-semibold"
        >
          {plan.name}
        </h3>
        {isCurrent && (
          <Badge variant="info">
            <CheckIcon aria-hidden />
            Current plan
          </Badge>
        )}
      </div>
      <p className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold">
          {price && price.unitAmount !== null && price.currency
            ? money(price.unitAmount, price.currency)
            : '—'}
        </span>
        <span className="text-sm text-muted-foreground">{per(interval)}</span>
      </p>
      <hr />
      <ul className="flex flex-1 flex-col gap-2 text-sm">
        {lines.map((line, index) => {
          const way = isCurrent ? 'same' : ways[index];
          return (
            <li
              key={line}
              aria-label={
                isCurrent
                  ? undefined
                  : grantLabel(line, way, current.name, index === 3)
              }
              className="flex items-start gap-2"
            >
              {way === 'more' ? (
                <ArrowUpIcon
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-success-subtle-foreground"
                />
              ) : way === 'less' ? (
                <ArrowDownIcon
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-warning-subtle-foreground"
                />
              ) : (
                <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              )}
              <span aria-hidden={!isCurrent || undefined}>{line}</span>
            </li>
          );
        })}
      </ul>
      {blocked && (
        <div
          id={warningId}
          className="flex flex-col gap-1 rounded-lg border border-warning-border bg-warning-subtle p-3 text-sm text-warning-subtle-foreground"
        >
          <p className="flex items-start gap-2 font-medium">
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            Too small for your usage now
          </p>
          {overLimit.map((item) => (
            <p key={item.dimension} className="pl-6">
              {overLimitSentence(item, plan.name)}
            </p>
          ))}
        </div>
      )}
      {action && price && (
        <Button
          variant={primary && !blocked ? 'default' : 'outline'}
          // Unavailable, and still focusable so its reason is read.
          className={cn('w-full', blocked && 'opacity-50')}
          disabled={action.kind === 'current' || (disabled && !blocked)}
          aria-disabled={blocked || undefined}
          aria-describedby={blocked ? warningId : undefined}
          onClick={() => {
            if (blocked || disabled) return;
            onChoose(action);
          }}
        >
          {ACTION_LABEL(action, plan.name)}
        </Button>
      )}
    </li>
  );
}

function Negotiated() {
  const support = useSupportEmail();
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border bg-muted/40 p-5">
      <h3 className="font-medium">Your plan can’t be changed here</h3>
      <p className="text-sm text-muted-foreground">
        It was agreed with the SynapseDesk team. To change it, contact support.
      </p>
      {support && (
        <a
          href={`mailto:${support}`}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          <LifeBuoyIcon aria-hidden />
          Contact support
        </a>
      )}
    </div>
  );
}

function PaymentDetails() {
  const portal = useOpenPortal();
  return (
    <section
      aria-labelledby="billing-payment"
      className="flex flex-col items-start gap-4 rounded-xl border bg-card p-6 text-card-foreground shadow-sm"
    >
      <header className="flex flex-col gap-1">
        <h2 id="billing-payment" className="text-base font-semibold">
          Payment and billing details
        </h2>
        <p className="text-sm text-muted-foreground">
          Update your card, billing address or tax details, or cancel your plan.
          These are on Stripe’s billing portal.
        </p>
      </header>
      <Button
        variant="outline"
        disabled={portal.busy}
        onClick={() => void portal.open()}
      >
        {portal.busy && (
          <LoaderCircleIcon aria-hidden className="animate-spin" />
        )}
        {portal.busy ? 'Opening Stripe…' : 'Manage billing on Stripe'}
        {!portal.busy && <span className="sr-only"> (opens Stripe)</span>}
        {!portal.busy && <ExternalLinkIcon aria-hidden />}
      </Button>
    </section>
  );
}

function InvoiceStatus({ status }: { status: string }) {
  switch (status) {
    case 'paid':
      return (
        <Status tone="success" icon={CircleCheckIcon}>
          Paid
        </Status>
      );
    case 'open':
      return (
        <Status tone="warning" icon={ClockIcon}>
          Open
        </Status>
      );
    case 'void':
      return (
        <Status tone="muted" icon={CircleXIcon}>
          Void
        </Status>
      );
    case 'uncollectible':
      return (
        <Status tone="destructive" icon={CircleAlertIcon}>
          Uncollectible
        </Status>
      );
    default:
      return (
        <Status tone="muted" icon={FileTextIcon}>
          Draft
        </Status>
      );
  }
}

function InvoiceLink({ invoice }: { invoice: InvoiceResponseDto }) {
  const open = invoice.status === 'open';
  return (
    <a
      href={invoice.hostedInvoiceUrl}
      target="_blank"
      rel="noreferrer"
      aria-label={`${open ? 'Pay' : 'View'} invoice ${invoice.number} on Stripe (opens in a new tab)`}
      className="inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap text-primary underline-offset-4 hover:underline"
    >
      {open ? 'Pay on Stripe' : 'View on Stripe'}
      <ExternalLinkIcon aria-hidden className="size-4" />
    </a>
  );
}

function Invoices({
  invoices,
  failed,
  onRetry,
}: {
  invoices: InvoiceResponseDto[] | undefined;
  failed: boolean;
  onRetry: () => void;
}) {
  return (
    <section
      aria-labelledby="billing-invoices"
      className="flex flex-col gap-4 rounded-xl border bg-card p-6 text-card-foreground shadow-sm"
    >
      <h2 id="billing-invoices" className="text-base font-semibold">
        Invoices
      </h2>
      {failed ? (
        <Alert variant="warning">
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>Invoices can’t be loaded right now</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            Stripe isn’t responding. Try again in a few minutes.
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : invoices ? (
        <>
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    <span className="sr-only">Stripe</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => (
                  <TableRow
                    key={invoice.id}
                    className={cn(invoice.status === 'open' && 'bg-accent')}
                  >
                    <TableCell>{invoice.number}</TableCell>
                    <TableCell>
                      {invoice.created ? dayDate(invoice.created) : '—'}
                    </TableCell>
                    <TableCell>
                      {money(invoice.amountDue, invoice.currency)}
                    </TableCell>
                    <TableCell>
                      <InvoiceStatus status={invoice.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <InvoiceLink invoice={invoice} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="flex flex-col gap-3 md:hidden">
            {invoices.map((invoice) => (
              <li
                key={invoice.id}
                className={cn(
                  'flex flex-col gap-2 rounded-lg border p-4 text-sm',
                  invoice.status === 'open' && 'bg-accent',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{invoice.number}</span>
                  <InvoiceStatus status={invoice.status} />
                </div>
                <p className="text-muted-foreground">
                  {`${invoice.created ? dayDate(invoice.created) : '—'} · ${money(invoice.amountDue, invoice.currency)}`}
                </p>
                <InvoiceLink invoice={invoice} />
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            The latest 12 invoices. Older ones are in the billing portal.
          </p>
        </>
      ) : (
        <Skeleton className="h-64 w-full" />
      )}
    </section>
  );
}
