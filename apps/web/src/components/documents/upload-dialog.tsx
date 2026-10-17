'use client';

import {
  ApiError,
  documentsControllerConfirmV1,
  documentsControllerPresignV1,
  useOrganizationsControllerGetV1,
} from '@synapsedesk/api-client';
import {
  DEFAULT_OCR_LANGUAGE,
  MAX_DOCUMENT_TITLE_LENGTH,
  MAX_OCR_LANGUAGES,
  OCR_LANGUAGES,
  type AllowedDocumentMimeType,
  type OcrLanguage,
} from '@synapsedesk/contracts';
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  FileTextIcon,
  FileUpIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
  UploadIcon,
  XIcon,
} from 'lucide-react';
import { useId, useRef, useState, type DragEvent } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { useViewer } from '@/hooks/use-viewer';
import {
  OCR_LANGUAGE_LABEL,
  asSentence,
  checkFile,
  fileTypeLabel,
  ocrLanguageAllowed,
} from '@/lib/documents';
import { fileSize } from '@/lib/format';
import { announce } from '@/lib/toast';
import { sendFile } from '@/lib/upload';
import { cn } from '@/lib/utils';
import { useDocumentCache } from './document-actions';
import { PlanLink, useDepartmentNames } from './parts';
import { MultiSelect } from './multi-select';
import { VisibilityField } from './visibility-field';

type Phase =
  | 'ready'
  | 'refused'
  | 'waiting'
  | 'uploading'
  | 'uploaded'
  | 'failed'
  | 'held';

type Row = {
  key: string;
  file: File;
  title: string;
  contentType: AllowedDocumentMimeType | null;
  phase: Phase;
  percent: number;
  /** Why it was refused, or why it failed. */
  reason: string | null;
};

/** The batch's outcome, above the files. */
type Notice =
  | { kind: 'done'; count: number }
  | { kind: 'storage'; message: string }
  | { kind: 'count'; message: string }
  | { kind: 'rate'; retryAfter: number | null }
  | null;

/** A refusal at presign, as the row and the notice say it. */
function refusalOf(
  error: unknown,
):
  | { phase: 'refused'; reason: string; notice?: Notice }
  | { phase: 'failed'; reason: string; notice?: Notice } {
  if (error instanceof ApiError && error.status === 402) {
    const message = asSentence(error.message);
    const storage = /storage/i.test(message);
    return {
      phase: 'refused',
      reason: storage ? 'Storage is full.' : 'The document limit is reached.',
      notice: { kind: storage ? 'storage' : 'count', message },
    };
  }
  if (error instanceof ApiError && error.status === 429) {
    return {
      phase: 'failed',
      reason: 'Not uploaded yet.',
      notice: { kind: 'rate', retryAfter: error.retryAfterSeconds },
    };
  }
  if (error instanceof ApiError && error.status === 400) {
    const limit = /over (\d+) bytes/.exec(error.message)?.[1];
    return {
      phase: 'refused',
      reason: limit
        ? `Larger than this organization accepts (${fileSize(Number(limit))}).`
        : asSentence(error.message),
    };
  }
  return { phase: 'failed', reason: 'Upload failed. Check your connection.' };
}

