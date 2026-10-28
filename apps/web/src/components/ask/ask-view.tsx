'use client';

import {
  ApiError,
  chatControllerStartV1,
  useKnowledgeControllerListArticlesV1,
  useOrganizationsControllerGetV1,
  useTicketsControllerListV1,
  type TicketResponseDto,
} from '@synapsedesk/api-client';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightIcon,
  CircleAlertIcon,
  InfoIcon,
  MessageCircleIcon,
  PaperclipIcon,
  SendIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type SubmitEvent,
} from 'react';
import { ArticleRow } from '@/components/knowledge/article-row';
import {
  AttachmentList,
  DropOverlay,
  useFileDrop,
} from '@/components/ticket/attachment-list';
import {
  leaveOpeningSkipped,
  presignOpening,
  useAttachments,
} from '@/components/ticket/use-attachments';
import { SourceLabel, StatusBadge } from '@/components/tickets/badges';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useViewer } from '@/hooks/use-viewer';
import { relativeTime } from '@/lib/format';
import { minutesFrom } from '@/lib/sign-in';
import { titleFrom } from '@/lib/tickets';
import { announce } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { ALLOWED_ATTACHMENT_MIME_TYPES } from '@synapsedesk/contracts';

const MESSAGE_MAX = 20_000;
/** Where Knowledge leaves a question for "Ask as a conversation". */
const HANDOFF = 'synapsedesk.ask';

/** Leaves a question for the Ask page to open with. */
export function handOffQuestion(question: string): void {
  try {
    sessionStorage.setItem(HANDOFF, question);
  } catch {
    // Storage blocked: Ask opens empty.
  }
}

/** The question Knowledge left, if any; on the server, none. */
function handedQuestion(): string {
  try {
    return sessionStorage.getItem(HANDOFF) ?? '';
  } catch {
    return '';
  }
}

type Failure = { kind: 'failed' } | { kind: 'busy'; minutes: number };

/**
 * Ask: one question, sent as a new conversation (`POST /chat/conversations`)
 * under a title derived from it, then the conversation's thread. Below the
 * box, the person's latest requests and the newest articles.
 */
