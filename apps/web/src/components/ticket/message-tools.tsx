'use client';

import {
  ApiError,
  attachmentsControllerRemoveV1,
  messageFeedbackControllerSubmitV1,
  messageFeedbackControllerWithdrawV1,
  messagesControllerRedactV1,
  messagesControllerUpdateV1,
  getMessageFeedbackControllerOwnV1QueryKey,
  useMessageFeedbackControllerOwnV1,
  type AttachmentResponseDto,
  type MessageResponseDto,
  type TicketResponseDto,
} from '@synapsedesk/api-client';
import { useQueryClient } from '@tanstack/react-query';
import {
  EllipsisIcon,
  EyeOffIcon,
  PencilIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  Trash2Icon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useViewer } from '@/hooks/use-viewer';
import { announce, toastError } from '@/lib/toast';
import {
  AiMessage,
  PersonEntry,
  type Perspective,
  type Skipped,
} from './entries';
import { serverMessage } from './use-directory';
import { useOpeningSkipped } from './use-attachments';

/** Past this, a timer can't wait (setTimeout's limit is about 24.8 days). */
const LONGEST_WAIT = 2 ** 31 - 1;

/**
 * Whether now is before `until`, and false the moment it passes: the page
 * redraws at the deadline, so Edit goes away by itself.
 */
function useBefore(until: string | null): boolean {
  const [now, setNow] = useState(() => Date.now());
  const deadline = until ? Date.parse(until) : 0;
  useEffect(() => {
    const left = deadline - Date.now();
    if (left <= 0 || left > LONGEST_WAIT) return;
    const timer = globalThis.setTimeout(() => setNow(Date.now()), left + 50);
    return () => globalThis.clearTimeout(timer);
  }, [deadline]);
  return deadline > now;
}

function useRefreshThread(ticketId: string) {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      queryKey: [`/api/v1/tickets/${ticketId}/messages`],
    });
}

/**
 * The ticket's opening: its description and the files uploaded with it, which
 * belong to no message. Delete is a moderator's, as the server allows; the
 * files that failed to attach when it was created show once, under it.
 */