/** "Upload", opening the dialog; focus returns to it when the dialog closes. */
export function UploadButton({
  label = 'Upload',
  size,
  disabled,
  describedBy,
}: {
  label?: string;
  size?: 'sm' | 'default';
  disabled?: boolean;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size={size}
        disabled={disabled}
        aria-describedby={describedBy}
        onClick={() => setOpen(true)}
      >
        <UploadIcon aria-hidden />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="gap-5 sm:max-h-[calc(100svh-2rem)] sm:max-w-140 sm:overflow-y-auto"
        >
          {open && <UploadForm onClose={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function UploadForm({ onClose }: { onClose: () => void }) {
  const refresh = useDocumentCache();
  const departments = useDepartmentNames();
  const organization =
    useOrganizationsControllerGetV1({ query: { retry: false } }).data?.data
      ?.name ?? 'your organization';
  const [rows, setRows] = useState<Row[]>([]);
  const [organizationWide, setOrganizationWide] = useState(true);
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [ocr, setOcr] = useState<OcrLanguage[]>([DEFAULT_OCR_LANGUAGE]);
  const [titleErrors, setTitleErrors] = useState<Record<string, string>>({});
  const [departmentError, setDepartmentError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const keys = useRef(0);

  const update = (key: string, patch: Partial<Row>) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );

  const add = (files: File[]) =>
    setRows((current) => [
      ...current,
      ...files.map((file): Row => {
        const checked = checkFile(file);
        return {
          key: String(keys.current++),
          file,
          title: file.name,
          contentType: 'contentType' in checked ? checked.contentType : null,
          phase: 'refusal' in checked ? 'refused' : 'ready',
          percent: 0,
          reason: 'refusal' in checked ? checked.refusal : null,
        };
      }),
    ]);

  const sendable = rows.filter((row) =>
    ['ready', 'failed', 'held'].includes(row.phase),
  );
  const started = rows.some((row) =>
    ['waiting', 'uploading', 'uploaded'].includes(row.phase),
  );
  const finished = started && !busy && sendable.length === 0;

  /** Sends one file: presign, the bytes, then confirm. */
  const send = async (row: Row): Promise<{ phase: Phase; notice: Notice }> => {
    update(row.key, { phase: 'uploading', percent: 0, reason: null });
    let signed;
    try {
      signed = (
        await documentsControllerPresignV1({
          contentType: row.contentType!,
          sizeBytes: row.file.size,
          fileName: row.file.name,
        })
      ).data!;
    } catch (error) {
      const refusal = refusalOf(error);
      update(row.key, { phase: refusal.phase, reason: refusal.reason });
      announce(
        `${row.file.name} couldn’t be uploaded: ${refusal.reason}`,
        'assertive',
      );
      return { phase: refusal.phase, notice: refusal.notice ?? null };
    }
    try {
      await sendFile(
        signed.uploadUrl,
        signed.uploadMethod,
        row.file,
        (percent) => update(row.key, { percent }),
      );
      await documentsControllerConfirmV1({
        objectPath: signed.objectPath,
        title: row.title.trim(),
        fileName: row.file.name,
        isOrganizationWide: organizationWide,
        departmentIds: organizationWide ? [] : departmentIds,
        ocrLanguages: ocr,
      });
      update(row.key, { phase: 'uploaded', percent: 100 });
      announce(`${row.file.name} uploaded.`);
      void refresh();
      return { phase: 'uploaded', notice: null };
    } catch {
      const reason = 'Upload failed. Check your connection.';
      update(row.key, { phase: 'failed', reason });
      announce(`${row.file.name} couldn’t be uploaded: ${reason}`, 'assertive');
      return { phase: 'failed', notice: null };
    }
  };

  const upload = async (only?: Row[]) => {
    const batch = only ?? sendable;
    const errors = Object.fromEntries(
      batch.flatMap((row) => {
        const title = row.title.trim();
        const problem = !title
          ? 'Enter a title.'
          : title.length > MAX_DOCUMENT_TITLE_LENGTH
            ? 'Keep it under 255 characters.'
            : null;
        return problem ? [[row.key, problem]] : [];
      }),
    );
    const noDepartments = !organizationWide && departmentIds.length === 0;
    setTitleErrors(errors);
    setDepartmentError(
      noDepartments ? 'Choose at least one department.' : null,
    );
    if (Object.keys(errors).length || noDepartments || batch.length === 0)
      return;

    setBusy(true);
    setNotice(null);
    for (const row of batch)
      update(row.key, { phase: 'waiting', reason: null });
    let stopped: Notice = null;
    let uploaded = rows.filter((row) => row.phase === 'uploaded').length;
    let remaining = false;
    for (const [index, row] of batch.entries()) {
      const outcome = await send(row);
      if (outcome.phase === 'uploaded') uploaded++;
      if (outcome.phase === 'failed') remaining = true;
      if (outcome.notice) {
        // A plan limit or the rate limit stops the batch: the rest wait.
        stopped = outcome.notice;
        for (const rest of batch.slice(index + 1)) {
          update(rest.key, { phase: 'held', reason: 'Not uploaded yet.' });
        }
        break;
      }
    }
    setBusy(false);
    setNotice(
      stopped ?? (remaining ? null : { kind: 'done', count: uploaded }),
    );
  };

  const retryable = rows.filter((row) =>
    ['failed', 'held'].includes(row.phase),
  );
  const formOpen = !started || retryable.length > 0;

  const onDragOver = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    setDragging(true);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Upload documents</DialogTitle>
        <DialogDescription>
          PDF, Word, Markdown or text, up to 100 MB each. Several at once is
          fine.
        </DialogDescription>
      </DialogHeader>

      {notice && <UploadNotice notice={notice} />}

      {!started && (
        <div
          onDragOver={onDragOver}
          onDragLeave={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setDragging(false);
          }}
          onDrop={(event) => {
            if (!event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            setDragging(false);
            add([...event.dataTransfer.files]);
          }}
          className={cn(
            'flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-input bg-background px-4 text-center text-sm',
            rows.length ? 'flex-row justify-center py-4' : 'py-8',
            dragging && 'border-primary bg-accent',
          )}
        >
          {!rows.length && (
            <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <UploadIcon aria-hidden className="size-5" />
            </span>
          )}
          {dragging ? (
            <p className="font-medium">Drop to add them</p>
          ) : (
            <p className="flex flex-wrap items-center justify-center gap-2">
              {rows.length ? 'Add more files:' : 'Drag files here, or'}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => picker.current?.click()}
              >
                <FileUpIcon aria-hidden />
                Choose files
              </Button>
            </p>
          )}
          {!rows.length && !dragging && (
            <p className="text-muted-foreground">
              PDF, Word, Markdown or text, up to 100 MB each.
            </p>
          )}
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            accept=".pdf,.docx,.md,.markdown,.txt,application/pdf,text/markdown,text/plain"
            onChange={(event) => {
              add([...(event.target.files ?? [])]);
              event.target.value = '';
            }}
          />
        </div>
      )}

      {rows.length > 0 && (
        <ul aria-label="Files" className="flex flex-col gap-2">
          {rows.map((row) => (
            <FileRow
              key={row.key}
              row={row}
              editable={!started && row.phase === 'ready'}
              error={titleErrors[row.key]}
              onTitle={(title) => update(row.key, { title })}
              onRemove={
                !started || row.phase === 'refused'
                  ? () =>
                      setRows((current) =>
                        current.filter((item) => item.key !== row.key),
                      )
                  : undefined
              }
              onRetry={
                ['failed', 'held'].includes(row.phase) && !busy
                  ? () => void upload([row])
                  : undefined
              }
            />
          ))}
        </ul>
      )}

      {formOpen && (
        <>
          <VisibilityField
            legend="Who can see them"
            noun="them"
            organization={organization}
            organizationWide={organizationWide}
            departmentIds={departmentIds}
            departments={departments}
            disabled={busy}
            error={departmentError}
            onChange={(next) => {
              setOrganizationWide(next.organizationWide);
              setDepartmentIds(next.departmentIds);
            }}
          />
          <OcrLanguagesField value={ocr} onChange={setOcr} disabled={busy} />
        </>
      )}

      <DialogFooter>
        {finished ? (
          <Button onClick={onClose}>Done</Button>
        ) : retryable.length > 0 && !busy ? (
          <>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button onClick={() => void upload(retryable)}>
              <RotateCcwIcon aria-hidden />
              {`Retry ${retryable.length} ${retryable.length === 1 ? 'file' : 'files'}`}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={busy || sendable.length === 0}
              onClick={() => void upload()}
            >
              {busy ? (
                <>
                  <LoaderCircleIcon aria-hidden className="animate-spin" />
                  Uploading…
                </>
              ) : sendable.length > 0 ? (
                `Upload ${sendable.length} ${sendable.length === 1 ? 'document' : 'documents'}`
              ) : (
                'Upload'
              )}
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  );
}

/** "OCR languages", "{n} of 4", the list and its help. */
export function OcrLanguagesField({
  value,
  onChange,
  disabled,
}: {
  value: OcrLanguage[];
  onChange: (value: OcrLanguage[]) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>OCR languages</Label>
        <span className="text-xs text-muted-foreground">{`${value.length} of ${MAX_OCR_LANGUAGES}`}</span>
      </div>
      <MultiSelect
        id={id}
        label="OCR languages"
        heading={`Up to ${MAX_OCR_LANGUAGES} languages`}
        options={OCR_LANGUAGES.map((language) => ({
          value: language,
          label: OCR_LANGUAGE_LABEL[language],
        }))}
        value={value}
        onChange={(next) => onChange(next as OcrLanguage[])}
        max={MAX_OCR_LANGUAGES}
        disabled={disabled}
        describedBy={`${id}-help`}
        allowed={(option, chosen) =>
          ocrLanguageAllowed(option as OcrLanguage, chosen as OcrLanguage[])
        }
      />
      <p id={`${id}-help`} className="text-sm text-muted-foreground">
        For scanned pages; typed text doesn’t need it.
      </p>
    </div>
  );
}

function UploadNotice({ notice }: { notice: NonNullable<Notice> }) {
  const { can } = useViewer();
  switch (notice.kind) {
    case 'done':
      return (
        <Alert className="border-success-border bg-success-subtle text-success-subtle-foreground">
          <CircleCheckIcon aria-hidden />
          <AlertTitle>{`${notice.count} ${notice.count === 1 ? 'document' : 'documents'} uploaded`}</AlertTitle>
          <AlertDescription className="text-success-subtle-foreground">
            They’re being processed now and become searchable once indexed. The
            list shows their progress.
          </AlertDescription>
        </Alert>
      );
    case 'storage':
    case 'count':
      return (
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden />
          <AlertTitle>
            {notice.kind === 'storage'
              ? 'Storage is full'
              : 'The document limit is reached'}
          </AlertTitle>
          <AlertDescription>
            {notice.message}
            <PlanLink canChange={can('organization.update')} />
          </AlertDescription>
        </Alert>
      );
    case 'rate':
      return (
        <Alert className="border-warning-border bg-warning-subtle text-warning-subtle-foreground">
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>Too many uploads at once</AlertTitle>
          <AlertDescription className="text-warning-subtle-foreground">
            Wait a minute, then retry the files that didn’t upload.
            {notice.retryAfter !== null &&
              ` Try again in ${notice.retryAfter} seconds.`}
          </AlertDescription>
        </Alert>
      );
  }
}

function FileRow({
  row,
  editable,
  error,
  onTitle,
  onRemove,
  onRetry,
}: {
  row: Row;
  editable: boolean;
  error?: string;
  onTitle: (title: string) => void;
  onRemove?: () => void;
  onRetry?: () => void;
}) {
  const id = useId();
  const refused = row.phase === 'refused';
  const kind = fileTypeLabel(
    row.file.name.split('.').pop()?.toLowerCase() ?? '',
  );
  return (
    <li
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3',
        refused && 'border-destructive-border',
      )}
    >
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground',
          refused && 'text-destructive',
        )}
      >
        <FileTextIcon aria-hidden className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {editable ? (
          <>
            <Input
              id={id}
              aria-label={`Title for ${row.file.name}`}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              maxLength={MAX_DOCUMENT_TITLE_LENGTH}
              value={row.title}
              onChange={(event) => onTitle(event.target.value)}
            />
            {error && (
              <p id={`${id}-error`} className="text-sm text-destructive">
                {error}
              </p>
            )}
          </>
        ) : (
          <p className="truncate text-sm font-medium">
            {refused ? row.file.name : row.title}
          </p>
        )}
        {!refused && (
          <p className="text-xs text-muted-foreground">
            {`${kind} · ${fileSize(row.file.size)}`}
          </p>
        )}
        <RowState row={row} onRetry={onRetry} />
      </div>
      {onRemove && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${row.file.name}`}
          onClick={onRemove}
        >
          <XIcon aria-hidden />
        </Button>
      )}
    </li>
  );
}

function RowState({ row, onRetry }: { row: Row; onRetry?: () => void }) {
  switch (row.phase) {
    case 'waiting':
      return <p className="text-xs text-muted-foreground">Waiting…</p>;
    case 'uploading':
      return (
        <div className="flex flex-col gap-1">
          <Progress
            value={row.percent}
            aria-label={`Uploading ${row.file.name}`}
            className="h-1.5 bg-muted"
          />
          <p className="text-xs text-muted-foreground">{`Uploading… ${row.percent}%`}</p>
        </div>
      );
    case 'uploaded':
      return (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CircleCheckIcon aria-hidden className="size-3.5 text-success" />
          Uploaded. Processing comes next.
        </p>
      );
    case 'refused':
      return (
        <p className="flex items-start gap-1.5 text-sm text-destructive">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {row.reason}
        </p>
      );
    case 'failed':
    case 'held':
      return (
        <p className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <span className="inline-flex items-center gap-1.5">
            <CircleXIcon aria-hidden className="size-3.5" />
            {row.reason}
          </span>
          {onRetry && (
            <Button variant="outline" size="xs" onClick={onRetry}>
              <RotateCcwIcon aria-hidden />
              Retry
            </Button>
          )}
        </p>
      );
    default:
      return null;
  }
}
