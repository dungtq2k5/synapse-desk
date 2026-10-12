'use client';

import {
  getTicketsControllerGetV1QueryOptions,
  useTicketsControllerListV1,
  type TicketResponseDto,
  type TicketsControllerListV1Params,
  type TicketsControllerListV1SortBy,
} from '@synapsedesk/api-client';
import {
  REALTIME_EVENTS,
  TICKET_PATTERNS,
  type TicketCreatedEvent,
  type TicketDomainEvent,
} from '@synapsedesk/contracts';
import { keepPreviousData, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  InboxIcon,
  SearchXIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
import { UserAvatar } from '@/components/shell/user-avatar';
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useViewer } from '@/hooks/use-viewer';
import { absoluteTime, relativeTime } from '@/lib/format';
import { FIRST_PAGE } from '@/lib/tickets';
import { announce } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { PriorityBadge, SourceLabel, StatusBadge } from './badges';
import { TicketFilters, type Filters } from './ticket-filters';

/** How long a ticket that arrived live stays highlighted. */
const FRESH_MS = 2000;

/**
 * The ticket list, for both perspectives: an agent's queue (every column and
 * filter) or an end user's own tickets (Ticket, Status, Last update).
 * The first page arrives server-rendered; everything after is fetched here.
 */
export function TicketList() {
  const { isAgent, user, query: viewer } = useViewer();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>({});
  const [paging, setPaging] =
    useState<TicketsControllerListV1Params>(FIRST_PAGE);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());

  const params: TicketsControllerListV1Params = { ...paging, ...filters };
  const list = useTicketsControllerListV1(params, {
    query: { placeholderData: keepPreviousData },
  });
  const page = list.data?.data;
  const filtered = Object.values(filters).some((value) => value !== undefined);

  const changeFilters = useCallback((next: Filters) => {
    setFilters(next);
    setPaging((current) => ({ ...current, page: 1 }));
  }, []);

  const sortBy = (column: TicketsControllerListV1SortBy) =>
    setPaging((current) => ({
      ...current,
      page: 1,
      sortBy: column,
      sortOrder:
        current.sortBy === column && current.sortOrder === 'DESC'
          ? 'ASC'
          : 'DESC',
    }));

  useRealtimeEvent(
    REALTIME_EVENTS.ticketCreated,
    useCallback((event: TicketCreatedEvent) => {
      announce(`New ticket #${event.ticketNumber}: ${event.title}`);
      setFresh((ids) => new Set(ids).add(event.ticketId));
      globalThis.setTimeout(
        () =>
          setFresh((ids) => {
            const next = new Set(ids);
            next.delete(event.ticketId);
            return next;
          }),
        FRESH_MS,
      );
    }, []),
  );

  // A ticket the viewer held went to someone else: say who has it now.
  useRealtimeEvent(
    REALTIME_EVENTS.ticketUpdated,
    useCallback(
      (event: TicketDomainEvent) => {
        if (
          event.pattern !== TICKET_PATTERNS.reassigned ||
          !user ||
          event.fromAssigneeId !== user.id
        ) {
          return;
        }
        void queryClient
          .fetchQuery(getTicketsControllerGetV1QueryOptions(event.ticketId))
          .then((answer) =>
            toast.info(`Ticket #${event.ticketNumber} reassigned`, {
              description: `${answer.data?.assignee?.fullName ?? 'Someone else'} now owns this ticket.`,
            }),
          )
          .catch(() => undefined);
      },
      [queryClient, user],
    ),
  );

  const title = isAgent || viewer.isPending ? 'Tickets' : 'My tickets';
  const total = page?.meta.totalItems ?? 0;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {page &&
            `${total} ${total === 1 ? 'ticket' : 'tickets'}${filtered ? ' match' : ''}`}
        </p>
      </div>

      <TicketFilters filters={filters} onChange={changeFilters} />

      {list.isError && !page ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>
            <h2>Couldn’t load tickets</h2>
          </AlertTitle>
          <AlertDescription>
            Something went wrong on our side. Try again in a moment.
            <Button
              variant="outline"
              size="sm"
              onClick={() => void list.refetch()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : !page ? (
        <Loading agent={isAgent} />
      ) : page.items.length === 0 ? (
        filtered ? (
          <Empty
            icon={<SearchXIcon />}
            title="No tickets match"
            description="Try another search, or clear the filters."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => changeFilters({})}
              >
                Clear filters
              </Button>
            }
          />
        ) : isAgent ? (
          <Empty
            icon={<InboxIcon />}
            title="No tickets yet"
            description="New tickets appear here as soon as they arrive."
          />
        ) : (
          <Empty
            icon={<InboxIcon />}
            title="You haven’t raised any tickets"
            description="When you contact support, your tickets appear here so you can follow them."
          />
        )
      ) : (
        <>
          <div
            aria-busy={list.isFetching || undefined}
            className="hidden overflow-hidden rounded-lg border md:block"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead
                    label="Ticket"
                    column="ticketNumber"
                    paging={paging}
                    onSort={sortBy}
                  />
                  <SortHead
                    label="Status"
                    column="status"
                    paging={paging}
                    onSort={sortBy}
                  />
                  {isAgent && (
                    <>
                      <SortHead
                        label="Priority"
                        column="priority"
                        paging={paging}
                        onSort={sortBy}
                      />
                      <TableHead>Source</TableHead>
                      <TableHead>Assignee</TableHead>
                      <TableHead>Department</TableHead>
                    </>
                  )}
                  <SortHead
                    label={isAgent ? 'Updated' : 'Last update'}
                    column="updatedAt"
                    paging={paging}
                    onSort={sortBy}
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((ticket) => (
                  <TableRow
                    key={ticket.id}
                    className={cn(
                      'relative transition-colors duration-[2s] motion-reduce:transition-none',
                      fresh.has(ticket.id) && 'bg-accent',
                    )}
                  >
                    <TableCell className="max-w-0 w-full">
                      <TicketLink ticket={ticket} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={ticket.status} />
                    </TableCell>
                    {isAgent && (
                      <>
                        <TableCell>
                          <PriorityBadge priority={ticket.priority} />
                        </TableCell>
                        <TableCell>
                          <SourceLabel source={ticket.source} />
                        </TableCell>
                        <TableCell>
                          <Assignee ticket={ticket} />
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <Department ticket={ticket} />
                        </TableCell>
                      </>
                    )}
                    <TableCell className="text-muted-foreground">
                      <When at={ticket.updatedAt} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul
            aria-busy={list.isFetching || undefined}
            className="flex flex-col gap-2 md:hidden"
          >
            {page.items.map((ticket) => (
              <li
                key={ticket.id}
                className={cn(
                  'relative flex flex-col gap-2 rounded-lg border p-3 transition-colors duration-[2s] motion-reduce:transition-none',
                  fresh.has(ticket.id) && 'bg-accent',
                )}
              >
                <TicketLink ticket={ticket} />
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={ticket.status} />
                  {isAgent && <PriorityBadge priority={ticket.priority} />}
                </div>
                <p className="text-sm text-muted-foreground">
                  {isAgent && (
                    <>
                      {ticket.currentAssigneeId
                        ? (ticket.assignee?.fullName ?? 'Unknown user')
                        : 'Unassigned'}
                      {' · '}
                    </>
                  )}
                  {relativeTime(ticket.updatedAt)}
                </p>
              </li>
            ))}
          </ul>

          <Pagination
            meta={page.meta}
            paging={paging}
            onPaging={(next) =>
              setPaging((current) => ({ ...current, ...next }))
            }
          />
        </>
      )}
    </div>
  );
}

