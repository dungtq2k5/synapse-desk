'use client';

import {
  ApiError,
  documentsControllerReindexV1,
  documentsControllerRemoveV1,
  documentsControllerRestoreV1,
  documentsControllerUpdateV1,
  type DocumentResponseDto,
} from '@synapsedesk/api-client';
import { MAX_DOCUMENT_TITLE_LENGTH } from '@synapsedesk/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { CircleAlertIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/auth/field';
import { serverMessage } from '@/components/ticket/use-directory';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toastError } from '@/lib/toast';

/** Refetches every document view and job list after a change. */
export function useDocumentCache() {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      queryClient.invalidateQueries({
        predicate: ({ queryKey }) =>
          typeof queryKey[0] === 'string' &&
          (queryKey[0].startsWith('/api/v1/documents') ||
            queryKey[0].startsWith('/api/v1/ingestion-jobs')),
      }),
    [queryClient],
  );
}

/** The actions a row and the document page share, each saying how it went. */
export function useDocumentActions() {
  const refresh = useDocumentCache();

  const restore = useCallback(
    async (document: Pick<DocumentResponseDto, 'id' | 'title'>) => {
      try {
        await documentsControllerRestoreV1(document.id);
        toast.success(`${document.title} restored.`);
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          toastError(
            'Couldn’t restore it',
            'Another document has the same file. Delete that one first, then restore this one.',
          );
        } else {
          toastError('Couldn’t restore it', serverMessage(error));
        }
      } finally {
        void refresh();
      }
    },
    [refresh],
  );

  const reindex = useCallback(
    async (document: Pick<DocumentResponseDto, 'id' | 'title'>) => {
      try {
        await documentsControllerReindexV1(document.id);
        toast.success(`Reindexing ${document.title}.`);
      } catch (error) {
        toastError('Couldn’t reindex it', serverMessage(error));
      } finally {
        void refresh();
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (document: Pick<DocumentResponseDto, 'id' | 'title'>) => {
      try {
        await documentsControllerRemoveV1(document.id);
        toast.success(`${document.title} deleted.`, {
          action: { label: 'Undo', onClick: () => void restore(document) },
        });
        return true;
      } catch (error) {
        toastError('Couldn’t delete it', serverMessage(error));
        return false;
      } finally {
        void refresh();
      }
    },
    [refresh, restore],
  );

  return { restore, reindex, remove, refresh };
}

/** "Delete {title}?", with focus on Cancel. */
export function DeleteDocumentDialog({
  document,
  open,
  onOpenChange,
  onDeleted,
}: {
  document: Pick<DocumentResponseDto, 'id' | 'title'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const { remove } = useDocumentActions();
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{`Delete ${document.title}?`}</AlertDialogTitle>
          <AlertDialogDescription>
            It stops being searchable and Ask won’t answer from it. You can
            restore it later from Show deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void remove(document)
                .then((deleted) => {
                  onOpenChange(false);
                  if (deleted) onDeleted?.();
                })
                .finally(() => setBusy(false));
            }}
          >
            <Trash2Icon aria-hidden />
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** "Edit document": the title, up to 255 characters. */
export function EditDocumentDialog({
  document,
  open,
  onOpenChange,
}: {
  document: Pick<DocumentResponseDto, 'id' | 'title'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-130">
        {open && (
          <EditForm document={document} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditForm({
  document,
  onDone,
}: {
  document: Pick<DocumentResponseDto, 'id' | 'title'>;
  onDone: () => void;
}) {
  const refresh = useDocumentCache();
  const [title, setTitle] = useState(document.title);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = title.trim();
    const problem = !trimmed
      ? 'Enter a title.'
      : trimmed.length > MAX_DOCUMENT_TITLE_LENGTH
        ? 'Keep it under 255 characters.'
        : null;
    setError(problem);
    if (problem) return;
    setBusy(true);
    setFailure(null);
    try {
      await documentsControllerUpdateV1(document.id, { title: trimmed });
      toast.success('Saved.');
      void refresh();
      onDone();
    } catch (failed) {
      setFailure(serverMessage(failed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-busy={busy || undefined}
      className="flex flex-col gap-4"
    >
      <DialogHeader>
        <DialogTitle>Edit document</DialogTitle>
        <DialogDescription className="sr-only">
          Change the document’s title.
        </DialogDescription>
      </DialogHeader>
      {failure && (
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden />
          <AlertTitle>Couldn’t save it</AlertTitle>
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      )}
      <Field
        id="document-title"
        label="Title"
        error={error}
        description="What people see in Search, Ask’s citations and this list."
        count={{ length: title.length, max: MAX_DOCUMENT_TITLE_LENGTH }}
      >
        {(aria) => (
          <Input
            id="document-title"
            maxLength={MAX_DOCUMENT_TITLE_LENGTH}
            value={title}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
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
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
