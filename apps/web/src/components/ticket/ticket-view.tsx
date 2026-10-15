'use client';

import {
  aiControllerGenerateDraftV1,
  ApiError,
  messagesControllerPresignNewAttachmentV1,
  ticketsControllerEscalateV1,
  type UploadAttachmentDtoMimeType,
  useMessagesControllerListV1,
  useTicketsControllerGetV1,
  useTicketsControllerListStatusChangesV1,
  type TicketResponseDto,
} from '@synapsedesk/api-client';
import { LoaderCircleIcon, UsersIcon } from 'lucide-react';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppHeader } from '@/components/shell/app-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useViewer } from '@/hooks/use-viewer';
import { buildThread, lastNonAnswerId, type Entry } from '@/lib/thread';
import {
  BEFORE_ESCALATION,
  PRIORITY_LABEL,
  STATUS_LABEL,
  THREAD_PAGE,
} from '@/lib/tickets';
import { announce, toastError } from '@/lib/toast';
import { PriorityBadge, StatusBadge } from '@/components/tickets/badges';
import { ActionBar, DeletedNotice } from './action-bar';
import { AssignDialog, type Suggestion } from './assign-dialog';
import { Composer } from './composer';
import {
  LiveAnswerEntry,
  NoticeEntry,
  PendingEntry,
  PersonEntry,
  type Perspective,
} from './entries';
import { SidePanel, SidePanelSheet } from './side-panel';
import { useTicketCache } from './use-directory';
import { useLiveTicket } from './use-live-ticket';
import { ThreadAiMessage, ThreadMessage } from './message-tools';

/** One ticket: its header, the live thread with the composer, and its details. */
export function TicketView({ ticketId }: { ticketId: string }) {
  const ticket = useTicketsControllerGetV1(ticketId);
  const data = ticket.data?.data;
  const { can } = useViewer();
  const refresh = useTicketCache(ticketId);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  // The AI's "Assign to {department}", where the agent may assign.
  const onAssignTo =
    data &&
    !data.deletedAt &&
    can(data.currentAssigneeId ? 'ticket.reassign' : 'ticket.assign')
      ? (suggested: Suggestion) => setSuggestion(suggested)
      : undefined;

  if (ticket.isError) {
    const gone =
      ticket.error instanceof ApiError &&
      [400, 403, 404].includes(ticket.error.status);
    if (gone) return <TicketNotFound />;
  }

  return (
    <>
      <AppHeader
        crumbs={[
          { label: 'Tickets', href: '/tickets' },
          { label: data ? `#${data.ticketNumber}` : '…' },
        ]}
        actions={
          data && (
            <div className="lg:hidden">
              <SidePanelSheet ticket={data} onAssignTo={onAssignTo} />
            </div>
          )
        }
      />
      <main id="main" tabIndex={-1} className="outline-none">
        {data ? <Loaded ticket={data} onAssignTo={onAssignTo} /> : <Loading />}
      </main>
      {data && (
        <AssignDialog
          ticket={data}
          open={suggestion !== null}
          onOpenChange={(open) => !open && setSuggestion(null)}
          onAssigned={refresh}
          suggestion={suggestion ?? undefined}
        />
      )}
    </>
  );
}

