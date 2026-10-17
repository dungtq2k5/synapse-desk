'use client';

import {
  ApiError,
  documentsControllerPresignV1,
  documentsControllerReplaceV1,
  type DocumentResponseDto,
} from '@synapsedesk/api-client';
import { parseOcrLanguages, type OcrLanguage } from '@synapsedesk/contracts';
import {
  CircleAlertIcon,
  FileTextIcon,
  FileUpIcon,
  InfoIcon,
  LoaderCircleIcon,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { serverMessage } from '@/components/ticket/use-directory';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Progress } from '@/components/ui/progress';
import { asSentence, checkFile, fileTypeLabel } from '@/lib/documents';
import { fileSize } from '@/lib/format';
import { sendFile } from '@/lib/upload';
import { useDocumentCache } from './document-actions';
import { OcrLanguagesField } from './upload-dialog';

/**
 * "Replace the file": the title, sharing and history stay; the passages are
 * rebuilt from the new file, and replacing resolves the document's open
 * flags. Refused with 409 while a job runs.
 */
export function ReplaceDialog({
  document,
  open,
  onOpenChange,
  openFlags = 0,
}: {
  document: Pick<DocumentResponseDto, 'id' | 'title' | 'ocrLanguages'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  openFlags?: number;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="gap-5 sm:max-w-130">
        {open && (
          <ReplaceForm
            document={document}
            openFlags={openFlags}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type Failure = { title: string; description: string };

function ReplaceForm({
  document,
  openFlags,
  onDone,
}: {
  document: Pick<DocumentResponseDto, 'id' | 'title' | 'ocrLanguages'>;
  openFlags: number;
  onDone: () => void;
}) {
  const refresh = useDocumentCache();
  const picker = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [ocr, setOcr] = useState<OcrLanguage[]>(() =>
    parseOcrLanguages(document.ocrLanguages),
  );
  const [percent, setPercent] = useState<number | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [conflict, setConflict] = useState(false);

  const choose = (chosen: File | undefined) => {
    if (!chosen) return;
    const checked = checkFile(chosen);
    setFile(chosen);
    setFailure(null);
    setRefusal('refusal' in checked ? checked.refusal : null);
  };

  const replace = async () => {
    if (!file || refusal) return;
    const checked = checkFile(file);
    if (!('contentType' in checked)) return;
    setFailure(null);
    setPercent(0);
    try {
      const signed = (
        await documentsControllerPresignV1({
          contentType: checked.contentType,
          sizeBytes: file.size,
          fileName: file.name,
        })
      ).data;
      await sendFile(signed.uploadUrl, signed.uploadMethod, file, setPercent);
      await documentsControllerReplaceV1(document.id, {
        objectPath: signed.objectPath,
        ocrLanguages: ocr,
      });
      toast.success(`Replacing ${document.title}.`);
      void refresh();
      onDone();
    } catch (error) {
      setPercent(null);
      if (error instanceof ApiError && error.status === 409) {
        setConflict(true);
      } else if (error instanceof ApiError && error.status === 402) {
        setFailure({
          title: /storage/i.test(error.message)
            ? 'Storage is full'
            : 'The document limit is reached',
          description: asSentence(error.message),
        });
      } else if (error instanceof ApiError && error.status === 429) {
        setFailure({
          title: 'Too many uploads at once',
          description: 'Wait a minute, then try again.',
        });
      } else {
        setFailure({
          title: 'Couldn’t replace the file',
          description: serverMessage(error),
        });
      }
    }
  };

  const busy = percent !== null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Replace the file</DialogTitle>
        <DialogDescription>
          The title, sharing and history stay. The passages are rebuilt from the
          new file.
        </DialogDescription>
      </DialogHeader>

      {conflict && (
        <Alert variant="destructive" role="alert">
          <CircleAlertIcon aria-hidden />
          <AlertTitle className="line-clamp-none">
            This document is being processed. Try again when it’s done.
          </AlertTitle>
          <AlertDescription>
            Your file wasn’t used. Choose it again once processing finishes.
          </AlertDescription>
        </Alert>
      )}
      {failure && (
        <Alert variant="destructive" role="alert">
          <CircleAlertIcon aria-hidden />
          <AlertTitle>{failure.title}</AlertTitle>
          <AlertDescription>{failure.description}</AlertDescription>
        </Alert>
      )}

      {file ? (
        <div className="flex items-start gap-3 rounded-lg border p-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <FileTextIcon aria-hidden className="size-4" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {`${fileTypeLabel(file.name.split('.').pop()?.toLowerCase() ?? '')} · ${fileSize(file.size)}`}
            </p>
            {refusal && (
              <p className="flex items-start gap-1.5 text-sm text-destructive">
                <CircleAlertIcon
                  aria-hidden
                  className="mt-0.5 size-3.5 shrink-0"
                />
                {refusal}
              </p>
            )}
            {busy && (
              <div className="flex flex-col gap-1">
                <Progress
                  value={percent}
                  aria-label={`Uploading ${file.name}`}
                  className="h-1.5 bg-muted"
                />
                <p className="text-xs text-muted-foreground">{`Uploading… ${percent}%`}</p>
              </div>
            )}
          </div>
          {!conflict && !busy && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => picker.current?.click()}
            >
              Choose another
            </Button>
          )}
        </div>
      ) : (
        <div className="flex justify-center rounded-lg border-2 border-dashed border-input px-4 py-6">
          <Button variant="outline" onClick={() => picker.current?.click()}>
            <FileUpIcon aria-hidden />
            Choose file
          </Button>
        </div>
      )}
      <input
        ref={picker}
        type="file"
        hidden
        accept=".pdf,.docx,.md,.markdown,.txt,application/pdf,text/markdown,text/plain"
        onChange={(event) => {
          choose(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      {!conflict && (
        <>
          <OcrLanguagesField value={ocr} onChange={setOcr} disabled={busy} />
          {file && !refusal && (
            <Alert className="border-info-border bg-info-subtle text-info-subtle-foreground">
              <InfoIcon aria-hidden />
              <AlertTitle>What happens next</AlertTitle>
              <AlertDescription className="text-info-subtle-foreground">
                {`Until the new file is indexed, answers keep using the current one.${
                  openFlags > 0
                    ? ` Its open ${openFlags === 1 ? 'flag is' : 'flags are'} resolved as replaced.`
                    : ''
                }`}
              </AlertDescription>
            </Alert>
          )}
        </>
      )}

      <DialogFooter>
        {conflict ? (
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        ) : (
          <>
            <DialogClose asChild>
              <Button variant="outline" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              disabled={!file || Boolean(refusal) || busy}
              onClick={() => void replace()}
            >
              {busy ? (
                <LoaderCircleIcon aria-hidden className="animate-spin" />
              ) : (
                <FileUpIcon aria-hidden />
              )}
              Replace file
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  );
}
