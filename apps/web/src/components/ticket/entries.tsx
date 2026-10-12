'use client';

import type {
  AttachmentResponseDto,
  CitationResponseDto,
  MessageResponseDto,
} from '@synapsedesk/api-client';
import {
  BotIcon,
  CircleAlertIcon,
  EyeOffIcon,
  FileTextIcon,
  LoaderCircleIcon,
  LockIcon,
  RotateCwIcon,
  SearchXIcon,
  SquareIcon,
  UsersIcon,
  ZapOffIcon,
} from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { UserAvatar } from '@/components/shell/user-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { absoluteTime, clockTime, fileSize } from '@/lib/format';
import type { LiveAnswer, Notice, PendingSend } from '@/lib/thread';
import { cn } from '@/lib/utils';

/** Who is reading: decides each footer's wording and the "Ask a person" offer. */
export type Perspective = 'agent' | 'requester' | 'requester-escalated';

/** Left for everyone else, right for mine; capped at a readable width. */
function Side({ mine, children }: { mine: boolean; children: ReactNode }) {
  return (
    <div className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div className="w-full max-w-[85%] md:max-w-[70%]">{children}</div>
    </div>
  );
}

function Time({ at, edited }: { at: string; edited?: string | null }) {
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <time dateTime={at} tabIndex={0} className="rounded-sm">
            {clockTime(at)}
          </time>
        </TooltipTrigger>
        <TooltipContent>{absoluteTime(at)}</TooltipContent>
      </Tooltip>
      {edited && (
        <>
          {' · '}
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="rounded-sm">
                Edited
              </span>
            </TooltipTrigger>
            <TooltipContent>{absoluteTime(edited)}</TooltipContent>
          </Tooltip>
        </>
      )}
    </>
  );
}

/**
 * A person's entry: a reply, an internal note, or the ticket's description.
 * On the left it names its author; on the right (mine) only the time.
 */
export function PersonEntry({
  mine,
  name,
  unknown,
  role,
  at,
  editedAt,
  note,
  removed,
  attachments,
  children,
}: {
  mine: boolean;
  name: string | null;
  /** An id is set but its name didn't resolve. */
  unknown?: boolean;
  role: 'Requester' | 'Support agent';
  at: string;
  editedAt?: string | null;
  note?: boolean;
  removed?: boolean;
  attachments?: AttachmentResponseDto[];
  children: ReactNode;
}) {
  const headerId = useId();
  const author = mine ? 'You' : (name ?? 'Unknown user');

  return (
    <Side mine={mine}>
      <article
        aria-labelledby={headerId}
        className={cn(
          'flex flex-col gap-2 rounded-lg border p-4 text-sm',
          note
            ? 'border-dashed border-note-border bg-note-bg text-note-fg'
            : mine
              ? 'border-border bg-card text-card-foreground'
              : role === 'Support agent'
                ? 'border-author-agent-border bg-author-agent-bg text-author-agent-fg'
                : 'border-author-user-border bg-author-user-bg text-author-user-fg',
        )}
      >
        <header
          id={headerId}
          className={cn(
            'flex flex-wrap items-center gap-x-2 gap-y-1 text-xs',
            mine && !note && 'justify-end',
          )}
        >
          <span className="sr-only">{author}</span>
          {note && (
            <span className="inline-flex items-center gap-1 font-medium">
              <LockIcon aria-hidden className="size-3.5" />
              INTERNAL NOTE · Only agents can see this
            </span>
          )}
          {!mine && (
            <>
              <UserAvatar name={unknown ? null : name} />
              <span
                aria-hidden
                className={cn(
                  'font-medium',
                  unknown && 'text-muted-foreground',
                )}
              >
                {name ?? 'Unknown user'}
              </span>
              <span aria-hidden>· {role} ·</span>
            </>
          )}
          <span
            className={cn('text-muted-foreground', mine && note && 'ml-auto')}
          >
            <Time at={at} edited={editedAt} />
          </span>
        </header>
        {removed ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <EyeOffIcon aria-hidden className="size-4" />
            This message was removed.
          </p>
        ) : (
          <div className="whitespace-pre-wrap break-words">{children}</div>
        )}
        {!removed && attachments && attachments.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <li key={attachment.id}>
                <AttachmentChip attachment={attachment} />
              </li>
            ))}
          </ul>
        )}
      </article>
    </Side>
  );
}