export function ThreadOpening({
  ticket,
  mine,
}: {
  ticket: TicketResponseDto;
  mine: boolean;
}) {
  const { can } = useViewer();
  const queryClient = useQueryClient();
  const moderator = can('ticket.message.moderate');
  const [deleting, setDeleting] = useState<AttachmentResponseDto | null>(null);
  const skipped = useOpeningSkipped(ticket.id);
  // The server's own answer for this caller: the author who raised it, while
  // the window is open.
  const deletable = useBefore(ticket.openingFilesDeletableUntil);

  return (
    <>
      <PersonEntry
        mine={mine}
        name={ticket.author?.fullName ?? null}
        unknown={!ticket.author}
        role="Requester"
        at={ticket.createdAt}
        attachments={ticket.attachments}
        skipped={{ by: 'send', names: skipped }}
        onDeleteAttachment={
          moderator || deletable
            ? (attachment) => setDeleting(attachment)
            : undefined
        }
      >
        {ticket.description}
      </PersonEntry>
      <DeleteFileDialog
        attachment={deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        onConfirm={async (attachment) => {
          await attachmentsControllerRemoveV1(attachment.id);
          announce(`${attachment.fileName} deleted`);
          await queryClient.invalidateQueries({
            queryKey: [`/api/v1/tickets/${ticket.id}`],
          });
        }}
      />
    </>
  );
}

/**
 * A person's stored message, with what the viewer may do to it: Edit while
 * the server's `editableUntil` is ahead; for a moderator, a menu with Edit
 * note and Redact message; Delete on a file for its sender while they may
 * still edit, or a moderator.
 */
export function ThreadMessage({
  ticket,
  message,
  mine,
  skipped,
}: {
  ticket: TicketResponseDto;
  message: MessageResponseDto;
  mine: boolean;
  /** Files that failed to attach when it was sent from this tab. */
  skipped?: Skipped;
}) {
  const { can } = useViewer();
  const refresh = useRefreshThread(ticket.id);
  const moderator = can('ticket.message.moderate');
  const editable = useBefore(message.editableUntil);
  const redacted = Boolean(message.redactedAt);
  const fromRequester = message.senderId === ticket.authorId;
  const [editing, setEditing] = useState(false);
  const [redacting, setRedacting] = useState(false);
  const [deleting, setDeleting] = useState<AttachmentResponseDto | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);

  const stopEditing = () => {
    setEditing(false);
    requestAnimationFrame(() => editButton.current?.focus());
  };

  // A moderator edits a note from the menu; anyone else's Edit is a button.
  const noteByModerator = moderator && message.isInternalNote;
  const actions: ReactNode[] = [];
  if (editable && !redacted && !editing && !noteByModerator) {
    actions.push(
      <Button
        key="edit"
        ref={editButton}
        variant="ghost"
        size="xs"
        onClick={() => setEditing(true)}
      >
        <PencilIcon aria-hidden />
        Edit
      </Button>,
    );
  }
  if (moderator && !redacted) {
    actions.push(
      <ModeratorMenu
        key="menu"
        canEdit={noteByModerator && editable && !editing}
        onEdit={() => setEditing(true)}
        onRedact={() => setRedacting(true)}
      />,
    );
  }

  return (
    <>
      <PersonEntry
        mine={mine}
        name={message.sender?.fullName ?? null}
        unknown={Boolean(message.senderId) && !message.sender}
        role={fromRequester ? 'Requester' : 'Support agent'}
        at={message.createdAt}
        editedAt={message.editedAt}
        note={message.isInternalNote}
        removed={redacted}
        attachments={message.attachments}
        skipped={skipped}
        markdown={!fromRequester}
        actions={actions.length > 0 ? actions : undefined}
        editor={
          editing && (
            <Editor
              ticketId={ticket.id}
              message={message}
              onDone={() => {
                stopEditing();
                void refresh();
              }}
              onCancel={stopEditing}
            />
          )
        }
        onDeleteAttachment={
          // Its sender while they may still edit it, as the server allows.
          editable || moderator
            ? (attachment) => setDeleting(attachment)
            : undefined
        }
      >
        {message.content}
      </PersonEntry>
      <RedactDialog
        open={redacting}
        onOpenChange={setRedacting}
        onConfirm={async () => {
          await messagesControllerRedactV1(ticket.id, message.id);
          announce('Message redacted');
          await refresh();
        }}
      />
      <DeleteFileDialog
        attachment={deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        onConfirm={async (attachment) => {
          await attachmentsControllerRemoveV1(attachment.id);
          announce(`${attachment.fileName} deleted`);
          await refresh();
        }}
      />
    </>
  );
}

/** A stored AI message, with Helpful? for anyone who sees it, and Redact for moderators. */
export function ThreadAiMessage({
  ticket,
  message,
  perspective,
  askAPerson,
  skipped,
}: {
  ticket: TicketResponseDto;
  message: MessageResponseDto;
  perspective: Perspective;
  askAPerson?: ReactNode;
  skipped?: Skipped;
}) {
  const { can } = useViewer();
  const refresh = useRefreshThread(ticket.id);
  const [redacting, setRedacting] = useState(false);
  const moderator = can('ticket.message.moderate') && !message.redactedAt;
  return (
    <>
      <AiMessage
        message={message}
        perspective={perspective}
        askAPerson={askAPerson}
        skipped={skipped}
        actions={
          moderator && (
            <ModeratorMenu
              canEdit={false}
              onEdit={() => undefined}
              onRedact={() => setRedacting(true)}
            />
          )
        }
        feedback={
          <AiFeedback
            messageId={message.id}
            cited={(message.citations ?? []).length > 0}
          />
        }
      />
      <RedactDialog
        open={redacting}
        onOpenChange={setRedacting}
        onConfirm={async () => {
          await messagesControllerRedactV1(ticket.id, message.id);
          announce('Message redacted');
          await refresh();
        }}
      />
    </>
  );
}

function ModeratorMenu({
  canEdit,
  onEdit,
  onRedact,
}: {
  canEdit: boolean;
  onEdit: () => void;
  onRedact: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="Message actions">
          <EllipsisIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canEdit && (
          <DropdownMenuItem onSelect={onEdit}>
            <PencilIcon aria-hidden />
            Edit note
          </DropdownMenuItem>
        )}
        <DropdownMenuItem variant="destructive" onSelect={onRedact}>
          <EyeOffIcon aria-hidden />
          Redact message
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The message's text as a box: Save, or Cancel (Esc) back to Edit. */
function Editor({
  ticketId,
  message,
  onDone,
  onCancel,
}: {
  ticketId: string;
  message: MessageResponseDto;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [content, setContent] = useState(message.content);
  const [busy, setBusy] = useState(false);
  const [tooLate, setTooLate] = useState(false);

  const save = async () => {
    const text = content.trim();
    if (!text) return;
    setBusy(true);
    try {
      await messagesControllerUpdateV1(ticketId, message.id, { content: text });
      announce('Message updated');
      onDone();
    } catch (error) {
      if (
        error instanceof ApiError &&
        message.editableUntil &&
        Date.parse(message.editableUntil) <= Date.now()
      ) {
        setTooLate(true);
      } else {
        toastError('Couldn’t save your changes', serverMessage(error));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        aria-label="Message"
        autoFocus
        onFocus={(event) =>
          event.currentTarget.setSelectionRange(
            event.currentTarget.value.length,
            event.currentTarget.value.length,
          )
        }
        value={content}
        disabled={busy}
        className="bg-background"
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      {tooLate && (
        <p role="alert" className="text-xs text-destructive">
          You can only edit a message for 15 minutes after sending it.
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Esc cancels.</span>
        <span className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={busy || !content.trim()}
            onClick={() => void save()}
          >
            Save
          </Button>
        </span>
      </div>
    </div>
  );
}

function RedactDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => !busy && onOpenChange(next)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Redact this message?</AlertDialogTitle>
          <AlertDialogDescription>
            Its content is removed for everyone. The entry stays, marked “This
            message was removed.” This can’t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus disabled={busy}>
            Cancel
          </AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onConfirm()
                .then(() => onOpenChange(false))
                .catch((error: unknown) =>
                  toastError(
                    'Couldn’t redact the message',
                    serverMessage(error),
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            <EyeOffIcon aria-hidden />
            Redact message
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteFileDialog({
  attachment,
  onOpenChange,
  onConfirm,
}: {
  attachment: AttachmentResponseDto | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (attachment: AttachmentResponseDto) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog
      open={attachment !== null}
      onOpenChange={(next) => !busy && onOpenChange(next)}
    >
      <AlertDialogContent>
        {attachment && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{`Delete ${attachment.fileName}?`}</AlertDialogTitle>
              <AlertDialogDescription>
                {attachment.messageId
                  ? 'It’s removed from this message for everyone. This can’t be undone.'
                  : 'It’s removed from this ticket for everyone. This can’t be undone.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel autoFocus disabled={busy}>
                Cancel
              </AlertDialogCancel>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  onConfirm(attachment)
                    .then(() => onOpenChange(false))
                    .catch((error: unknown) =>
                      toastError(
                        `Couldn’t delete ${attachment.fileName}`,
                        serverMessage(error),
                      ),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                <Trash2Icon aria-hidden />
                Delete file
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Helpful? on an AI message: a thumb, then an optional comment and whether
 * the sources were right; once saved, Change or Remove.
 */
function AiFeedback({
  messageId,
  cited,
}: {
  messageId: string;
  cited: boolean;
}) {
  const queryClient = useQueryClient();
  const own = useMessageFeedbackControllerOwnV1(messageId, {
    query: { retry: false },
  });
  const saved = own.data?.data ?? null;
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const [text, setText] = useState('');
  const [sources, setSources] = useState('');
  const [busy, setBusy] = useState(false);
  const key = getMessageFeedbackControllerOwnV1QueryKey(messageId);

  const begin = (thumb: 1 | -1) => {
    setRating(thumb);
    setText(saved?.feedbackText ?? '');
    setSources(
      saved?.citationAccurate === null || saved?.citationAccurate === undefined
        ? ''
        : saved.citationAccurate
          ? 'yes'
          : 'no',
    );
  };

  const submit = async (withDetails: boolean) => {
    if (rating === null) return;
    setBusy(true);
    try {
      const answer = await messageFeedbackControllerSubmitV1(messageId, {
        rating,
        feedbackText: withDetails && text.trim() ? text.trim() : null,
        citationAccurate: withDetails && sources ? sources === 'yes' : null,
      });
      queryClient.setQueryData(key, answer);
      setRating(null);
    } catch (error) {
      toastError('Couldn’t send your feedback', serverMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      await messageFeedbackControllerWithdrawV1(messageId);
      queryClient.removeQueries({ queryKey: key });
      void own.refetch();
      announce('Feedback removed');
    } catch (error) {
      toastError('Couldn’t remove your feedback', serverMessage(error));
    }
  };

  if (saved && rating === null) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        Thanks for your feedback.
        <Button
          variant="link"
          size="xs"
          className="h-auto px-0"
          onClick={() => begin(saved.rating)}
        >
          Change
        </Button>
        <Button
          variant="link"
          size="xs"
          className="h-auto px-0"
          onClick={() => void remove()}
        >
          Remove
        </Button>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        Helpful?
        {([1, -1] as const).map((thumb) => (
          <Button
            key={thumb}
            variant={rating === thumb ? 'default' : 'ghost'}
            size="icon-xs"
            aria-label={thumb === 1 ? 'Helpful' : 'Not helpful'}
            aria-pressed={rating === thumb}
            onClick={() => begin(thumb)}
          >
            {thumb === 1 ? (
              <ThumbsUpIcon aria-hidden />
            ) : (
              <ThumbsDownIcon aria-hidden />
            )}
          </Button>
        ))}
      </div>
      {rating !== null && (
        <div className="flex flex-col gap-3 rounded-md border bg-background p-3 text-foreground">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`feedback-${messageId}`}>
              Tell us more (optional)
            </Label>
            <Textarea
              id={`feedback-${messageId}`}
              autoFocus
              rows={2}
              placeholder="What was wrong or missing?"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
          {cited && (
            <div className="flex items-center gap-2 text-sm">
              <span id={`sources-${messageId}`}>Were the sources right?</span>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                aria-labelledby={`sources-${messageId}`}
                value={sources}
                onValueChange={setSources}
              >
                <ToggleGroupItem value="yes">Yes</ToggleGroupItem>
                <ToggleGroupItem value="no">No</ToggleGroupItem>
              </ToggleGroup>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void submit(false)}
            >
              Skip
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void submit(true)}>
              Send feedback
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
