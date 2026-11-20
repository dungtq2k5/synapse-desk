'use client';

import {
  usePlatformControllerListOrganizationsV1,
  type PlatformControllerListOrganizationsV1Params,
  type PlatformOrganizationResponseDto,
} from '@synapsedesk/api-client';
import { Building2Icon, PlusIcon, SearchXIcon } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { Empty, Pagination } from '@/components/documents/parts';
import { LoadError, Loading } from '@/components/settings/settings-frame';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { dayDate } from '@/lib/format';
import { consoleStatus, count, STATUS_WORDS } from '@/lib/platform';
import { ConsoleStatusBadge } from './badges';
import { ConsolePage } from './console-page';
import { ChoiceFilter, SearchBox, SwitchFilter, Toolbar } from './toolbar';

const PAGE_SIZE = 10;

type Filters = {
  searchTerm?: string;
  status?: PlatformControllerListOrganizationsV1Params['status'];
  includeDeleted?: boolean;
};

const STATUSES: [string, string][] = [
  ['ACTIVE', STATUS_WORDS.ACTIVE],
  ['PENDING_ONBOARDING', STATUS_WORDS.PENDING_ONBOARDING],
  ['SUSPENDED_PAST_DUE', STATUS_WORDS.SUSPENDED_PAST_DUE],
  ['FROZEN', STATUS_WORDS.FROZEN],
];

/**
 * Every organization, by name: search, a status, and "Show offboarded",
 * which adds the offboarded ones, each with the day it left.
 */
export function OrganizationsView() {
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [cleared, setCleared] = useState(0);
  const list = usePlatformControllerListOrganizationsV1({
    page,
    limit: PAGE_SIZE,
    sortBy: 'name',
    sortOrder: 'ASC',
    searchTerm: filters.searchTerm,
    status: filters.status,
    includeDeleted: filters.includeDeleted || undefined,
  });
  const change = useCallback((next: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...next }));
    setPage(1);
  }, []);
  const search = useCallback(
    (searchTerm: string | undefined) => change({ searchTerm }),
    [change],
  );
  const data = list.data?.data;
  const filtered = Boolean(filters.searchTerm || filters.status);

  return (
    <ConsolePage
      crumbs={[{ label: 'Organizations' }]}
      title="Organizations"
      description="Every organization on SynapseDesk. Open one to see it, change its status or offboard it."
      actions={
        <Link
          href="/platform/organizations/new"
          className={buttonVariants({ variant: 'default' })}
        >
          <PlusIcon aria-hidden />
          New organization
        </Link>
      }
    >
      <Toolbar key={cleared}>
        <SearchBox
          label="Search by name, address or domain"
          value={filters.searchTerm}
          onSearch={search}
        />
        <ChoiceFilter
          label="Status"
          all="All statuses"
          value={filters.status}
          options={STATUSES}
          onValue={(status) => change({ status: status as Filters['status'] })}
        />
        <SwitchFilter
          label="Show offboarded"
          checked={Boolean(filters.includeDeleted)}
          onChange={(includeDeleted) => change({ includeDeleted })}
        />
      </Toolbar>
      {list.isError && !data ? (
        <LoadError what="organizations" onRetry={() => void list.refetch()} />
      ) : !data ? (
        <Loading what="organizations" className="h-96" />
      ) : data.items.length === 0 && filtered ? (
        <Empty
          icon={<SearchXIcon />}
          title="No organizations match"
          description="Try another name, address or status."
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                change({ searchTerm: undefined, status: undefined });
                setCleared((n) => n + 1);
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : data.items.length === 0 ? (
        <Empty
          icon={<Building2Icon />}
          title="No organizations yet"
          description="Create the first one."
        />
      ) : (
        <>
          <div
            aria-busy={list.isFetching || undefined}
            className="hidden overflow-hidden rounded-lg border md:block"
          >
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">People</TableHead>
                  <TableHead className="text-right">Seats</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((row) => (
                  <TableRow key={row.organization.id}>
                    <TableCell>
                      <NameCell row={row} />
                    </TableCell>
                    <TableCell>
                      <StatusCell row={row} />
                    </TableCell>
                    <TableCell>{row.planName ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.userCount.toLocaleString('en-US')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.organization.maxAgentSeats.toLocaleString('en-US')}
                    </TableCell>
                    <TableCell>{dayDate(row.organization.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul
            aria-busy={list.isFetching || undefined}
            className="flex flex-col gap-2 md:hidden"
          >
            {data.items.map((row) => (
              <li
                key={row.organization.id}
                className="flex flex-col gap-2 rounded-lg border bg-card p-4 text-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/platform/organizations/${row.organization.id}`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {row.organization.name}
                  </Link>
                  <ConsoleStatusBadge
                    status={consoleStatus(
                      row.organization.status,
                      row.deletedAt,
                    )}
                  />
                </div>
                <p className="text-muted-foreground">
                  {[
                    row.planName,
                    count(row.userCount, 'person', 'people'),
                    count(row.organization.maxAgentSeats, 'seat'),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <p className="text-muted-foreground">
                  Created {dayDate(row.organization.createdAt)}
                  {row.deletedAt && ` · Left ${dayDate(row.deletedAt)}`}
                </p>
              </li>
            ))}
          </ul>
          {data.meta.totalPages > 1 && (
            <Pagination
              meta={data.meta}
              onPage={setPage}
              noun="organizations"
              stacked
            />
          )}
        </>
      )}
    </ConsolePage>
  );
}

function NameCell({ row }: { row: PlatformOrganizationResponseDto }) {
  return (
    <div className="flex flex-col gap-1">
      <Link
        href={`/platform/organizations/${row.organization.id}`}
        className="font-medium text-primary underline-offset-4 hover:underline"
      >
        {row.organization.name}
      </Link>
      <span className="text-muted-foreground">{row.organization.slug}</span>
    </div>
  );
}

function StatusCell({ row }: { row: PlatformOrganizationResponseDto }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <ConsoleStatusBadge
        status={consoleStatus(row.organization.status, row.deletedAt)}
      />
      {row.deletedAt && (
        <span className="text-xs text-muted-foreground">
          Left {dayDate(row.deletedAt)}
        </span>
      )}
    </div>
  );
}
