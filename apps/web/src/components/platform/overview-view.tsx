'use client';

import {
  usePlatformControllerGetFinanceSnapshotV1,
  usePlatformControllerGetMetricsV1,
  usePlatformControllerListBillingEventsV1,
  usePlatformJobsControllerGetHealthV1,
  type FinanceSnapshotResponseDto,
  type JobHealthResponseDto,
  type PlatformMetricsResponseDto,
} from '@synapsedesk/api-client';
import { TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { BarList, TimeChart } from '@/components/analytics/charts';
import { RangePicker } from '@/components/analytics/range-picker';
import {
  StatTiles,
  TileSkeletons,
  Unavailable,
  type Tile,
} from '@/components/analytics/tiles';
import { LoadError } from '@/components/settings/settings-frame';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { addDays, longDay, periods, shortDay, todayIso } from '@/lib/analytics';
import { money } from '@/lib/billing';
import { absoluteTime, dayDate } from '@/lib/format';
import {
  count,
  jobWords,
  mrrReason,
  serviceWords,
  type Health,
} from '@/lib/platform';
import { cn } from '@/lib/utils';
import { ConsoleStatusBadge, HealthBadge } from './badges';
import { ConsoleCard, ConsolePage } from './console-page';

/** The longest billing-events range the server answers. */
const MAX_RANGE_DAYS = 366;

/** The four Stripe events the deck names, in its order. */
const EVENTS: [string, string][] = [
  ['customer.subscription.created', 'New subscriptions'],
  ['customer.subscription.updated', 'Subscription changes'],
  ['customer.subscription.deleted', 'Cancellations'],
  ['invoice.payment_failed', 'Failed payments'],
];

/**
 * The platform at a glance (design 11): tiles, what needs attention, the plan
 * mix and the billing events. Three reads, each failing on its own part; the
 * page is an error only when none of them answered.
 */
export function OverviewView() {
  const metrics = usePlatformControllerGetMetricsV1({
    query: { retry: false },
  });
  const finance = usePlatformControllerGetFinanceSnapshotV1({
    query: { retry: false },
  });
  const jobs = usePlatformJobsControllerGetHealthV1({
    query: { retry: false },
  });
  const m = metrics.data?.data;
  const f = finance.data?.data;
  const j = jobs.data?.data;
  const failed = metrics.isError && finance.isError && jobs.isError;
  const loading = !failed && (!m || !f || !j) && !anyError();
  function anyError() {
    return metrics.isError || finance.isError || jobs.isError;
  }

  const retryAll = () => {
    void metrics.refetch();
    void finance.refetch();
    void jobs.refetch();
  };

  return (
    <ConsolePage
      crumbs={[{ label: 'Overview' }]}
      title="Overview"
      description={
        m
          ? `Every organization at a glance. Updated ${absoluteTime(m.generatedAt)}.`
          : 'Every organization at a glance.'
      }
    >
      {failed ? (
        <LoadError what="the overview" onRetry={retryAll} />
      ) : (
        <>
          {loading && (
            <span className="sr-only" role="status">
              Loading the overview
            </span>
          )}
          <Partial finance={f} jobs={j} />
          {metrics.isError ? (
            <Unavailable
              title="The platform’s numbers"
              what="The platform’s numbers couldn’t be read"
              onRetry={() => void metrics.refetch()}
            />
          ) : m && (f || finance.isError) ? (
            <StatTiles
              tiles={tiles(m, f ?? null)}
              className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
            />
          ) : (
            <TileSkeletons count={6} />
          )}
          <div className="grid gap-6 lg:grid-cols-2">
            <NeedsAttention
              finance={f}
              jobs={j}
              failed={finance.isError && jobs.isError}
              onRetry={retryAll}
            />
            {finance.isError ? (
              <Unavailable
                title="Plan mix"
                what="The plan mix couldn’t be read"
                onRetry={() => void finance.refetch()}
              />
            ) : (
              <PlanMix finance={f} />
            )}
          </div>
          <BillingEvents />
        </>
      )}
    </ConsolePage>
  );
}

/**
 * The tiles, in the deck's words. MRR's value is money; when it can't be
 * estimated, "—" and the reason in the deck's words, never the server's.
 */
export function tiles(
  m: PlatformMetricsResponseDto,
  f: FinanceSnapshotResponseDto | null,
): Tile[] {
  const by = m.organizationsByStatus as Record<string, number | undefined>;
  const n = (status: string) => (by[status] ?? 0).toLocaleString('en-US');
  const share =
    m.seatsAllocated > 0
      ? Math.round((m.seatsInUse / m.seatsAllocated) * 100)
      : 0;
  const revenue = f?.revenue;
  const mrr: Tile =
    revenue?.available && revenue.currency
      ? {
          label: 'Estimated MRR',
          value: money(revenue.estimatedMrr ?? 0, revenue.currency, 'en-US'),
          counts: `${count(revenue.activeSubscriptions ?? 0, 'active subscription')}. Excludes discounts, trials and past-due subscriptions.${revenue.computedAt ? ` Computed ${absoluteTime(revenue.computedAt)}.` : ''}`,
          help: 'Monthly recurring revenue estimated from Stripe’s active subscriptions, before discounts.',
        }
      : {
          label: 'Estimated MRR',
          value: null,
          counts: `Not available: ${revenue ? mrrReason(revenue.unavailableReason) : 'the revenue snapshot couldn’t be read.'}`,
          help: 'Monthly recurring revenue estimated from Stripe’s active subscriptions, before discounts.',
        };
  return [
    {
      label: 'Organizations',
      value: m.totalOrganizations.toLocaleString('en-US'),
      counts: `${n('ACTIVE')} active · ${n('PENDING_ONBOARDING')} setting up · ${n('SUSPENDED_PAST_DUE')} past due · ${n('FROZEN')} frozen`,
      help: 'Every organization that isn’t offboarded, by status.',
    },
    {
      label: 'People',
      value: m.totalUsers.toLocaleString('en-US'),
      counts: `${m.activeUsers.toLocaleString('en-US')} active`,
      help: 'Everyone with an account in an organization, and how many can sign in.',
    },
    {
      label: 'Seats in use',
      value: `${m.seatsInUse.toLocaleString('en-US')} of ${m.seatsAllocated.toLocaleString('en-US')}`,
      counts: `${share}% of the seats organizations hold`,
      help: 'Agents using a seat, against the seats every organization’s plan allows.',
    },
    {
      label: 'Live sessions',
      value: m.liveSessions.toLocaleString('en-US'),
      counts: 'Signed in right now',
      help: 'Sessions that haven’t expired or been signed out.',
    },
    {
      label: 'Pending invitations',
      value: m.pendingInvitations.toLocaleString('en-US'),
      counts: 'Sent, not yet accepted',
      help: 'Invitations that are neither accepted, revoked nor expired.',
    },
    mrr,
  ];
}

/** What couldn't be read, said once; each part keeps its own state too. */
function Partial({
  finance,
  jobs,
}: {
  finance: FinanceSnapshotResponseDto | undefined;
  jobs: JobHealthResponseDto | undefined;
}) {
  const lines: string[] = [];
  if (finance && !finance.revenue.available) {
    lines.push(
      `Estimated MRR: ${mrrReason(finance.revenue.unavailableReason)}`,
    );
  }
  for (const service of jobs?.unavailable ?? []) {
    lines.push(
      `Jobs: the ${serviceName(service)} service didn’t answer, so its jobs aren’t listed.`,
    );
  }
  if (lines.length === 0) return null;
  return (
    <Alert variant="warning" role="status">
      <TriangleAlertIcon aria-hidden />
      <AlertTitle>Some numbers couldn’t be read</AlertTitle>
      <AlertDescription>
        {`${lines.join(' ')} Everything else is up to date.`}
      </AlertDescription>
    </Alert>
  );
}

/** "notification", from "notification-service". */
const serviceName = (service: string) => service.replace(/-service$/, '');

type Attention = {
  key: string;
  badge: React.ReactNode;
  label: string;
  href: string;
  detail: string;
};

/** Past-due organizations, then jobs that aren't healthy, then services not reached. */
function NeedsAttention({
  finance,
  jobs,
  failed,
  onRetry,
}: {
  finance: FinanceSnapshotResponseDto | undefined;
  jobs: JobHealthResponseDto | undefined;
  failed: boolean;
  onRetry: () => void;
}) {
  const title = 'Needs attention';
  if (failed) {
    return (
      <Unavailable
        title={title}
        what="What needs attention couldn’t be read"
        onRetry={onRetry}
      />
    );
  }
  const lead = 'Past-due organizations and jobs that aren’t healthy.';
  if (!finance && !jobs) {
    return (
      <ConsoleCard title={title} lead={lead}>
        <ListSkeleton />
      </ConsoleCard>
    );
  }
  const items: Attention[] = [
    ...(finance?.dunning.tenants ?? []).map((tenant) => ({
      key: tenant.id,
      badge: <ConsoleStatusBadge status="SUSPENDED_PAST_DUE" />,
      label: tenant.name,
      href: `/platform/organizations/${tenant.id}`,
      detail: `Past due since ${dayDate(tenant.pastDueSince ?? tenant.updatedAt)}`,
    })),
    ...(jobs?.items ?? [])
      .filter((job) => job.health === 'failing' || job.health === 'stale')
      .map((job) => ({
        key: job.jobName,
        badge: <HealthBadge health={job.health as Health} />,
        label: jobWords(job.jobName),
        href: '/platform/jobs',
        detail:
          job.health === 'failing'
            ? `${count(job.consecutiveFailures, 'failure')} in a row; last success ${job.lastSucceededAt ? absoluteTime(job.lastSucceededAt) : 'never'}`
            : `Last success ${job.lastSucceededAt ? absoluteTime(job.lastSucceededAt) : 'never'}`,
      })),
    ...(jobs?.unavailable ?? []).map((service) => ({
      key: service,
      badge: <HealthBadge health="not-reached" />,
      label: `${serviceWords(service) === service ? service : capitalize(serviceName(service))} service`,
      href: '/platform/jobs',
      detail: 'Didn’t answer; its jobs aren’t listed',
    })),
  ];
  return (
    <ConsoleCard title={title} lead={lead}>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing needs attention.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li
              key={item.key}
              className="flex flex-wrap items-start gap-x-3 gap-y-1 text-sm"
            >
              <span className="shrink-0">{item.badge}</span>
              <Link
                href={item.href}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {item.label}
              </Link>
              <span className="min-w-0 flex-1 text-muted-foreground">
                {item.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ConsoleCard>
  );
}

const capitalize = (word: string) =>
  word.charAt(0).toUpperCase() + word.slice(1);

/** Organizations on each plan, and the seats they hold. */
function PlanMix({
  finance,
}: {
  finance: FinanceSnapshotResponseDto | undefined;
}) {
  return (
    <ConsoleCard
      title="Plan mix"
      lead="Organizations on each plan, and the seats they hold."
    >
      {!finance ? (
        <ListSkeleton />
      ) : (
        <BarList
          rows={finance.plans.map((plan) => ({
            label: plan.planName,
            value: plan.subscribers,
            text: `${plan.subscribers.toLocaleString('en-US')} · ${count(plan.seatsAllocated, 'seat')}`,
          }))}
        />
      )}
    </ConsoleCard>
  );
}

function ListSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3">
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="h-4 w-full" />
      ))}
    </div>
  );
}

