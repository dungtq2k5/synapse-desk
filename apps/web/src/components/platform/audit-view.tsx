'use client';

import {
  usePlatformAuditLogsControllerListActionsV1,
  usePlatformAuditLogsControllerListV1,
  usePlatformControllerListOrganizationsV1,
  type PlatformAuditLogResponseDto,
  type PlatformAuditLogsControllerListV1Action as Action,
  type PlatformAuditLogsControllerListV1ResourceType as ResourceType,
} from '@synapsedesk/api-client';
import { ScrollTextIcon, SearchXIcon, XIcon } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Empty, Pagination } from '@/components/documents/parts';
import { rangeBounds } from '@/components/settings/audit/audit-view';
import { LoadError, Loading } from '@/components/settings/settings-frame';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  aboutOf,
  PLATFORM_KIND_WORDS,
  platformActionWords,
  reasonOf,
} from '@/lib/platform';
import { ConsolePage, Facts } from './console-page';
import { When } from './organization-view';
import { ChoiceFilter, Toolbar } from './toolbar';

const PAGE_SIZE = 20;

const RANGES: [string, string][] = [
  ['today', 'Today'],
  ['week', 'Last 7 days'],
  ['month', 'Last 30 days'],
  ['year', 'This year'],
];
type Range = 'today' | 'week' | 'month' | 'year';

type Filters = {
  action?: Action;
  userId?: string;
  resourceType?: ResourceType;
  resourceId?: string;
};

/**
 * The platform's own trail (08's layout): what Super Admins did to
 * organizations, plans, global roles and jobs. Each organization's own log
 * isn't here. Opened from an organization, it's filtered to it.
 */
