'use client';

import {
  documentsControllerDeleteFlagV1,
  documentsControllerDismissFlagV1,
  documentsControllerFixFlagV1,
  documentsControllerReplaceFlagV1,
  type DocumentFlagResponseDto,
} from '@synapsedesk/api-client';
import { MAX_FLAG_RESOLUTION_COMMENT_LENGTH } from '@synapsedesk/contracts';
import { useQueryClient } from '@tanstack/react-query';
import {
  CheckIcon,
  CircleCheckIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  FileUpIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRef, useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/auth/field';
import { serverMessage } from '@/components/ticket/use-directory';
import { usePeople } from '@/components/ticket/use-directory';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { useViewer } from '@/hooks/use-viewer';
import { FLAG_TYPE } from '@/lib/documents';
import { dayDate, relativeTime } from '@/lib/format';
import { toastError } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { SeverityBadge } from './badges';

type Resolve = 'dismiss' | 'fixed' | 'replaced';

/** Refetches every flag list and count after a change. */
function useFlagCache() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        typeof queryKey[0] === 'string' &&
        queryKey[0].startsWith('/api/v1/documents'),
    });
}

/**
 * One flag: its severity, type and document, the type's sentence, the
 * server's detail and confidence, and, while open, what may be done about it.
 * A resolved flag says how, by whom and when instead.
 *
 * @param withDocument whether to name and link the document (the worklist);
 *   the document's own page leaves it out.
 */
export function FlagCard({
  flag,
  withDocument = true,
  onReplaceFile,
}: {
  flag: DocumentFlagResponseDto;
  withDocument?: boolean;
  /** Opens the document's Replace dialog, when that's on this page. */
  onReplaceFile?: () => void;
}) {
  const { can } = useViewer();
  const [resolving, setResolving] = useState<Resolve | null>(null);
  const [deleting, setDeleting] = useState(false);
  const kind = flag.flagType ? FLAG_TYPE[flag.flagType] : null;
  const label = kind?.label ?? 'Flag';
  const detail = [
    flag.detail,
    flag.confidenceScore !== null
      ? `Confidence in this finding: ${Math.round(flag.confidenceScore * 100)}%`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const open = !flag.resolvedAt;

  return (
    <article
      aria-label={`${label}, ${flag.documentTitle}`}
      className="flex flex-col gap-2 rounded-lg border p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <SeverityBadge severity={flag.severity} />
          <span className="font-medium">{label}</span>
          {withDocument && (
            <>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <Link
                href={`/knowledge/documents/${flag.documentId}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                {flag.documentTitle}
              </Link>
            </>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          Detected{' '}
          <time dateTime={flag.detectedAt}>
            {relativeTime(flag.detectedAt).replace(
              /^(Just now|Yesterday|Last week)/,
              (word) => word.toLowerCase(),
            )}
          </time>
        </p>
      </header>
      {kind && <p className="text-sm">{kind.sentence}</p>}
      {detail && <p className="text-sm text-muted-foreground">{detail}</p>}

      {open ? (
        (can('document.update') || can('document.delete')) && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {can('document.update') && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setResolving('fixed')}
                >
                  <CheckIcon aria-hidden />
                  Fixed
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setResolving('replaced')}
                >
                  <FileUpIcon aria-hidden />
                  Replaced
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setResolving('dismiss')}
                >
                  <XIcon aria-hidden />
                  Dismiss
                </Button>
              </>
            )}
            {flag.flagType === 'CONFLICTING' && flag.relatedDocumentId && (
              <Link
                href={`/knowledge/documents/${flag.relatedDocumentId}`}
                className={cn(buttonVariants({ variant: 'link', size: 'sm' }))}
              >
                <ExternalLinkIcon aria-hidden />
                Open both
              </Link>
            )}
            {flag.flagType === 'PAGES_NOT_INDEXED' && withDocument && (
              <Link
                href={`/knowledge/documents/${flag.documentId}#processing`}
                className={cn(buttonVariants({ variant: 'link', size: 'sm' }))}
              >
                <ExternalLinkIcon aria-hidden />
                Open processing
              </Link>
            )}
            {can('document.delete') && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="More actions"
                    className="ml-auto"
                  >
                    <EllipsisIcon aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="shadow-md">
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setDeleting(true)}
                  >
                    <Trash2Icon aria-hidden />
                    Delete flag
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )
      ) : (
        <Resolved flag={flag} />
      )}

      <ResolveDialog
        flag={flag}
        label={label}
        kind={resolving}
        onReplaceFile={onReplaceFile}
        onClose={() => setResolving(null)}
      />
      <DeleteFlagDialog
        flag={flag}
        open={deleting}
        onOpenChange={setDeleting}
      />
    </article>
  );
}

