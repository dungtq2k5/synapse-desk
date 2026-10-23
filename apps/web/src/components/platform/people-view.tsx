'use client';

import {
  usePlatformControllerListOrganizationsV1,
  usePlatformControllerListUsersV1,
  type PlatformUserResponseDto,
} from '@synapsedesk/api-client';
import { MailWarningIcon, SearchXIcon, UsersIcon } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { Empty, Pagination } from '@/components/documents/parts';
import { PersonStatus, Status, TwoStep } from '@/components/settings/badges';
import { LoadError, Loading } from '@/components/settings/settings-frame';
import { UserAvatar } from '@/components/shell/user-avatar';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { absoluteTime, calendarDate } from '@/lib/format';
import { ConsolePage } from './console-page';
import { ChoiceFilter, SearchBox, SwitchFilter, Toolbar } from './toolbar';

const PAGE_SIZE = 20;

type Filters = {
  searchTerm?: string;
  organizationId?: string;
  includeDeleted?: boolean;
};

/**
 * Everyone in every organization, to find someone for a support case.
 * Read-only; a row opens the person's organization. "Find its people" on an
 * organization lands here filtered to it.
 */
export function PeopleView() {
  const params = useSearchParams();
  const [filters, setFilters] = useState<Filters>(() => ({
    organizationId: params.get('organizationId') ?? undefined,
  }));
  const [page, setPage] = useState(1);
  const [cleared, setCleared] = useState(0);
  const list = usePlatformControllerListUsersV1({
    page,
    limit: PAGE_SIZE,
    sortBy: 'fullName',
    sortOrder: 'ASC',
    searchTerm: filters.searchTerm,
    organizationId: filters.organizationId,
    includeDeleted: filters.includeDeleted || undefined,
  });
  const organizations = usePlatformControllerListOrganizationsV1(
    { limit: 100, sortBy: 'name', sortOrder: 'ASC' },
    { query: { staleTime: 60_000 } },
  );
  const change = useCallback((next: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...next }));
    setPage(1);
  }, []);
  const search = useCallback(
    (searchTerm: string | undefined) => change({ searchTerm }),
    [change],
  );
  const data = list.data?.data;
  const filtered = Boolean(filters.searchTerm || filters.organizationId);
  const options = (organizations.data?.data?.items ?? []).map(
    (row): [string, string] => [row.organization.id, row.organization.name],
  );

  return (
    <ConsolePage
      crumbs={[{ label: 'People' }]}
      title="People"
      description="Everyone in every organization, to find someone for a support case. Read-only: their organization’s admins make changes."
    >
      <Toolbar key={cleared}>
        <SearchBox
          label="Search by name or email"
          value={filters.searchTerm}
          onSearch={search}
        />
        <ChoiceFilter
          label="Organization"
          all="All organizations"
          value={filters.organizationId}
          options={options}
          onValue={(organizationId) => change({ organizationId })}
        />
        <SwitchFilter
          label="Show deleted"
          checked={Boolean(filters.includeDeleted)}
          onChange={(includeDeleted) => change({ includeDeleted })}
        />
      </Toolbar>
      {list.isError && !data ? (
        <LoadError what="people" onRetry={() => void list.refetch()} />
      ) : !data ? (
        <Loading what="people" className="h-96" />
      ) : data.items.length === 0 && filtered ? (
        <Empty
          icon={<SearchXIcon />}
          title="Nobody matches"
          description="Try another name, email or organization."
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                change({ searchTerm: undefined, organizationId: undefined });
                setCleared((n) => n + 1);
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : data.items.length === 0 ? (
        <Empty icon={<UsersIcon />} title="Nobody matches" description="" />
      ) : (
        <>
          <div
            aria-busy={list.isFetching || undefined}
            className="hidden overflow-hidden rounded-lg border md:block"
          >
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last sign-in</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((row) => (
                  <TableRow key={row.user.id}>
                    <TableCell>
                      <Person row={row} />
                    </TableCell>
                    <TableCell>
                      <OrganizationLink row={row} />
                    </TableCell>
                    <TableCell className="max-w-48 whitespace-normal">
                      {row.roleNames.join(', ') || '—'}
                    </TableCell>
                    <TableCell>
                      <Badges row={row} />
                    </TableCell>
                    <TableCell>
                      {row.user.lastLoginAt
                        ? absoluteTime(row.user.lastLoginAt)
                        : 'Never'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden">
            {data.items.map((row) => (
              <li
                key={row.user.id}
                className="flex flex-col gap-2 rounded-lg border bg-card p-4 text-sm"
              >
                <Person row={row} />
                <OrganizationLink row={row} />
                <p className="text-muted-foreground">
                  {row.roleNames.join(', ') || '—'}
                </p>
                <Badges row={row} />
                <p className="text-muted-foreground">
                  Last sign-in{' '}
                  {row.user.lastLoginAt
                    ? absoluteTime(row.user.lastLoginAt)
                    : 'never'}
                </p>
              </li>
            ))}
          </ul>
          {data.meta.totalPages > 1 && (
            <Pagination
              meta={data.meta}
              onPage={setPage}
              noun="people"
              stacked
            />
          )}
        </>
      )}
    </ConsolePage>
  );
}

function Person({ row }: { row: PlatformUserResponseDto }) {
  return (
    <span className="flex items-center gap-2">
      <UserAvatar
        name={row.user.fullName}
        src={row.user.avatarUrl}
        className="size-8"
      />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{row.user.fullName}</span>
        <span className="truncate text-xs text-muted-foreground">
          {row.user.email}
        </span>
      </span>
    </span>
  );
}

function OrganizationLink({ row }: { row: PlatformUserResponseDto }) {
  return row.organizationId ? (
    <Link
      href={`/platform/organizations/${row.organizationId}`}
      className="font-medium text-primary underline-offset-4 hover:underline"
    >
      {row.organizationName ?? '—'}
    </Link>
  ) : (
    <span>—</span>
  );
}

function Badges({ row }: { row: PlatformUserResponseDto }) {
  return (
    <span className="flex flex-wrap gap-1">
      <PersonStatus
        deleted={row.deletedAt !== null}
        locked={row.user.isLocked}
        lockedUntil={
          row.user.lockedUntil ? calendarDate(row.user.lockedUntil) : null
        }
      />
      {row.user.isTwoFactorEnabled && <TwoStep on />}
      {!row.user.isEmailVerified && (
        <Status tone="warning" icon={MailWarningIcon}>
          Email not verified
        </Status>
      )}
    </span>
  );
}
