import {
  useTicketsControllerListAssignmentsV1,
  useTicketsControllerListStatusChangesV1,
  type TicketResponseDto,
} from '@synapsedesk/api-client';
import { ArrowRightIcon, PanelRightIcon, UserIcon } from 'lucide-react';
import { useState } from 'react';
import { UserAvatar } from '@/components/shell/user-avatar';
import {
  PriorityBadge,
  SourceLabel,
  StatusBadge,
} from '@/components/tickets/badges';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useViewer } from '@/hooks/use-viewer';
import { absoluteTime } from '@/lib/format';
import { historyTimeline, type HistoryEvent } from '@/lib/history';
import { AiPanel } from './ai-panel';
import type { Suggestion } from './assign-dialog';
import { useDepartments, usePeople } from './use-directory';

/**
 * The ticket's side panel. An agent gets Details, AI and History as tabs;
 * anyone else, Details alone. Beside the thread on a wide screen; on a phone,
 * the same panel in a sheet from the header's Ticket details button.
 */
export function SidePanel({
  ticket,
  onAssignTo,
}: {
  ticket: TicketResponseDto;
  /** Opens the assign dialog on this department (the AI's suggestion). */
  onAssignTo?: (suggestion: Suggestion) => void;
}) {
  const { isAgent } = useViewer();
  if (!isAgent) {
    return (
      <section
        aria-labelledby="details-heading"
        className="flex flex-col gap-4 rounded-lg border p-4"
      >
        <h2 id="details-heading" className="font-semibold">
          Details
        </h2>
        <Details ticket={ticket} agent={false} />
      </section>
    );
  }
  return <AgentTabs ticket={ticket} onAssignTo={onAssignTo} />;
}

function AgentTabs({
  ticket,
  onAssignTo,
}: {
  ticket: TicketResponseDto;
  onAssignTo?: (suggestion: Suggestion) => void;
}) {
  const [tab, setTab] = useState('details');
  return (
    <Tabs value={tab} onValueChange={setTab} className="rounded-lg border p-4">
      <TabsList>
        <TabsTrigger value="details">Details</TabsTrigger>
        <TabsTrigger value="ai">AI</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
      </TabsList>
      <TabsContent value="details">
        <Details ticket={ticket} agent />
      </TabsContent>
      <TabsContent value="ai">
        <AiPanel ticket={ticket} onAssignTo={onAssignTo} />
      </TabsContent>
      <TabsContent value="history">
        <History ticketId={ticket.id} />
      </TabsContent>
    </Tabs>
  );
}

/** The phone's way to the side panel: a header button and a sheet. */
export function SidePanelSheet({
  ticket,
  onAssignTo,
}: {
  ticket: TicketResponseDto;
  onAssignTo?: (suggestion: Suggestion) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Ticket details"
          aria-haspopup="dialog"
        >
          <PanelRightIcon aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-md"
        aria-describedby={undefined}
      >
        <SheetHeader>
          <SheetTitle
            tabIndex={-1}
          >{`Ticket #${ticket.ticketNumber}`}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-4">
          <SidePanel
            ticket={ticket}
            onAssignTo={
              onAssignTo &&
              ((suggestion) => {
                setOpen(false);
                onAssignTo(suggestion);
              })
            }
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

const when = (at: string | null) =>
  at ? <time dateTime={at}>{absoluteTime(at)}</time> : '—';

function Person({ id, name }: { id: string | null; name: string | null }) {
  if (!id) return <span className="text-muted-foreground">Unassigned</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <UserAvatar name={name} />
      {name ?? <span className="text-muted-foreground">Unknown user</span>}
    </span>
  );
}

export function Details({
  ticket,
  agent,
}: {
  ticket: TicketResponseDto;
  agent: boolean;
}) {
  const rows: [string, React.ReactNode][] = [
    ...(agent
      ? [
          [
            'Requester',
            <Person
              key="r"
              id={ticket.authorId}
              name={ticket.author?.fullName ?? null}
            />,
          ] as [string, React.ReactNode],
        ]
      : []),
    ['Status', <StatusBadge key="s" status={ticket.status} />],
    ['Priority', <PriorityBadge key="p" priority={ticket.priority} />],
    [
      'Assignee',
      <Person
        key="a"
        id={ticket.currentAssigneeId}
        name={ticket.assignee?.fullName ?? null}
      />,
    ],
    [
      'Department',
      !ticket.currentDepartmentId
        ? '—'
        : (ticket.department?.name ?? (
            <span className="text-muted-foreground">Unknown department</span>
          )),
    ],
    ...(agent
      ? [
          ['Source', <SourceLabel key="src" source={ticket.source} />] as [
            string,
            React.ReactNode,
          ],
        ]
      : []),
    ['Created', when(ticket.createdAt)],
    ['Updated', when(ticket.updatedAt)],
    ['Escalated', when(ticket.escalatedAt)],
    ['Resolved', when(ticket.resolvedAt)],
  ];
  return (
    <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-3 text-sm">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Status changes and assignments, newest first. Assignments need
 * `ticket.read.all`; without it, only status changes. Names come from the
 * people and department lists, and an id that resolves to nobody says so.
 */
function History({ ticketId }: { ticketId: string }) {
  const { can } = useViewer();
  const changes = useTicketsControllerListStatusChangesV1(ticketId);
  const assignments = useTicketsControllerListAssignmentsV1(ticketId, {
    query: { enabled: can('ticket.read.all') },
  });
  const people = usePeople();
  const departments = useDepartments();

  if (changes.isPending || (can('ticket.read.all') && assignments.isPending)) {
    return (
      <div aria-busy className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const events = historyTimeline(
    changes.data?.data ?? [],
    assignments.data?.data ?? [],
  );
  const person = (id: string) => people.names.get(id) ?? 'Unknown user';
  const department = (id: string) =>
    departments.names.get(id) ?? 'Unknown department';

  return (
    <ol className="flex flex-col gap-4 text-sm">
      {events.map((event) => (
        <li key={event.id} className="flex gap-3">
          <span
            aria-hidden
            className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
          >
            {event.kind === 'status' ? (
              <ArrowRightIcon className="size-3" />
            ) : (
              <UserIcon className="size-3" />
            )}
          </span>
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">
              {line(event, person, department)}
            </span>
            <span className="text-xs text-muted-foreground">
              {'byId' in event ? `${person(event.byId)} · ` : null}
              {when(event.at)}
            </span>
            {event.kind === 'status' && event.reason && (
              <span className="text-xs">Reason: {event.reason}</span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function line(
  event: HistoryEvent,
  person: (id: string) => string,
  department: (id: string) => string,
): string {
  const because = (reason: string | null) => (reason ? `: ${reason}` : '');
  switch (event.kind) {
    case 'status':
      return `${event.from} → ${event.to}`;
    case 'assigned':
      return `Assigned to ${person(event.toId)} in ${department(event.departmentId)}${because(event.reason)}`;
    case 'moved':
      return `Moved to ${department(event.departmentId)}${because(event.reason)}`;
    case 'unassigned':
      return 'Unassigned';
  }
}