/**
 * The ticket's number and title, as a link covering its whole row. Its name
 * carries the unread count, so the count needs no announcement of its own.
 */
function TicketLink({ ticket }: { ticket: TicketResponseDto }) {
  const unread = ticket.unreadCount;
  return (
    <Link
      href={`/tickets/${ticket.id}`}
      aria-label={`#${ticket.ticketNumber} ${ticket.title}${
        unread
          ? `, ${unread} unread ${unread === 1 ? 'message' : 'messages'}`
          : ''
      }`}
      className="flex min-w-0 items-center gap-2 outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-2 focus-visible:after:ring-ring"
    >
      <span className="font-mono text-sm text-muted-foreground">
        #{ticket.ticketNumber}
      </span>
      <span className="truncate font-medium">{ticket.title}</span>
      {unread > 0 && (
        <span className="ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
          {unread}
        </span>
      )}
    </Link>
  );
}

/** "Unassigned" when nobody holds it; "Unknown user" when the name didn't resolve. */
function Assignee({ ticket }: { ticket: TicketResponseDto }) {
  if (!ticket.currentAssigneeId) {
    return <span className="text-muted-foreground">Unassigned</span>;
  }
  const name = ticket.assignee?.fullName ?? null;
  return (
    <span className="inline-flex items-center gap-2">
      <UserAvatar name={name} />
      <span className={cn(!name && 'text-muted-foreground')}>
        {name ?? 'Unknown user'}
      </span>
    </span>
  );
}