export function AskView() {
  const { user, isAgent } = useViewer();
  const organization =
    useOrganizationsControllerGetV1({ query: { retry: false } }).data?.data
      ?.name ?? 'your organization';
  const router = useRouter();
  const queryClient = useQueryClient();
  // "Ask as a conversation" from Knowledge brings its question along, read
  // once: the page is reached by client navigation, so this runs in the browser.
  const [question, setQuestion] = useState(handedQuestion);
  const [tooShort, setTooShort] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const files = useAttachments(presignOpening);
  const drop = useFileDrop((dropped) => !files.full && files.add(dropped));
  const titleId = useId();
  const limitId = useId();
  const errorId = useId();
  const title = titleFrom(question);
  const mac = useMac();

  useEffect(() => {
    try {
      sessionStorage.removeItem(HANDOFF);
    } catch {
      // Nothing was left.
    }
  }, []);

  const articles = useKnowledgeControllerListArticlesV1({
    page: 1,
    limit: 3,
    sortBy: 'updatedAt',
    sortOrder: 'DESC',
  });
  const noDocuments = articles.data?.data?.meta.totalItems === 0;

  const submit = async (event?: SubmitEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (busy || files.uploading) return;
    if (!title) {
      setTooShort(true);
      box.current?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const answer = await chatControllerStartV1({
        title,
        message: question.trim(),
        attachments: files.ready,
      });
      if (!answer.data) throw new Error('No conversation');
      leaveOpeningSkipped(answer.data.id, answer.data.skippedAttachments);
      void queryClient.invalidateQueries({ queryKey: ['/api/v1/tickets'] });
      router.push(`/tickets/${answer.data.id}`);
    } catch (error) {
      const next: Failure =
        error instanceof ApiError && error.status === 429
          ? {
              kind: 'busy',
              minutes: minutesFrom(error.retryAfterSeconds ?? 60),
            }
          : { kind: 'failed' };
      setFailure(next);
      setBusy(false);
      announce(
        next.kind === 'busy'
          ? 'Too many questions'
          : 'Couldn’t send your question',
        'assertive',
      );
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-188 flex-col gap-6 px-4 py-8 md:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Ask a question
        </h1>
        <p className="text-sm text-muted-foreground">
          {isAgent
            ? `Answers come from ${organization}’s documents. Your question becomes a ticket in Tickets, with you as the requester.`
            : `Answers come from ${organization}’s documents, with the sources they used. If the documents don’t cover it, a person from the support team takes over.`}
        </p>
      </div>

      {failure && (
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden />
          {failure.kind === 'busy' ? (
            <>
              <AlertTitle>Too many questions</AlertTitle>
              <AlertDescription>
                {`You’ve asked several questions in a short time. Try again in ${failure.minutes} ${failure.minutes === 1 ? 'minute' : 'minutes'}.`}
              </AlertDescription>
            </>
          ) : (
            <>
              <AlertTitle>Couldn’t send your question</AlertTitle>
              <AlertDescription>
                Something went wrong on our side. Your question is still here;
                try again.
              </AlertDescription>
            </>
          )}
        </Alert>
      )}

      <form
        noValidate
        aria-busy={busy || undefined}
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-2"
      >
        <div
          {...drop.handlers}
          className={cn(
            'relative flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
            tooShort &&
              'border-destructive focus-within:border-destructive focus-within:ring-destructive/20',
          )}
        >
          <Textarea
            ref={box}
            aria-label="Your question"
            aria-describedby={
              cn(title && titleId, tooShort && errorId) || undefined
            }
            aria-invalid={tooShort || undefined}
            placeholder="Ask a question…"
            maxLength={MESSAGE_MAX}
            rows={4}
            value={question}
            readOnly={busy}
            onChange={(event) => {
              setQuestion(event.target.value);
              if (titleFrom(event.target.value)) setTooShort(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submit();
              }
            }}
            className="min-h-24 resize-none border-0 p-0 text-base shadow-none focus-visible:ring-0 aria-invalid:ring-0 dark:bg-transparent"
          />
          <AttachmentList
            items={files.items}
            onRetry={files.retry}
            onRemove={files.remove}
          />
          <div className="flex items-center gap-3">
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              accept={ALLOWED_ATTACHMENT_MIME_TYPES.join(',')}
              onChange={(event) => {
                files.add([...(event.target.files ?? [])]);
                event.target.value = '';
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Attach files"
              aria-describedby={files.full ? limitId : undefined}
              disabled={files.full || busy}
              onClick={() => fileInput.current?.click()}
            >
              <PaperclipIcon aria-hidden />
              Attach
            </Button>
            <span className="text-xs text-muted-foreground">
              {files.full ? (
                <span id={limitId}>
                  5 of 5 files. Remove one to attach another.
                </span>
              ) : mac ? (
                '⌘+Enter to send'
              ) : (
                'Ctrl+Enter to send'
              )}
            </span>
            <Button
              type="submit"
              className="ml-auto"
              disabled={busy || !question.trim() || files.uploading}
            >
              <SendIcon aria-hidden />
              {busy ? 'Sending…' : 'Ask'}
            </Button>
          </div>
          {drop.dragging && <DropOverlay />}
        </div>
        {tooShort && (
          <p id={errorId} className="text-sm text-destructive">
            Ask a little more so we can help.
          </p>
        )}
        {title && !tooShort && (
          <p id={titleId} className="text-sm text-muted-foreground">
            {`It’ll be saved as “${title}” in ${isAgent ? 'Tickets' : 'My requests'}.`}
          </p>
        )}
      </form>

      {noDocuments && (
        <Alert variant="info">
          <InfoIcon aria-hidden />
          <AlertTitle>Answers may be limited for now</AlertTitle>
          <AlertDescription>
            {`${organization} hasn’t added documents yet. You can still ask; a person from the support team will reply.`}
          </AlertDescription>
        </Alert>
      )}

      {user && (
        <LatestRequests
          authorId={user.id}
          agent={isAgent}
          organization={organization}
          hideWhenEmpty={noDocuments}
        />
      )}

      <ListCard
        title="From the knowledge base"
        link={
          noDocuments
            ? undefined
            : { href: '/knowledge', label: 'Browse articles' }
        }
      >
        {articles.data?.data?.items.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            No articles yet.
          </p>
        ) : (
          articles.data?.data?.items.map((article) => (
            <ArticleRow key={article.id} article={article} />
          ))
        )}
      </ListCard>
    </div>
  );
}

/**
 * The person's newest tickets, whatever their source: an end user's latest
 * requests, or the questions an agent raised. Before any, the first-time note.
 */
function LatestRequests({
  authorId,
  agent,
  organization,
  hideWhenEmpty,
}: {
  authorId: string;
  agent: boolean;
  organization: string;
  hideWhenEmpty: boolean;
}) {
  const list = useTicketsControllerListV1({
    authorId,
    page: 1,
    limit: 3,
    sortBy: 'updatedAt',
    sortOrder: 'DESC',
  });
  const items = list.data?.data?.items;
  if (!items) return null;
  if (items.length === 0) {
    if (agent || hideWhenEmpty) return null;
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center">
        <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <MessageCircleIcon aria-hidden className="size-5" />
        </div>
        <h2 className="font-medium">
          Your questions and requests will appear here
        </h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          {`Ask anything about working at ${organization}. You can follow the answer and any replies in My requests.`}
        </p>
      </div>
    );
  }
  return (
    <ListCard
      title={agent ? 'Your latest questions' : 'Your latest requests'}
      link={agent ? undefined : { href: '/requests', label: 'All requests' }}
    >
      {items.map((ticket) => (
        <RequestRow key={ticket.id} ticket={ticket} />
      ))}
    </ListCard>
  );
}

function RequestRow({ ticket }: { ticket: TicketResponseDto }) {
  const unread = ticket.unreadCount;
  return (
    <div className="relative flex items-center gap-3 px-4 py-3 hover:bg-accent/50">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link
          href={`/tickets/${ticket.id}`}
          aria-label={`${ticket.title}${
            unread
              ? `, ${unread} unread ${unread === 1 ? 'message' : 'messages'}`
              : ''
          }`}
          className="truncate text-sm font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring"
        >
          {ticket.title}
        </Link>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span className="font-mono">#{ticket.ticketNumber}</span>
          <SourceLabel
            source={ticket.source}
            started
            className="[&_svg]:size-3.5"
          />
          <span>
            · Updated{' '}
            <time dateTime={ticket.updatedAt}>
              {relativeTime(ticket.updatedAt).replace(/^[A-Z]/, (first) =>
                first.toLowerCase(),
              )}
            </time>
          </span>
        </p>
      </div>
      {unread > 0 && (
        <span
          aria-hidden
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground"
        >
          {unread}
        </span>
      )}
      <StatusBadge status={ticket.status} />
    </div>
  );
}

/** A flat card: its `h2`, an optional link at the header's end, and rows. */
export function ListCard({
  title,
  link,
  action,
  children,
}: {
  title: string;
  link?: { href: string; label: string };
  action?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-xl border bg-card text-card-foreground"
    >
      <div className="flex min-h-13 items-center gap-3 border-b px-4 py-2">
        <h2 id={headingId} className="text-sm font-medium">
          {title}
        </h2>
        {link && (
          <Link
            href={link.href}
            className="ml-auto inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
          >
            {link.label}
            <ArrowRightIcon aria-hidden className="size-4" />
          </Link>
        )}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="flex flex-col divide-y">{children}</div>
    </section>
  );
}

/** Whether the shortcut reads ⌘ rather than Ctrl; decided after hydration. */
function useMac(): boolean {
  return useSyncExternalStore(
    noChanges,
    () => /Mac|iPhone|iPad/.test(navigator.userAgent),
    () => false,
  );
}

const noChanges = () => () => undefined;