/**
 * The billing events' small multiples: one column chart per event type on one
 * scale, and the sentence under them as their text. The offboarded count is
 * of organizations still offboarded, so it's worded that way.
 */
function BillingEvents() {
  const today = todayIso();
  const [range, setRange] = useState({ from: addDays(today, -29), to: today });
  const events = usePlatformControllerListBillingEventsV1(range, {
    query: { retry: false },
  });
  const data = events.data?.data;
  const title = 'Billing events';
  const picker = (
    <RangePicker
      value={range}
      limit={MAX_RANGE_DAYS}
      today={today}
      billing={false}
      limitLine={`The range can be up to ${MAX_RANGE_DAYS} days.`}
      onApply={setRange}
    />
  );

  if (events.isError) {
    return (
      <Unavailable
        title={title}
        what="The billing events couldn’t be read"
        onRetry={() => void events.refetch()}
      />
    );
  }

  // Stripe's events are counted as they arrive: no day is "not computed".
  const byDay = periods(range.from, range.to, 'DAY', range.to);
  const days = byDay.map((period) => period.key);
  const types = [
    ...EVENTS,
    ...(data?.observedEventTypes ?? [])
      .filter((type) => !EVENTS.some(([known]) => known === type))
      .map((type): [string, string] => [type, type]),
  ];
  const valuesOf = (type: string) =>
    days.map(
      (day) =>
        data?.points.find(
          (point) => point.day === day && point.eventType === type,
        )?.count ?? 0,
    );
  const totals = Object.fromEntries(
    types.map(([type]) => [type, valuesOf(type).reduce((a, b) => a + b, 0)]),
  );
  // One scale for every chart, in whole steps of a quarter.
  const highest =
    Math.ceil(Math.max(1, ...types.flatMap(([type]) => valuesOf(type))) / 4) *
    4;
  const offboarded = (data?.currentlyOffboarded ?? []).reduce(
    (sum, point) => sum + point.count,
    0,
  );
  const total = (type: string) => totals[type] ?? 0;
  const summary = `In the last ${days.length} days: ${count(total(EVENTS[0][0]), 'new subscription')}, ${count(total(EVENTS[1][0]), 'change')}, ${count(total(EVENTS[2][0]), 'cancellation')} and ${count(total(EVENTS[3][0]), 'failed payment')}. ${count(offboarded, 'organization')} offboarded in this range ${offboarded === 1 ? 'is' : 'are'} currently offboarded.`;

  return (
    <ConsoleCard
      title={title}
      lead="Counts from Stripe’s events, per day. Never amounts."
      action={picker}
    >
      <div
        className={cn(
          'grid gap-6 sm:grid-cols-2',
          types.length > 2 && 'xl:grid-cols-4',
        )}
      >
        {types.map(([type, name]) => (
          <div key={type} className="flex min-w-0 flex-col gap-2">
            <h3 className="text-sm font-medium">
              {name}{' '}
              <span className="font-normal text-muted-foreground">
                {data ? total(type) : ''}
              </span>
            </h3>
            {data ? (
              <TimeChart
                title={name}
                periods={byDay}
                labels={days.map(shortDay)}
                titles={days.map(longDay)}
                series={[{ name, color: 1, values: valuesOf(type) }]}
                kind="column"
                height={120}
                fixedMax={highest}
                endLabels={false}
                axis={(v) => String(v)}
                value={(v) => count(v, 'event')}
              />
            ) : (
              <Skeleton className="h-30 w-full" />
            )}
          </div>
        ))}
      </div>
      {data && <p className="text-sm text-muted-foreground">{summary}</p>}
    </ConsoleCard>
  );
}
