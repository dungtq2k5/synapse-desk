'use client';

import { useOrganizationsControllerGetV1 } from '@synapsedesk/api-client';
import { ClockIcon, TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AppHeader } from '@/components/shell/app-header';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useDepartments } from '@/components/ticket/use-directory';
import { useViewer } from '@/hooks/use-viewer';
import {
  type Filters,
  type Granularity,
  longDay,
  readFilters,
  todayIso,
  writeFilters,
} from '@/lib/analytics';
import { clockTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ExportButton, ExportStatus } from './export';
import { RangePicker } from './range-picker';
import { PageUnavailable } from '@/components/shell/page-unavailable';

export type Section =
  'overview' | 'agents' | 'knowledge' | 'ai-usage' | 'feedback';

/** The Analytics area's pages, in the order the links show them. */
export const SECTIONS: Record<
  Section,
  { label: string; href: string; lead: string }
> = {
  overview: {
    label: 'Overview',
    href: '/analytics',
    lead: 'How support is going: tickets, the AI’s share, response times and satisfaction.',
  },
  agents: {
    label: 'Agents',
    href: '/analytics/agents',
    lead: 'What each agent handled in the period. For context, not a ranking.',
  },
  knowledge: {
    label: 'Knowledge',
    href: '/analytics/knowledge',
    lead: 'Where answers found nothing, and how documents are used.',
  },
  'ai-usage': {
    label: 'AI usage',
    href: '/analytics/ai-usage',
    lead: 'What the AI allowance is spent on, and how well it’s used.',
  },
  feedback: {
    label: 'Feedback',
    href: '/analytics/feedback',
    lead: 'What people said about AI answers.',
  },
};

/**
 * The filters the address keeps, held to the plan's range limit. A longer
 * range in the address is clamped once, with a toast, and the address is
 * corrected so a link shared from it is the range shown.
 */
export function useAnalyticsFilters() {
  const organization = useOrganizationsControllerGetV1();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const limit = organization.data?.data?.analyticsRangeDays ?? 0;
  const [today] = useState(todayIso);
  const { filters, clamped } = useMemo(
    () => readFilters(new URLSearchParams(params.toString()), limit, today),
    [params, limit, today],
  );
  const set = (next: Partial<Filters>) =>
    router.replace(`${pathname}?${writeFilters({ ...filters, ...next })}`, {
      scroll: false,
    });
  const told = useRef('');
  useEffect(() => {
    if (!clamped || told.current === params.toString()) return;
    told.current = params.toString();
    toast(`Showing the last ${limit} days`, {
      description: `Your plan shows up to ${limit} days at a time.`,
    });
    router.replace(`${pathname}?${writeFilters(filters)}`, { scroll: false });
  }, [clamped, filters, limit, params, pathname, router]);

  return {
    filters,
    set,
    limit,
    today,
    ready: organization.isSuccess,
    failed: organization.isError,
  };
}

export type AnalyticsFilters = ReturnType<typeof useAnalyticsFilters>;

/** How fresh the page is: "Data through", "Not computed yet", or live. */
export function DataThrough({
  dataThrough,
  computedAt,
  live,
}: {
  dataThrough?: string | null;
  computedAt?: string | null;
  live?: boolean;
}) {
  if (live) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <ClockIcon aria-hidden className="size-4" />
        Live: new ratings appear as they come in
      </p>
    );
  }
  if (dataThrough === undefined) return null;
  if (dataThrough === null) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-warning-subtle-foreground">
        <TriangleAlertIcon aria-hidden className="size-4" />
        Not computed yet
      </p>
    );
  }
  return (
    <p
      className="flex items-center gap-1.5 text-sm text-muted-foreground"
      title={
        computedAt
          ? `Computed ${longDay(computedAt.slice(0, 10))}, ${clockTime(computedAt)}`
          : undefined
      }
    >
      <ClockIcon aria-hidden className="size-4" />
      Data through {longDay(dataThrough)}
    </p>
  );
}

/**
 * An Analytics page: the bar with its crumbs, the heading with Export, the
 * section links, the filter bar with "Data through" at its right, the export's
 * state, then the page. Without `analytics.read` it's the unavailable page.
 */