function Department({ ticket }: { ticket: TicketResponseDto }) {
  if (!ticket.currentDepartmentId) {
    return <span className="text-muted-foreground">—</span>;
  }
  return ticket.department ? (
    <>{ticket.department.name}</>
  ) : (
    <span className="text-muted-foreground">Unknown department</span>
  );
}

/** A relative time, with the absolute one on hover or focus. */
export function When({ at }: { at: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time dateTime={at} className="relative z-10">
          {relativeTime(at)}
        </time>
      </TooltipTrigger>
      <TooltipContent>{absoluteTime(at)}</TooltipContent>
    </Tooltip>
  );
}

function SortHead({
  label,
  column,
  paging,
  onSort,
}: {
  label: string;
  column: TicketsControllerListV1SortBy;
  paging: TicketsControllerListV1Params;
  onSort: (column: TicketsControllerListV1SortBy) => void;
}) {
  const sorted = paging.sortBy === column;
  const Icon = !sorted
    ? ArrowUpDownIcon
    : paging.sortOrder === 'ASC'
      ? ArrowUpIcon
      : ArrowDownIcon;
  return (
    <TableHead
      aria-sort={
        sorted
          ? paging.sortOrder === 'ASC'
            ? 'ascending'
            : 'descending'
          : 'none'
      }
    >
      <Button
        variant="ghost"
        size="sm"
        className="-ml-3"
        onClick={() => onSort(column)}
      >
        {label}
        <Icon aria-hidden className="text-muted-foreground" />
      </Button>
    </TableHead>
  );
}

function Pagination({
  meta,
  paging,
  onPaging,
}: {
  meta: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
    itemCount: number;
  };
  paging: TicketsControllerListV1Params;
  onPaging: (next: TicketsControllerListV1Params) => void;
}) {
  const from = (meta.currentPage - 1) * meta.itemsPerPage + 1;
  const to = from + meta.itemCount - 1;
  const pages = Math.max(1, meta.totalPages);
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
      <p className="text-muted-foreground">
        Showing {from}–{to} of {meta.totalItems}
      </p>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span id="rows-per-page">Rows per page</span>
          <Select
            value={String(paging.limit)}
            onValueChange={(value) =>
              onPaging({ limit: Number(value), page: 1 })
            }
          >
            <SelectTrigger
              size="sm"
              aria-labelledby="rows-per-page"
              className="w-20"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="shadow-md">
              {[10, 20, 50].map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span>
          Page {meta.currentPage} of {pages}
        </span>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous page"
            disabled={meta.currentPage <= 1}
            onClick={() => onPaging({ page: meta.currentPage - 1 })}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next page"
            disabled={meta.currentPage >= pages}
            onClick={() => onPaging({ page: meta.currentPage + 1 })}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      </div>
    </div>
  );
}

function Loading({ agent }: { agent: boolean }) {
  return (
    <div aria-busy className="flex flex-col gap-2">
      <span className="sr-only" role="status">
        Loading tickets
      </span>
      {Array.from({ length: 6 }, (_, row) => (
        <div
          key={row}
          className="flex items-center gap-4 rounded-lg border p-3"
        >
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-5 w-16 rounded-full" />
          {agent && (
            <Skeleton className="hidden h-5 w-16 rounded-full md:block" />
          )}
          <Skeleton className="hidden h-4 w-20 md:block" />
        </div>
      ))}
    </div>
  );
}

function Empty({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
      <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-5">
        {icon}
      </div>
      <h2 className="font-medium">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}