/** How a resolved flag was resolved: by whom, when, and the comment. */
function Resolved({ flag }: { flag: DocumentFlagResponseDto }) {
  const { names } = usePeople();
  const who = flag.resolvedById
    ? (names.get(flag.resolvedById) ?? 'someone')
    : null;
  const when = flag.resolvedAt ? dayDate(flag.resolvedAt) : '';
  const comment = flag.resolutionComment ? `: “${flag.resolutionComment}”` : '';
  const text =
    flag.resolution === 'DOCUMENT_REPLACED'
      ? who
        ? `Replaced by ${who} on ${when}.`
        : `Resolved when the file was replaced, ${when}.`
      : flag.resolution === 'DISMISSED'
        ? `Dismissed by ${who ?? 'someone'} on ${when}${comment}`
        : `Fixed by ${who ?? 'someone'} on ${when}${comment}`;
  return (
    <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
      <CircleCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      {text}
    </p>
  );
}

const RESOLVE = {
  dismiss: {
    title: 'Dismiss this flag?',
    lead: 'Say why, so the next person knows.',
    field: 'Reason',
    submit: 'Dismiss flag',
    call: documentsControllerDismissFlagV1,
  },
  fixed: {
    title: 'Mark as fixed?',
    lead: 'Use this once you’ve updated the document.',
    field: 'Comment (optional)',
    submit: 'Mark as fixed',
    call: documentsControllerFixFlagV1,
  },
  replaced: {
    title: 'Mark as replaced?',
    lead: 'Use this if you uploaded a new version as a separate document.',
    field: 'Comment (optional)',
    submit: 'Mark as replaced',
    call: documentsControllerReplaceFlagV1,
  },
} as const;

function ResolveDialog({
  flag,
  label,
  kind,
  onReplaceFile,
  onClose,
}: {
  flag: DocumentFlagResponseDto;
  label: string;
  kind: Resolve | null;
  onReplaceFile?: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={kind !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="sm:max-w-130">
        {kind && (
          <ResolveForm
            flag={flag}
            label={label}
            kind={kind}
            onReplaceFile={onReplaceFile}
            onDone={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResolveForm({
  flag,
  label,
  kind,
  onReplaceFile,
  onDone,
}: {
  flag: DocumentFlagResponseDto;
  label: string;
  kind: Resolve;
  onReplaceFile?: () => void;
  onDone: () => void;
}) {
  const refresh = useFlagCache();
  const copy = RESOLVE[kind];
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = comment.trim();
    if (kind === 'dismiss' && !trimmed) {
      setError('Say why you’re dismissing it.');
      field.current?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await copy.call(flag.id, { comment: trimmed || null });
      toast.success('Flag resolved.');
      void refresh();
      onDone();
    } catch (failure) {
      toastError('Couldn’t resolve the flag', serverMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-4"
    >
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{`${label} · ${flag.documentTitle}. ${copy.lead}`}</DialogDescription>
      </DialogHeader>
      {kind === 'replaced' && (
        <div className="rounded-md border bg-muted p-3 text-sm">
          <p className="font-medium">Haven’t replaced the file yet?</p>
          <p className="text-muted-foreground">
            Replacing the file resolves every open flag on the document for you.{' '}
            {onReplaceFile ? (
              <Button
                type="button"
                variant="link"
                className="h-auto p-0"
                onClick={() => {
                  onDone();
                  onReplaceFile();
                }}
              >
                Replace the file
              </Button>
            ) : (
              <Link
                href={`/knowledge/documents/${flag.documentId}?replace=1`}
                className="text-primary underline-offset-4 hover:underline"
              >
                Replace the file
              </Link>
            )}
          </p>
        </div>
      )}
      <Field
        id={`flag-${flag.id}-comment`}
        label={copy.field}
        error={error}
        count={{
          length: comment.length,
          max: MAX_FLAG_RESOLUTION_COMMENT_LENGTH,
        }}
      >
        {(aria) => (
          <Textarea
            ref={field}
            id={`flag-${flag.id}-comment`}
            rows={4}
            maxLength={MAX_FLAG_RESOLUTION_COMMENT_LENGTH}
            value={comment}
            disabled={busy}
            onChange={(event) => setComment(event.target.value)}
            {...aria}
          />
        )}
      </Field>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={busy}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={busy}>
          {copy.submit}
        </Button>
      </DialogFooter>
    </form>
  );
}

function DeleteFlagDialog({
  flag,
  open,
  onOpenChange,
}: {
  flag: DocumentFlagResponseDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useFlagCache();
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this flag?</AlertDialogTitle>
          <AlertDialogDescription>
            It’s removed for good, with its history. To keep a record, dismiss
            it instead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void documentsControllerDeleteFlagV1(flag.id)
                .then(() => {
                  toast.success('Flag deleted.');
                  onOpenChange(false);
                  void refresh();
                })
                .catch((failure: unknown) =>
                  toastError(
                    'Couldn’t delete the flag',
                    serverMessage(failure),
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            <Trash2Icon aria-hidden />
            Delete flag
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