export function AnalyticsFrame({
  section,
  filters,
  status,
  departments = true,
  granularity = true,
  children,
}: {
  section: Section;
  filters: AnalyticsFilters;
  /** The page's freshness: a {@link DataThrough}. */
  status?: ReactNode;
  /** The page's numbers follow a department. */
  departments?: boolean;
  /** The page has periods to group by. */
  granularity?: boolean;
  children: ReactNode;
}) {
  const { can, query: viewer } = useViewer();
  const current = SECTIONS[section];
  const allowed = can('analytics.read');

  return (
    <>
      <AppHeader
        crumbs={[
          { label: 'Analytics', href: '/analytics' },
          { label: current.label },
        ]}
      />
      <main
        id="main"
        tabIndex={-1}
        className="flex flex-col gap-6 p-4 outline-none md:p-6"
      >
        {viewer.isSuccess && !allowed ? (
          <PageUnavailable back={{ href: '/tickets', label: 'Tickets' }} />
        ) : (
          <>
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {current.label}
                </h1>
                <p className="text-sm text-muted-foreground">{current.lead}</p>
              </div>
              {filters.ready && <ExportButton filters={filters} />}
            </header>
            <SectionLinks
              section={section}
              query={writeFilters(filters.filters)}
            />
            {filters.ready ? (
              <FilterBar
                filters={filters}
                departments={departments}
                granularity={granularity}
                status={status}
              />
            ) : (
              <Skeleton aria-hidden className="h-9 w-full max-w-xl" />
            )}
            <ExportStatus />
            {children}
          </>
        )}
      </main>
    </>
  );
}

/** Underlined links under the heading; a row that scrolls under 768 px. */
function SectionLinks({ section, query }: { section: Section; query: string }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Analytics"
      className="-mx-4 overflow-x-auto border-b px-4 md:mx-0 md:px-0"
    >
      <ul className="flex gap-1">
        {(Object.keys(SECTIONS) as Section[]).map((key) => {
          const active = key === section || pathname === SECTIONS[key].href;
          return (
            <li key={key} className="shrink-0">
              <Link
                href={`${SECTIONS[key].href}?${query}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  '-mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm whitespace-nowrap outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  active
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {SECTIONS[key].label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const ALL_DEPARTMENTS = 'all';

function FilterBar({
  filters: { filters, set, limit, today },
  departments,
  granularity,
  status,
}: {
  filters: AnalyticsFilters;
  departments: boolean;
  granularity: boolean;
  status: ReactNode;
}) {
  const { can } = useViewer();
  const directory = useDepartments();

  return (
    <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
      <RangePicker
        value={filters}
        limit={limit}
        today={today}
        billing={can('organization.read')}
        onApply={(range) => set(range)}
      />
      <div className="flex gap-2 md:contents">
        {departments ? (
          <Select
            value={filters.department ?? ALL_DEPARTMENTS}
            onValueChange={(value) =>
              set({ department: value === ALL_DEPARTMENTS ? null : value })
            }
          >
            <SelectTrigger
              aria-label="Department"
              className="min-w-0 flex-1 md:w-50 md:flex-none"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_DEPARTMENTS}>All departments</SelectItem>
              {directory.items.map((department) => (
                <SelectItem key={department.id} value={department.id}>
                  {department.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {granularity && (
          <ToggleGroup
            type="single"
            aria-label="Group by"
            value={filters.by}
            onValueChange={(value) => {
              if (value) set({ by: value as Granularity });
            }}
            className="rounded-lg bg-muted p-1"
          >
            {(['DAY', 'WEEK', 'MONTH'] as const).map((by) => (
              <ToggleGroupItem
                key={by}
                value={by}
                className="px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm"
              >
                {by === 'DAY' ? 'Day' : by === 'WEEK' ? 'Week' : 'Month'}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>
      {!departments && (
        <p className="text-sm text-muted-foreground">
          These numbers are for the whole organization.
        </p>
      )}
      <div className="md:ml-auto">{status}</div>
    </div>
  );
}