function Loaded({
  ticket,
  onAssignTo,
}: {
  ticket: TicketResponseDto;
  onAssignTo?: (suggestion: Suggestion) => void;
}) {
  const { user, isAgent, can } = useViewer();
  const viewerId = user?.id ?? null;
  const requester = viewerId !== null && ticket.authorId === viewerId;
  // ticket-service's posting rule: the author or the current assignee, never
  // on a closed ticket. Saying so beats a composer whose send fails.
  const holder = viewerId !== null && ticket.currentAssigneeId === viewerId;
  const closed = ticket.status === 'CLOSED';
  const deleted = Boolean(ticket.deletedAt);
  const open = BEFORE_ESCALATION.has(ticket.status);
  const perspective: Perspective = isAgent
    ? 'agent'
    : open
      ? 'requester'
      : 'requester-escalated';

  const messages = useMessagesControllerListV1(ticket.id, THREAD_PAGE);
  const history = useTicketsControllerListStatusChangesV1(ticket.id);
  const live = useLiveTicket(ticket.id, { invokeAi: requester && open });

  const entries = useMemo(
    () =>
      buildThread({
        ticket,
        messages: [...(messages.data?.data?.items ?? [])].reverse(),
        history: history.data?.data ?? [],
        viewerId,
        pending: live.pending,
        answers: live.answers,
        notices: live.notices,
      }),
    [
      ticket,
      messages.data,
      history.data,
      viewerId,
      live.pending,
      live.answers,
      live.notices,
    ],
  );

  // Names for the typing line, from everyone the thread already names.
  const names = useMemo(() => {
    const known = new Map<string, string>();
    if (ticket.author) known.set(ticket.authorId, ticket.author.fullName);
    if (ticket.assignee)
      known.set(ticket.assignee.id, ticket.assignee.fullName);
    for (const message of messages.data?.data?.items ?? []) {
      if (message.sender) known.set(message.sender.id, message.sender.fullName);
    }
    return known;
  }, [ticket, messages.data]);

  useChangeAnnouncements(ticket);

  const [asking, setAsking] = useState(false);
  const focusEscalation = useRef(false);
  const askAPerson = async () => {
    setAsking(true);
    // Before the call: the room's update can bring the notice before the
    // call itself answers, and the notice takes focus as it appears.
    focusEscalation.current = true;
    try {
      await ticketsControllerEscalateV1(ticket.id, {});
      live.refetch({ ticket: true });
    } catch {
      focusEscalation.current = false;
      toastError('Couldn’t reach the support team', 'Try again in a moment.', {
        label: 'Try again',
        onClick: () => void askAPerson(),
      });
    } finally {
      setAsking(false);
    }
  };
  const lastEscalation = [...entries]
    .reverse()
    .find(
      (entry) => entry.kind === 'notice' && entry.notice.kind === 'escalated',
    );
  const focusNotice = useCallback((node: HTMLDivElement | null) => {
    if (node && focusEscalation.current) {
      focusEscalation.current = false;
      node.focus();
    }
  }, []);

  const streaming = live.answers.some((answer) => answer.state === 'streaming');
  const offerFor =
    requester && open && !streaming ? lastNonAnswerId(entries) : null;
  const askButton = (
    <Button
      variant="outline"
      size="sm"
      className="self-start"
      aria-busy={asking || undefined}
      disabled={asking}
      onClick={() => void askAPerson()}
    >
      {asking ? (
        <LoaderCircleIcon aria-hidden className="motion-safe:animate-spin" />
      ) : (
        <UsersIcon aria-hidden />
      )}
      {asking ? 'Asking…' : 'Ask a person'}
    </Button>
  );

  const alsoViewing = live.viewers
    .filter((viewer) => viewer.id !== viewerId)
    .map((viewer) => viewer.fullName ?? 'Someone');
  const typers = live.typingUserIds
    .filter((id) => id !== viewerId)
    .map((id) => names.get(id) ?? 'Someone');

  return (
    <div className="grid gap-6 p-4 md:p-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">
              #{ticket.ticketNumber}
            </span>
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {ticket.title}
          </h1>
          {alsoViewing.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {alsoViewing.join(', ')} {alsoViewing.length === 1 ? 'is' : 'are'}{' '}
              also viewing
            </p>
          )}
        </div>

        {deleted ? (
          <DeletedNotice ticket={ticket} />
        ) : (
          isAgent && <ActionBar ticket={ticket} />
        )}

        <Thread
          entries={entries}
          loading={messages.isPending}
          render={(entry) => {
            switch (entry.kind) {
              case 'description':
                return (
                  <PersonEntry
                    mine={entry.mine}
                    name={ticket.author?.fullName ?? null}
                    unknown={!ticket.author}
                    role="Requester"
                    at={ticket.createdAt}
                  >
                    {ticket.description}
                  </PersonEntry>
                );
              case 'message': {
                const message = entry.message;
                return message.isAiGenerated ? (
                  <ThreadAiMessage
                    ticket={ticket}
                    message={message}
                    perspective={perspective}
                    askAPerson={offerFor === entry.id ? askButton : undefined}
                  />
                ) : (
                  <ThreadMessage
                    ticket={ticket}
                    message={message}
                    mine={entry.mine}
                  />
                );
              }
              case 'pending':
                return (
                  <PendingEntry
                    pending={entry.pending}
                    onRetry={() => live.retry(entry.pending.clientMessageId)}
                  />
                );
              case 'answer':
                return (
                  <LiveAnswerEntry
                    answer={entry.answer}
                    perspective={perspective}
                    onStop={() => live.stop(entry.answer.streamId)}
                    askAPerson={offerFor === entry.id ? askButton : undefined}
                  />
                );
              case 'notice':
                return (
                  <NoticeEntry
                    notice={entry.notice}
                    perspective={perspective}
                    focusRef={
                      entry === lastEscalation ? focusNotice : undefined
                    }
                  />
                );
            }
          }}
        />

        {typers.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {typers.join(', ')} {typers.length === 1 ? 'is' : 'are'} typing…
          </p>
        )}

        {deleted || closed || !(requester || holder) ? (
          <p className="rounded-lg border bg-muted p-3 text-sm text-muted-foreground">
            {deleted
              ? can('ticket.delete')
                ? 'This ticket is deleted. Restore it to reply.'
                : 'This ticket is deleted.'
              : closed
                ? 'This ticket is closed.'
                : 'Only the assignee can reply or add notes.'}
          </p>
        ) : (
          <Composer
            agent={isAgent}
            requesterName={ticket.author?.fullName ?? null}
            onSend={live.send}
            onTyping={live.signalTyping}
            generateDraft={
              isAgent && can('ticket.ai.use')
                ? async (instruction, signal) =>
                    (
                      await aiControllerGenerateDraftV1(
                        ticket.id,
                        { instruction },
                        { signal },
                      )
                    ).data
                : undefined
            }
            presign={async (file) =>
              (
                await messagesControllerPresignNewAttachmentV1(ticket.id, {
                  ...file,
                  mimeType: file.mimeType as UploadAttachmentDtoMimeType,
                })
              ).data
            }
          />
        )}
      </div>

      <aside className="hidden lg:block">
        <SidePanel ticket={ticket} onAssignTo={onAssignTo} />
      </aside>
    </div>
  );
}

