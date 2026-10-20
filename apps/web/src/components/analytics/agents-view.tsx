'use client';

import {
  useAnalyticsControllerAgentsV1,
  type AgentStatResponseDto,
} from '@synapsedesk/api-client';
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  RotateCwIcon,
  TriangleAlertIcon,
  UsersIcon,
} from 'lucide-react';
import { useState } from 'react';
import { LoadError } from '@/components/settings/settings-frame';
import { UserAvatar } from '@/components/shell/user-avatar';
import { useDepartments } from '@/components/ticket/use-directory';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { count, duration, rateText, shortDay } from '@/lib/analytics';
import { AnalyticsFrame, DataThrough, useAnalyticsFilters } from './frame';

/** What each source of the agents read is, when it can't be read. */
const BLOCKS: Record<string, string> = {
  'ticket-service': 'Agents couldn’t be read',
  'ingestion-service': 'AI draft acceptance couldn’t be read',
  'auth-service': 'Agent names couldn’t be read',
};

type Column = {
  key: string;
  label: string;
  sortLabel: string;
  sort: (row: AgentStatResponseDto) => number | string;
  cell: (row: AgentStatResponseDto, unavailable: Set<string>) => string;
};

const nameOf = (row: AgentStatResponseDto) => row.fullName ?? 'Unknown agent';

const COLUMNS: Column[] = [
  {
    key: 'name',
    label: 'Agent',
    sortLabel: 'Name (A to Z)',
    sort: (row) => nameOf(row).toLowerCase(),
    cell: (row, unavailable) =>
      unavailable.has('auth-service') ? 'Not available' : nameOf(row),
  },
  {
    key: 'assigned',
    label: 'Assigned',
    sortLabel: 'Assigned',
    sort: (row) => row.assigned,
    cell: (row) => count(row.assigned),
  },
  {
    key: 'resolved',
    label: 'Resolved',
    sortLabel: 'Resolved',
    sort: (row) => row.resolved,
    cell: (row) => count(row.resolved),
  },
  {
    key: 'messages',
    label: 'Messages sent',
    sortLabel: 'Messages sent',
    sort: (row) => row.messagesSent,
    cell: (row) => count(row.messagesSent),
  },
  {
    key: 'resolution',
    label: 'Mean resolution time',
    sortLabel: 'Mean resolution time',
    sort: (row) => row.resolutionSeconds.mean ?? -1,
    cell: (row) =>
      row.resolutionSeconds.mean == null
        ? '—'
        : `${duration(row.resolutionSeconds.mean)} (${count(row.resolutionSeconds.count)})`,
  },
  {
    key: 'drafts',
    label: 'AI draft acceptance',
    sortLabel: 'AI draft acceptance',
    sort: (row) => row.draftAcceptance?.rate ?? -1,
    cell: (row, unavailable) =>
      unavailable.has('ingestion-service')
        ? 'Not available'
        : row.draftAcceptance?.rate == null
          ? '—'
          : rateText(row.draftAcceptance),
  },
];