export function PlatformAuditView() {
  const params = useSearchParams();
  const [filters, setFilters] = useState<Filters>(() => ({
    resourceType:
      (params.get('resourceType') as ResourceType | null) ?? undefined,
    resourceId: params.get('resourceId') ?? undefined,
  }));
  const [range, setRange] = useState<Range>(
    filters.resourceId ? 'year' : 'month',
  );
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<PlatformAuditLogResponseDto | null>(null);
  const bounds = useMemo(() => rangeBounds(range), [range]);
  const actions = usePlatformAuditLogsControllerListActionsV1({
    query: { staleTime: 300_000 },
  });
  const organizations = usePlatformControllerListOrganizationsV1(
    { limit: 100, sortBy: 'name', sortOrder: 'ASC', includeDeleted: true },
    { query: { staleTime: 60_000 } },
  );
  const list = usePlatformAuditLogsControllerListV1({
    page,
    limit: PAGE_SIZE,
    sortOrder: 'DESC',
    ...filters,
    from: bounds.from.toISOString(),
    to: bounds.to.toISOString(),
  });
  const data = list.data?.data;
  const organizationNames = useMemo(
    () =>
      new Map(
        (organizations.data?.data?.items ?? []).map((row) => [
          row.organization.id,
          row.organization.name,
        ]),
      ),
    [organizations.data],
  );
  // Super Admins, by who appears in the trail: there's no list of them.
  const [people, setPeople] = useState<ReadonlyMap<string, string>>(new Map());
  const seen = (data?.items ?? []).filter(
    (entry) => entry.userId && entry.actorName && !people.has(entry.userId),
  );
  if (seen.length) {
    const next = new Map(people);
    for (const entry of seen) next.set(entry.userId!, entry.actorName!);
    setPeople(next);
  }

  const change = (next: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...next }));
    setPage(1);
  };
  const filtered =
    Boolean(filters.action || filters.userId || filters.resourceType) ||
    range !== 'month';
  const clear = () => {
    setFilters({});
    setRange('month');
    setPage(1);
  };
  const subject = filters.resourceId
    ? (data?.items.find((entry) => entry.resourceId === filters.resourceId)
        ?.resourceName ?? organizationNames.get(filters.resourceId))
    : null;

  return (
    <ConsolePage
      crumbs={[{ label: 'Audit log' }]}
      title="Audit log"
      description="What Super Admins did: to organizations, plans, global roles and jobs. Each organization keeps its own log; it isn’t here."
    >
      <Toolbar>
        <ChoiceFilter
          label="Action"
          all="All actions"
          value={filters.action}
          options={(actions.data?.data?.actions ?? []).map(
            (action): [string, string] => [action, platformActionWords(action)],
          )}
          onValue={(action) => change({ action: action as Action | undefined })}
        />
        <ChoiceFilter
          label="Person"
          all="Everyone"
          value={filters.userId}
          options={[...people.entries()]}
          onValue={(userId) => change({ userId })}
        />
        {filters.resourceId ? (
          <Button
            variant="outline"
            className="justify-between md:w-auto"
            onClick={() =>
              change({ resourceId: undefined, resourceType: undefined })
            }
          >
            {subject ??
              PLATFORM_KIND_WORDS[filters.resourceType ?? ''] ??
              'One item'}
            <XIcon aria-hidden />
            <span className="sr-only">Show anything</span>
          </Button>
        ) : (
          <ChoiceFilter
            label="About"
            all="Anything"
            value={filters.resourceType}
            options={Object.entries(PLATFORM_KIND_WORDS)}
            onValue={(resourceType) =>
              change({ resourceType: resourceType as ResourceType | undefined })
            }
          />
        )}
        <ChoiceFilter
          label="When"
          all="Last 30 days"
          value={range === 'month' ? undefined : range}
          options={RANGES.filter(([key]) => key !== 'month')}
          onValue={(value) => {
            setRange((value as Range | undefined) ?? 'month');
            setPage(1);
          }}
        />
      </Toolbar>
      {list.isError && !data ? (
        <LoadError what="the audit log" onRetry={() => void list.refetch()} />
      ) : !data ? (
        <Loading what="the audit log" className="h-96" />
      ) : data.items.length === 0 && filtered ? (
        <Empty
          icon={<SearchXIcon />}
          title="No entries match"
          description="Try a wider date range or fewer filters."
          action={
            <Button variant="outline" size="sm" onClick={clear}>
              Clear filters
            </Button>
          }
        />
      ) : data.items.length === 0 ? (
        <Empty
          icon={<ScrollTextIcon />}
          title="Nothing in the audit log yet"
          description=""
        />
      ) : (
        <>
          <div
            aria-busy={list.isFetching || undefined}
            className="hidden overflow-x-auto rounded-lg border md:block"
          >
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>About</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <button
                        type="button"
                        className="text-left underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                        onClick={() => setOpen(entry)}
                      >
                        <When at={entry.createdAt} />
                      </button>
                    </TableCell>
                    <TableCell>{entry.actorName ?? '—'}</TableCell>
                    <TableCell>{platformActionWords(entry.action)}</TableCell>
                    <TableCell className="whitespace-normal">
                      <AboutCell entry={entry} names={organizationNames} />
                    </TableCell>
                    <TableCell className="max-w-64 whitespace-normal">
                      {reasonOf(entry.metadata) ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden">
            {data.items.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-col gap-1.5 rounded-lg border bg-card p-4 text-sm"
              >
                <button
                  type="button"
                  className="text-left font-medium"
                  onClick={() => setOpen(entry)}
                >
                  {platformActionWords(entry.action)}
                </button>
                <AboutCell entry={entry} names={organizationNames} />
                {reasonOf(entry.metadata) && (
                  <span className="text-muted-foreground">
                    “{reasonOf(entry.metadata)}”
                  </span>
                )}
                <span className="text-muted-foreground">
                  {entry.actorName ?? '—'} · <When at={entry.createdAt} />
                </span>
              </li>
            ))}
          </ul>
          {data.meta.totalPages > 1 && (
            <Pagination
              meta={data.meta}
              onPage={setPage}
              noun="entries"
              stacked
            />
          )}
        </>
      )}
      <EntrySheet
        entry={open}
        names={organizationNames}
        onClose={() => setOpen(null)}
      />
    </ConsolePage>
  );
}

function AboutCell({
  entry,
  names,
}: {
  entry: PlatformAuditLogResponseDto;
  names: ReadonlyMap<string, string>;
}) {
  const about = aboutOf(
    entry,
    typeof entry.metadata?.organizationId === 'string'
      ? names.get(entry.metadata.organizationId)
      : null,
  );
  return (
    <span className="flex flex-col gap-0.5">
      {about.href ? (
        <Link
          href={about.href}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {about.name}
        </Link>
      ) : (
        <span className="font-medium">{about.name}</span>
      )}
      <span className="text-muted-foreground">
        {[about.kind, about.details].filter(Boolean).join(' · ')}
      </span>
    </span>
  );
}

/** One entry in full, as 08's sheet shows it. */
function EntrySheet({
  entry,
  names,
  onClose,
}: {
  entry: PlatformAuditLogResponseDto | null;
  names: ReadonlyMap<string, string>;
  onClose: () => void;
}) {
  return (
    <Sheet open={entry !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {entry && (
          <>
            <SheetHeader>
              <SheetTitle>{platformActionWords(entry.action)}</SheetTitle>
              <SheetDescription>
                <When at={entry.createdAt} />
              </SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-4">
              <Facts
                rows={[
                  ['Who', entry.actorName ?? '—'],
                  [
                    'About',
                    <AboutCell key="about" entry={entry} names={names} />,
                  ],
                  ['Reason', reasonOf(entry.metadata) ?? '—'],
                  ['From', entry.ipAddress ?? '—'],
                ]}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