function AttachmentChip({ attachment }: { attachment: AttachmentResponseDto }) {
  return (
    <a
      href={attachment.fileUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-2 py-1 text-foreground hover:bg-accent"
    >
      <FileTextIcon aria-hidden className="size-4 text-muted-foreground" />
      <span className="font-medium">{attachment.fileName}</span>
      <span className="text-xs text-muted-foreground">
        {fileSize(attachment.fileSizeBytes)}
      </span>
    </a>
  );
}

function Citations({ citations }: { citations: CitationResponseDto[] }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium">Sources</span>
      <ul className="flex flex-wrap gap-2">
        {citations.map((citation, index) => (
          <li
            key={citation.chunkId}
            className="rounded-sm border border-author-ai-border px-1.5 py-0.5 font-mono text-xs"
          >
            [{index + 1}] {citation.documentTitle}
            {citation.pageNumber !== null && ` · p. ${citation.pageNumber}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The AI's frame: left, the AI surface and its teal rule, the AI label. */
function AiFrame({
  label,
  sources,
  at,
  busy,
  children,
}: {
  label: 'AI answer' | 'AI';
  sources?: number;
  at: string;
  busy?: boolean;
  children: ReactNode;
}) {
  const headerId = useId();
  return (
    <Side mine={false}>
      <article
        aria-labelledby={headerId}
        aria-busy={busy || undefined}
        className="flex flex-col gap-2 rounded-lg border border-l-4 border-author-ai-border bg-author-ai-bg p-4 text-sm text-author-ai-fg"
      >
        <header
          id={headerId}
          className="flex flex-wrap items-center gap-2 text-xs"
        >
          <Badge>
            <BotIcon aria-hidden />
            {label}
          </Badge>
          <span className="font-medium">
            SynapseDesk AI
            {sources
              ? ` · from ${sources} ${sources === 1 ? 'source' : 'sources'}`
              : ''}
          </span>
          <span className="text-muted-foreground">
            · <Time at={at} />
          </span>
        </header>
        {children}
      </article>
    </Side>
  );
}

/** The footer copy per status and perspective. */
const FOOTER: Record<
  'DOC_MISSING' | 'REFUSED' | 'failed' | 'stopped',
  Record<Perspective, string>
> = {
  DOC_MISSING: {
    requester:
      'Not what you needed? A person from the support team can take over.',
    'requester-escalated':
      'The support team has your question and will reply here.',
    agent: 'No answer in the documents.',
  },
  REFUSED: {
    requester: 'You can rephrase your message, or ask a person to take over.',
    'requester-escalated':
      'You can rephrase your message. The support team will reply here too.',
    agent: 'Not answered: refused as written.',
  },
  failed: {
    requester:
      'The answer stopped before it finished. Ask again, or ask a person to take over.',
    'requester-escalated':
      'The answer stopped before it finished. The support team will reply here.',
    agent: 'The answer stopped before it finished.',
  },
  stopped: {
    requester: 'Answer stopped. Ask again, or ask a person to take over.',
    'requester-escalated': 'Answer stopped. The support team will reply here.',
    agent: 'Stopped by the requester.',
  },
};

function Footer({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-xs [&_svg]:mt-0.5 [&_svg]:size-3.5 [&_svg]:shrink-0">
      {icon}
      <span>{children}</span>
    </p>
  );
}

/** A stored AI message, with its sources or the footer its status needs. */
export function AiMessage({
  message,
  perspective,
  askAPerson,
}: {
  message: MessageResponseDto;
  perspective: Perspective;
  askAPerson?: ReactNode;
}) {
  const status = message.answerStatus;
  const citations = message.citations ?? [];
  return (
    <AiFrame
      label={status === 'DOC_ANSWER' ? 'AI answer' : 'AI'}
      sources={status === 'DOC_ANSWER' ? citations.length : undefined}
      at={message.createdAt}
    >
      {message.redactedAt ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <EyeOffIcon aria-hidden className="size-4" />
          This message was removed.
        </p>
      ) : (
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
      )}
      {status === 'DOC_ANSWER' && citations.length > 0 && (
        <Citations citations={citations} />
      )}
      {status === 'DOC_MISSING' && (
        <Footer icon={<SearchXIcon aria-hidden />}>
          {FOOTER.DOC_MISSING[perspective]}
        </Footer>
      )}
      {status === 'REFUSED' && (
        <Footer icon={<CircleAlertIcon aria-hidden />}>
          {FOOTER.REFUSED[perspective]}
        </Footer>
      )}
      {askAPerson}
    </AiFrame>
  );
}

/** An answer this tab asked for, streaming in, or cut short. */
export function LiveAnswerEntry({
  answer,
  perspective,
  onStop,
  askAPerson,
}: {
  answer: LiveAnswer;
  perspective: Perspective;
  onStop: () => void;
  askAPerson?: ReactNode;
}) {
  const streaming = answer.state === 'streaming';
  return (
    <AiFrame label="AI" at={answer.startedAt} busy={streaming}>
      {answer.text && (
        <div className="whitespace-pre-wrap break-words">{answer.text}</div>
      )}
      {streaming && (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="inline-flex items-center gap-2">
            <LoaderCircleIcon
              aria-hidden
              className="size-3.5 motion-safe:animate-spin"
            />
            Writing an answer…
          </span>
          <Button variant="outline" size="xs" onClick={onStop}>
            <SquareIcon aria-hidden />
            Stop
          </Button>
        </div>
      )}
      {answer.state === 'failed' && (
        <Footer icon={<CircleAlertIcon aria-hidden />}>
          {FOOTER.failed[perspective]}
        </Footer>
      )}
      {answer.state === 'stopped' && (
        <Footer icon={<SquareIcon aria-hidden />}>
          {FOOTER.stopped[perspective]}
        </Footer>
      )}
      {askAPerson}
    </AiFrame>
  );
}

/** A reply of mine on its way, or one that didn't go. */
export function PendingEntry({
  pending,
  onRetry,
}: {
  pending: PendingSend;
  onRetry: () => void;
}) {
  const failed = pending.state === 'failed';
  return (
    <Side mine>
      <article
        aria-label="You"
        className={cn(
          'flex flex-col gap-2 rounded-lg border p-4 text-sm',
          pending.isInternalNote
            ? 'border-dashed border-note-border bg-note-bg text-note-fg'
            : 'border-border bg-card text-card-foreground',
          failed && 'border-destructive-border',
        )}
      >
        <div className="whitespace-pre-wrap break-words">{pending.content}</div>
        <p className="flex items-center justify-end gap-2 text-xs">
          {failed ? (
            <>
              <span className="text-destructive">Not sent.</span>
              <Button variant="outline" size="xs" onClick={onRetry}>
                <RotateCwIcon aria-hidden />
                Retry
              </Button>
            </>
          ) : (
            <span className="text-muted-foreground">
              {pending.messageId ? 'Sent' : 'Sending…'}
            </span>
          )}
        </p>
      </article>
    </Side>
  );
}

/** Something that happened to the ticket: centered, muted, no author. */
export function NoticeEntry({
  notice,
  perspective,
  focusRef,
}: {
  notice: Notice;
  perspective: Perspective;
  focusRef?: React.Ref<HTMLDivElement>;
}) {
  const agent = perspective === 'agent';
  const text =
    notice.kind === 'escalated'
      ? agent
        ? 'Escalated to the support team.'
        : 'Escalated to the support team. A person will reply here.'
      : agent
        ? 'The assistant wasn’t available: the AI limit is reached.'
        : 'The assistant isn’t available right now.';
  const Icon = notice.kind === 'escalated' ? UsersIcon : ZapOffIcon;
  return (
    <div className="flex justify-center">
      <div
        ref={focusRef}
        tabIndex={focusRef ? -1 : undefined}
        className="inline-flex items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon aria-hidden className="size-3.5" />
        <span>{text}</span>
        <Time at={notice.at} />
      </div>
    </div>
  );
}