/** Analytics › Agents: what each agent handled, listed by name. */
export function AgentsView() {
  const filters = useAnalyticsFilters();
  const { from, to, department, by } = filters.filters;
  const agents = useAnalyticsControllerAgentsV1(
    {
      from,
      to,
      ...(department ? { departmentId: department } : {}),
      granularity: by,
    },
    { query: { enabled: filters.ready } },
  );
  const data = agents.data?.data;
  const directory = useDepartments();
  const [sort, setSort] = useState<{ key: string; descending: boolean }>({
    key: 'name',
    descending: false,
  });

  let body;
  if (agents.isError) {
    body = <LoadError what="analytics" onRetry={() => void agents.refetch()} />;
  } else if (!data) {
    body = (
      <div aria-busy>
        <span className="sr-only" role="status">
          Loading analytics
        </span>
        <Skeleton aria-hidden className="h-80 w-full rounded-xl" />
      </div>
    );
  } else {
    const unavailable = new Set(data.unavailable.map((block) => block.source));
    const column = COLUMNS.find((one) => one.key === sort.key) ?? COLUMNS[0];
    const sorted = [...data.items].sort((a, b) => {
      const x = column.sort(a);
      const y = column.sort(b);
      const order = x < y ? -1 : x > y ? 1 : 0;
      return sort.descending ? -order : order;
    });
    const retry = () => void agents.refetch();
    body = (
      <div className="flex flex-col gap-6">
        {data.unavailable.map((block) => (
          <Alert key={block.source} variant="warning">
            <TriangleAlertIcon aria-hidden />
            <AlertTitle>
              {BLOCKS[block.source] ?? 'Part of this page couldn’t be read'}
            </AlertTitle>
            <AlertDescription>
              <p>
                The other columns are up to date. Try again in a few minutes.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={retry}
              >
                <RotateCwIcon aria-hidden />
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ))}
        {data.items.length === 0 && !unavailable.has('ticket-service') ? (
          <section className="flex flex-col items-center gap-3 rounded-xl border px-6 py-12 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-muted">
              <UsersIcon aria-hidden className="size-5" />
            </span>
            <h2 className="font-semibold">No agent activity in this period</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {`No agent was assigned a ticket or sent a message in ${department ? (directory.names.get(department) ?? 'this department') : 'any department'} between ${shortDay(from)} and ${shortDay(to)}. Try a longer range or another department.`}
            </p>
            {department && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => filters.set({ department: null })}
              >
                Clear the department
              </Button>
            )}
          </section>
        ) : (
          <section
            aria-labelledby="agents-title"
            className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-5"
          >
            <div className="space-y-1">
              <h2 id="agents-title" className="font-semibold">
                Agents
              </h2>
              <p className="text-sm text-muted-foreground">
                {`${count(data.items.length)} ${data.items.length === 1 ? 'agent' : 'agents'} with tickets or messages in the period.`}
              </p>
              <p className="pt-2 text-sm text-muted-foreground">
                Listed by name. Sort by any column; the page doesn’t rank
                people.
              </p>
            </div>
            <div className="hidden overflow-hidden rounded-md border md:block">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    {COLUMNS.map((one, index) => {
                      const active = sort.key === one.key;
                      const Icon = !active
                        ? ArrowUpDownIcon
                        : sort.descending
                          ? ArrowDownIcon
                          : ArrowUpIcon;
                      return (
                        <TableHead
                          key={one.key}
                          aria-sort={
                            active
                              ? sort.descending
                                ? 'descending'
                                : 'ascending'
                              : 'none'
                          }
                          className={index > 0 ? 'text-right' : undefined}
                        >
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                            onClick={() =>
                              setSort({
                                key: one.key,
                                descending: active
                                  ? !sort.descending
                                  : one.key !== 'name',
                              })
                            }
                          >
                            {one.label}
                            <Icon aria-hidden className="size-3.5" />
                          </button>
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((row) => (
                    <TableRow key={row.agentId}>
                      {COLUMNS.map((one, index) =>
                        index === 0 ? (
                          <TableCell key={one.key}>
                            <span className="flex items-center gap-2">
                              <UserAvatar
                                name={nameOf(row)}
                                className="size-7"
                              />
                              {one.cell(row, unavailable)}
                            </span>
                          </TableCell>
                        ) : (
                          <TableCell
                            key={one.key}
                            className="text-right tabular-nums"
                          >
                            {one.cell(row, unavailable)}
                          </TableCell>
                        ),
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-col gap-3 md:hidden">
              <Select
                value={sort.key}
                onValueChange={(key) =>
                  setSort({ key, descending: key !== 'name' })
                }
              >
                <SelectTrigger aria-label="Sort" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COLUMNS.map((one) => (
                    <SelectItem key={one.key} value={one.key}>
                      {`Sort: ${one.sortLabel}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ul className="flex flex-col gap-3">
                {sorted.map((row) => (
                  <li key={row.agentId} className="rounded-lg border p-3">
                    <p className="mb-2 flex items-center gap-2 font-medium">
                      <UserAvatar name={nameOf(row)} className="size-7" />
                      {COLUMNS[0].cell(row, unavailable)}
                    </p>
                    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
                      {COLUMNS.slice(1).map((one) => (
                        <div key={one.key} className="contents">
                          <dt className="text-muted-foreground">{one.label}</dt>
                          <dd className="text-right tabular-nums">
                            {one.cell(row, unavailable)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
      </div>
    );
  }

  return (
    <AnalyticsFrame
      section="agents"
      filters={filters}
      status={data && <DataThrough dataThrough={data.dataThrough} />}
    >
      {body}
    </AnalyticsFrame>
  );
}