/**
 * The thread, as a log a screen reader follows politely. New entries scroll
 * into view when the reader is at the bottom; otherwise a pill counts them.
 */
function Thread({
  entries,
  loading,
  render,
}: {
  entries: Entry[];
  loading: boolean;
  render: (entry: Entry) => React.ReactNode;
}) {
  const end = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const seen = useRef(entries.length);
  const [unseen, setUnseen] = useState(0);

  useEffect(() => {
    const node = end.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      atBottom.current = entry.isIntersecting;
      if (entry.isIntersecting) setUnseen(0);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const added = entries.length - seen.current;
    seen.current = entries.length;
    if (added <= 0) return;
    if (atBottom.current) end.current?.scrollIntoView({ block: 'end' });
    else setUnseen((count) => count + added);
  }, [entries.length]);

  return (
    <div className="relative flex flex-col gap-3">
      <div
        role="log"
        aria-label="Conversation"
        aria-live="polite"
        aria-busy={loading || undefined}
        className="flex flex-col gap-3"
      >
        {entries.map((entry) => (
          <div key={entry.id}>{render(entry)}</div>
        ))}
        {loading && (
          <>
            <span className="sr-only">Loading conversation</span>
            <Skeleton className="h-20 w-2/3" />
          </>
        )}
      </div>
      <div ref={end} />
      {unseen > 0 && (
        <Button
          variant="secondary"
          size="sm"
          className="sticky bottom-4 self-center rounded-full shadow-md"
          onClick={() => {
            end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
            setUnseen(0);
          }}
        >
          {unseen} new {unseen === 1 ? 'message' : 'messages'}
        </Button>
      )}
    </div>
  );
}

/** Status, priority and assignee changes, said once each, politely. */
function useChangeAnnouncements(ticket: TicketResponseDto) {
  const previous = useRef(ticket);
  useEffect(() => {
    const before = previous.current;
    previous.current = ticket;
    if (before.status !== ticket.status && ticket.status) {
      announce(`Status changed to ${STATUS_LABEL[ticket.status]}`);
    }
    if (before.priority !== ticket.priority && ticket.priority) {
      announce(`Priority changed to ${PRIORITY_LABEL[ticket.priority]}`);
    }
    if (
      before.currentAssigneeId !== ticket.currentAssigneeId &&
      ticket.assignee
    ) {
      announce(`Assigned to ${ticket.assignee.fullName}`);
    }
  }, [ticket]);
}

function Loading() {
  return (
    <div aria-busy className="flex flex-col gap-4 p-4 md:p-6">
      <span className="sr-only" role="status">
        Loading conversation
      </span>
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-24 w-2/3" />
      <Skeleton className="ml-auto h-16 w-1/2" />
      <Skeleton className="h-24 w-2/3" />
    </div>
  );
}

/** A ticket that doesn't exist, or isn't the viewer's to see: one answer for both. */
export function TicketNotFound() {
  return (
    <>
      <AppHeader
        crumbs={[
          { label: 'Tickets', href: '/tickets' },
          { label: 'Not found' },
        ]}
      />
      <main id="main" tabIndex={-1} className="p-4 outline-none md:p-6">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
          <h1 className="text-lg font-semibold">We can’t find that ticket</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            It may have been deleted, or you may not have access to it.
          </p>
          <Link
            href="/tickets"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Back to tickets
          </Link>
        </div>
      </main>
    </>
  );
}
