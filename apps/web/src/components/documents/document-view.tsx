'use client';

import {
  ApiError,
  documentsControllerSetDepartmentsV1,
  documentsControllerUpdateV1,
  ingestionJobsControllerCancelV1,
  ingestionJobsControllerRetryV1,
  useDocumentsControllerGetV1,
  useDocumentsControllerListChunksV1,
  useDocumentsControllerListFlagsV1,
  useDocumentsControllerListIngestionJobsV1,
  useOrganizationsControllerGetV1,
  type DocumentResponseDto,
  type IngestionJobResponseDto,
} from '@synapsedesk/api-client';
import { parseOcrLanguages } from '@synapsedesk/contracts';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  ClockIcon,
  DownloadIcon,
  EllipsisIcon,
  FileUpIcon,
  InfoIcon,
  LoaderCircleIcon,
  LockIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SquareIcon,
  Trash2Icon,
  Undo2Icon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { openOriginal } from '@/components/knowledge/article-reader';
import { AppHeader } from '@/components/shell/app-header';
import { serverMessage, usePeople } from '@/components/ticket/use-directory';
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
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useViewer } from '@/hooks/use-viewer';
import {
  OCR_LANGUAGE_LABEL,
  RUNNING,
  STAGES,
  STAGE_LABEL,
  UPDATING,
  failure,
  fileTypeLabel,
  isUpdating,
  isWorking,
  updateFailed,
  updatedLabel,
  visibilityLabel,
  type Stage,
} from '@/lib/documents';
import { absoluteTime, clockTime, dayDate, fileSize } from '@/lib/format';
import { announce, toastError } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  DeletedBadge,
  DocumentStatusBadge,
  JobResult,
  Visibility,
} from './badges';
import {
  DeleteDocumentDialog,
  EditDocumentDialog,
  useDocumentActions,
  useDocumentCache,
} from './document-actions';
import { FlagCard } from './flag-card';
import { Pagination, PlanLink, useDepartmentNames } from './parts';
import { ReplaceDialog } from './replace-dialog';
import { useDocumentLive } from './use-document-live';
import { VisibilityField, andList } from './visibility-field';

const PASSAGES_PAGE = 4;
/** How often a document being processed looks again. */
const WORKING_POLL_MS = 4000;

/**
 * One document: its header and actions, how it's processed (the stepper, a
 * failure's plain words, Retry and Stop, the history), who can see it, its
 * details, the passages the AI reads, and its flags. A reader without
 * `document.read`, or a document that isn't there, gets "Document not found".
 */
export function DocumentView({ documentId }: { documentId: string }) {
  const { can, query: viewer } = useViewer();
  const readable = can('document.read');
  const live = useDocumentLive();
  const document = useDocumentsControllerGetV1(documentId, {
    query: {
      enabled: readable,
      retry: false,
      refetchInterval: (query) =>
        isWorking(query.state.data?.data) ? WORKING_POLL_MS : false,
    },
  });
  const doc = document.data?.data;

  if ((!viewer.isPending && !readable) || isGone(document.error)) {
    return <DocumentNotFound />;
  }
  if (document.isError) {
    return (
      <Frame title="Error">
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden />
          <AlertTitle>
            <h1>Couldn’t load the document</h1>
          </AlertTitle>
          <AlertDescription>
            Check your connection and try again.
            <Button
              variant="outline"
              size="sm"
              onClick={() => void document.refetch()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </Frame>
    );
  }
  if (!doc) return <Loading />;
  return <Loaded document={doc} fresh={live.has(doc.id)} />;
}

const isGone = (error: unknown) =>
  error instanceof ApiError && [400, 403, 404].includes(error.status);

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <AppHeader
        crumbs={[
          { label: 'Knowledge', href: '/knowledge' },
          { label: 'Documents', href: '/knowledge/documents' },
          { label: title },
        ]}
      />
      <main
        id="main"
        tabIndex={-1}
        className="flex flex-col gap-5 p-4 outline-none md:p-6"
      >
        {children}
      </main>
    </>
  );
}

export function DocumentNotFound() {
  return (
    <Frame title="Not found">
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
        <h1 className="text-lg font-semibold">Document not found</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          It doesn’t exist, or it isn’t shared with you.
        </p>
        <Link
          href="/knowledge/documents"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          Back to documents
        </Link>
      </div>
    </Frame>
  );
}

function Loading() {
  return (
    <Frame title="…">
      <div aria-busy className="flex flex-col gap-4">
        <span className="sr-only" role="status">
          Loading the document
        </span>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-48" />
        <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    </Frame>
  );
}

function Loaded({
  document,
  fresh,
}: {
  document: DocumentResponseDto;
  fresh: boolean;
}) {
  const { can } = useViewer();
  const { names } = usePeople();
  const departments = useDepartmentNames();
  const working = isWorking(document);
  const jobs = useDocumentsControllerListIngestionJobsV1(document.id, {
    query: {
      // While the document works, and until its latest attempt has finished:
      // the document can settle between two looks, leaving the job unread.
      refetchInterval: (query) =>
        working ||
        RUNNING.has(query.state.data?.data?.items.at(-1)?.status ?? '')
          ? WORKING_POLL_MS
          : false,
    },
  });
  const flags = useDocumentsControllerListFlagsV1({
    documentId: document.id,
    limit: 100,
  });
  const openFlags = flags.data?.data?.items ?? [];
  const searchParams = useSearchParams();
  const [dialog, setDialog] = useState<'edit' | 'replace' | 'delete' | null>(
    searchParams.get('replace') ? 'replace' : null,
  );
  const router = useRouter();
  const { restore, reindex } = useDocumentActions();
  const deleted = Boolean(document.deletedAt);
  const items = jobs.data?.data?.items ?? [];
  const latest = items.at(-1) ?? null;
  const updating = isUpdating(document);
  const uploader = names.get(document.createdById);
  const notSearchable = document.status !== 'INDEXED';

  return (
    <Frame title={document.title}>
      {deleted && (
        <Alert className="border-warning-border bg-warning-subtle text-warning-subtle-foreground">
          <Trash2Icon aria-hidden />
          <AlertTitle>{`This document was deleted on ${dayDate(document.deletedAt!)}`}</AlertTitle>
          <AlertDescription className="text-warning-subtle-foreground">
            It isn’t searchable and Ask doesn’t answer from it. Restore it to
            bring it back as it was.
            {can('document.delete') && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void restore(document)}
              >
                <Undo2Icon aria-hidden />
                Restore
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight break-words">
            {document.title}
          </h1>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <DocumentStatusBadge status={document.status} />
            {deleted && <DeletedBadge />}
            {notSearchable && !deleted && (
              <span className="text-muted-foreground">Not searchable yet</span>
            )}
            {updating && (
              <span className="text-muted-foreground">{UPDATING}</span>
            )}
            <span aria-hidden className="text-muted-foreground">
              ·
            </span>
            <Visibility
              document={document}
              label={visibilityLabel(document, departments)}
            />
          </p>
          <p className="text-sm text-muted-foreground">
            {`${fileTypeLabel(document.fileType)} · ${fileSize(document.fileSizeBytes)} · ${
              uploader ? `Uploaded by ${uploader} on ` : 'Uploaded on '
            }${dayDate(document.createdAt)}`}
          </p>
        </div>
        {!deleted && (
          <HeaderActions
            document={document}
            onDialog={setDialog}
            onReindex={() => void reindex(document)}
          />
        )}
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <Processing
            document={document}
            jobs={items}
            latest={latest}
            updating={updating}
            fresh={fresh}
            onReplace={() => setDialog('replace')}
          />
          <Passages document={document} />
          <section
            aria-labelledby="flags-heading"
            className="flex flex-col gap-3 rounded-lg border p-5"
          >
            <h2 id="flags-heading" className="text-xl font-semibold">
              {openFlags.length ? `Flags (${openFlags.length})` : 'Flags'}
            </h2>
            {openFlags.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing needs attention.
              </p>
            ) : (
              openFlags.map((flag) => (
                <FlagCard
                  key={flag.id}
                  flag={flag}
                  withDocument={false}
                  onReplaceFile={() => setDialog('replace')}
                />
              ))
            )}
          </section>
        </div>
        <div className="flex flex-col gap-5">
          <Sharing
            document={document}
            departments={departments}
            deleted={deleted}
          />
          <Details document={document} uploader={uploader} />
        </div>
      </div>

      <EditDocumentDialog
        document={document}
        open={dialog === 'edit'}
        onOpenChange={(open) => setDialog(open ? 'edit' : null)}
      />
      <ReplaceDialog
        document={document}
        openFlags={openFlags.length}
        open={dialog === 'replace'}
        onOpenChange={(open) => setDialog(open ? 'replace' : null)}
      />
      <DeleteDocumentDialog
        document={document}
        open={dialog === 'delete'}
        onOpenChange={(open) => setDialog(open ? 'delete' : null)}
        onDeleted={() => router.refresh()}
      />
    </Frame>
  );
}

function HeaderActions({
  document,
  onDialog,
  onReindex,
}: {
  document: DocumentResponseDto;
  onDialog: (dialog: 'edit' | 'replace' | 'delete') => void;
  onReindex: () => void;
}) {
  const { can } = useViewer();
  const editable = can('document.update');
  const more = editable || can('document.share') || can('document.delete');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" onClick={() => void openOriginal(document.id)}>
        <DownloadIcon aria-hidden />
        <span className="max-sm:sr-only">Download original</span>
      </Button>
      {editable && (
        <Button
          variant="outline"
          className="max-sm:hidden"
          onClick={() => onDialog('replace')}
        >
          <FileUpIcon aria-hidden />
          Replace file
        </Button>
      )}
      {can('document.reindex') && (
        <Button
          variant="outline"
          className="max-sm:hidden"
          // An indexed document only; a failed one is retried through its job.
          disabled={document.status !== 'INDEXED'}
          onClick={onReindex}
        >
          <RotateCcwIcon aria-hidden />
          Reindex
        </Button>
      )}
      {more && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="More actions">
              <EllipsisIcon aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="shadow-md">
            {editable && (
              <DropdownMenuItem
                className="sm:hidden"
                onSelect={() => onDialog('replace')}
              >
                Replace file
              </DropdownMenuItem>
            )}
            {can('document.reindex') && (
              <DropdownMenuItem
                className="sm:hidden"
                disabled={document.status !== 'INDEXED'}
                onSelect={onReindex}
              >
                Reindex
              </DropdownMenuItem>
            )}
            {editable && (
              <DropdownMenuItem onSelect={() => onDialog('edit')}>
                Edit
              </DropdownMenuItem>
            )}
            {can('document.share') && (
              <DropdownMenuItem
                onSelect={() =>
                  globalThis.document
                    .getElementById('sharing')
                    ?.scrollIntoView({ block: 'start' })
                }
              >
                Sharing
              </DropdownMenuItem>
            )}
            {can('document.delete') && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => onDialog('delete')}
                >
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

type StepState = 'done' | 'current' | 'waiting' | 'failed';

/** Each stage's state for the latest attempt. */
function steps(
  document: DocumentResponseDto,
  latest: IngestionJobResponseDto | null,
): Record<Stage, StepState> | null {
  const all = (state: StepState) =>
    Object.fromEntries(STAGES.map((stage) => [stage, state])) as Record<
      Stage,
      StepState
    >;
  if (!latest) return document.status === 'INDEXED' ? all('done') : null;
  if (latest.status === 'COMPLETED') return all('done');
  if (latest.status === 'CANCELLED') return null;
  const at: Stage =
    latest.status === 'FAILED'
      ? (latest.failedStage ?? 'PARSING')
      : (latest.status ?? 'QUEUED');
  const index = STAGES.indexOf(at);
  return Object.fromEntries(
    STAGES.map((stage, position) => [
      stage,
      position < index
        ? 'done'
        : position > index
          ? 'waiting'
          : latest.status === 'FAILED'
            ? 'failed'
            : 'current',
    ]),
  ) as Record<Stage, StepState>;
}

const STEP_WORD: Record<StepState, string> = {
  done: 'Done',
  current: 'In progress',
  waiting: 'Waiting',
  failed: 'Failed',
};

function Stepper({ state }: { state: Record<Stage, StepState> }) {
  return (
    <ol className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-0">
      {STAGES.map((stage, index) => {
        const step = state[stage];
        const Icon = {
          done: CircleCheckIcon,
          current: LoaderCircleIcon,
          waiting: CircleDashedIcon,
          failed: CircleXIcon,
        }[step];
        return (
          <li
            key={stage}
            aria-current={step === 'current' ? 'step' : undefined}
            className="flex items-start sm:flex-1 sm:last:flex-none"
          >
            <div className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Icon
                  aria-hidden
                  className={cn(
                    'size-4',
                    step === 'done' && 'text-primary',
                    step === 'current' &&
                      'animate-spin text-primary motion-reduce:animate-none',
                    step === 'waiting' && 'text-muted-foreground',
                    step === 'failed' && 'text-destructive',
                  )}
                />
                {STAGE_LABEL[stage]}
              </span>
              <span
                className={cn(
                  'pl-5.5 text-xs text-muted-foreground',
                  step === 'failed' && 'text-destructive',
                )}
              >
                {STEP_WORD[step]}
              </span>
            </div>
            {index < STAGES.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  'mx-3 mt-2.5 hidden h-0.5 flex-1 sm:block',
                  state[STAGES[index + 1]] === 'waiting'
                    ? 'bg-border'
                    : 'bg-primary',
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Processing({
  document,
  jobs,
  latest,
  updating,
  fresh,
  onReplace,
}: {
  document: DocumentResponseDto;
  jobs: IngestionJobResponseDto[];
  latest: IngestionJobResponseDto | null;
  updating: boolean;
  fresh: boolean;
  onReplace: () => void;
}) {
  const { can } = useViewer();
  const refresh = useDocumentCache();
  const [stopping, setStopping] = useState(false);
  const state = steps(document, latest);
  const working = isWorking(document);
  const failedUpdate = updateFailed(document);
  const waitingForAllowance =
    latest?.status === 'QUEUED' && latest.waitingReason === 'AI_ALLOWANCE';
  const running =
    latest !== null &&
    ['QUEUED', 'PARSING', 'CHUNKING', 'EMBEDDING'].includes(
      latest.status ?? '',
    );
  const deleted = Boolean(document.deletedAt);

  // A stage change is said, politely; becoming searchable too.
  const said = useRef<string | null>(null);
  useEffect(() => {
    const now = latest ? `${latest.id}:${latest.status}` : null;
    const before = said.current;
    said.current = now;
    if (!before || before === now || !latest) return;
    if (latest.status === 'COMPLETED') {
      announce('Indexed. It’s searchable now.');
    } else if (running) {
      announce(STAGE_LABEL[latest.status as Stage]);
    }
  }, [latest, running]);

  const retry = async () => {
    if (!latest) return;
    try {
      await ingestionJobsControllerRetryV1(latest.id);
      toast.success(`Processing ${document.title} again.`);
    } catch (error) {
      toastError('Couldn’t retry it', serverMessage(error));
    } finally {
      void refresh();
    }
  };

  const stop = async () => {
    if (!latest) return;
    try {
      await ingestionJobsControllerCancelV1(latest.id);
    } catch (error) {
      toastError('Couldn’t stop processing', serverMessage(error));
    } finally {
      setStopping(false);
      void refresh();
    }
  };

  const failed =
    latest?.status === 'FAILED'
      ? failure(latest.errorCode, document.fileType)
      : null;
  const indexedAt =
    latest?.status === 'COMPLETED'
      ? (latest.processedAt ?? document.updatedAt)
      : document.updatedAt;
  // Finished after the page opened: "just now", as it changed on screen.
  const [openedAt] = useState(() => Date.now());
  const justIndexed =
    latest?.status === 'COMPLETED' &&
    latest.processedAt !== null &&
    new Date(latest.processedAt).getTime() > openedAt;

  return (
    <section
      id="processing"
      aria-labelledby="processing-heading"
      className={cn(
        'flex scroll-mt-4 flex-col gap-4 rounded-lg border p-5 transition-colors duration-[2s] motion-reduce:transition-none',
        fresh && 'bg-accent',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="processing-heading" className="text-xl font-semibold">
          Processing
        </h2>
        {running &&
          !waitingForAllowance &&
          !deleted &&
          can('document.reindex') && (
            <Button
              variant="destructive-outline"
              size="sm"
              onClick={() => setStopping(true)}
            >
              <SquareIcon aria-hidden />
              Stop processing
            </Button>
          )}
      </div>

      {state && <Stepper state={state} />}

      {deleted ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Trash2Icon aria-hidden className="size-4" />
          {`Was indexed on ${dayDate(indexedAt)}. Not searchable while deleted.`}
        </p>
      ) : document.status === 'INDEXED' && !working && !failedUpdate ? (
        <p className="flex items-center gap-2 text-sm">
          <CircleCheckIcon aria-hidden className="size-4 text-primary" />
          {`${
            justIndexed
              ? 'Indexed just now.'
              : `Indexed on ${dayDate(indexedAt)} at ${clockTime(indexedAt)}.`
          } ${
            document.chunkCount === 1
              ? 'Its 1 passage is searchable.'
              : `Its ${document.chunkCount} passages are searchable.`
          }`}
        </p>
      ) : waitingForAllowance ? (
        <Alert
          role="status"
          className="border-info-border bg-info-subtle text-info-subtle-foreground"
        >
          <ClockIcon aria-hidden />
          <AlertTitle>Waiting for the AI allowance to reset</AlertTitle>
          <AlertDescription className="text-info-subtle-foreground">
            This month’s AI allowance ran out, so processing waits. It starts
            again by itself once the allowance resets or the plan changes.
            {updating && ' Answers use the current version meanwhile.'}
            {can('organization.update') && <PlanLink canChange />}
          </AlertDescription>
        </Alert>
      ) : running && updating ? (
        <Alert className="border-info-border bg-info-subtle text-info-subtle-foreground">
          <RefreshCwIcon aria-hidden />
          <AlertTitle className="line-clamp-none">{UPDATING}</AlertTitle>
        </Alert>
      ) : running || (working && !latest) ? (
        <Alert className="border-info-border bg-info-subtle text-info-subtle-foreground">
          <InfoIcon aria-hidden />
          <AlertTitle>Not searchable yet</AlertTitle>
          <AlertDescription className="text-info-subtle-foreground">
            {latest?.status === 'QUEUED' || !latest
              ? 'Waiting to start. Answers won’t use it until processing finishes.'
              : 'Answers won’t use it until processing finishes. This page updates by itself.'}
          </AlertDescription>
        </Alert>
      ) : latest?.status === 'CANCELLED' ? (
        <Alert className="border-info-border bg-info-subtle text-info-subtle-foreground">
          <SquareIcon aria-hidden />
          <AlertTitle>Processing was canceled</AlertTitle>
          <AlertDescription className="text-info-subtle-foreground">
            The document isn’t searchable. Retry to process it again.
            {can('document.reindex') && (
              <Button variant="outline" size="sm" onClick={() => void retry()}>
                <RotateCcwIcon aria-hidden />
                Retry
              </Button>
            )}
          </AlertDescription>
        </Alert>
      ) : failed ? (
        <Alert variant="destructive" role="alert">
          <CircleAlertIcon aria-hidden />
          <AlertTitle>
            {failedUpdate ? 'The update failed' : 'Processing failed'}
          </AlertTitle>
          <AlertDescription>
            {failedUpdate && (
              <p>
                Answers still use the previous version. Retry to process the new
                file again.
              </p>
            )}
            <p>{failed.sentence}</p>
            {latest?.errorLog && (
              <Collapsible className="w-full">
                <CollapsibleTrigger className="group inline-flex items-center gap-1 text-sm text-foreground">
                  <ChevronDownIcon
                    aria-hidden
                    className="size-4 transition-transform group-data-[state=closed]:-rotate-90"
                  />
                  Technical details
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="mt-2 rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap text-foreground">
                    {latest.errorLog}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            )}
            <div className="flex flex-wrap gap-2">
              {failed.retry && can('document.reindex') && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void retry()}
                >
                  <RotateCcwIcon aria-hidden />
                  Retry
                </Button>
              )}
              {failed.replace && can('document.update') && (
                <Button variant="outline" size="sm" onClick={onReplace}>
                  <FileUpIcon aria-hidden />
                  Replace file
                </Button>
              )}
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {jobs.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">History</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Finished</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...jobs].reverse().map((job) => (
                <TableRow key={job.id}>
                  <TableCell>
                    <time dateTime={job.createdAt}>
                      {absoluteTime(job.createdAt)}
                    </time>
                  </TableCell>
                  <TableCell>
                    <JobResult status={job.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {job.processedAt ? (
                      <time dateTime={job.processedAt}>
                        {absoluteTime(job.processedAt)}
                      </time>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={stopping} onOpenChange={setStopping}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Stop processing ${document.title}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              It won’t become searchable. You can retry later from this page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep processing</AlertDialogCancel>
            <Button variant="destructive" onClick={() => void stop()}>
              Stop processing
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/**
 * "Who can see it". Organization-wide or not is `PATCH` (`document.update`);
 * the departments are `PUT …/departments` (`document.share`). Someone with
 * only `document.share` gets the choice locked, with why, and the
 * departments editable.
 */
function Sharing({
  document,
  departments,
  deleted,
}: {
  document: DocumentResponseDto;
  departments: ReadonlyMap<string, string>;
  deleted: boolean;
}) {
  const { can } = useViewer();
  const refresh = useDocumentCache();
  const organization =
    useOrganizationsControllerGetV1({ query: { retry: false } }).data?.data
      ?.name ?? 'your organization';
  const [organizationWide, setOrganizationWide] = useState(
    document.isOrganizationWide,
  );
  const [departmentIds, setDepartmentIds] = useState<string[]>(
    document.departmentIds,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canUpdate = can('document.update');
  const canShare = can('document.share');
  const changed =
    organizationWide !== document.isOrganizationWide ||
    departmentIds.join() !== document.departmentIds.join();

  const discard = () => {
    setOrganizationWide(document.isOrganizationWide);
    setDepartmentIds(document.departmentIds);
    setError(null);
  };

  const save = async () => {
    if (!organizationWide && departmentIds.length === 0) {
      setError('Choose at least one department.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      // Departments first: switching away from everyone needs them in place.
      if (
        !organizationWide &&
        departmentIds.join() !== document.departmentIds.join()
      ) {
        await documentsControllerSetDepartmentsV1(document.id, {
          departmentIds,
        });
      }
      if (organizationWide !== document.isOrganizationWide) {
        await documentsControllerUpdateV1(document.id, {
          isOrganizationWide: organizationWide,
        });
      }
      toast.success('Sharing saved.');
      void refresh();
    } catch (failure) {
      toastError('Couldn’t save sharing', serverMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      id="sharing"
      aria-labelledby="sharing-heading"
      className="flex scroll-mt-4 flex-col gap-4 rounded-lg border p-5"
    >
      <h2 id="sharing-heading" className="text-xl font-semibold">
        Who can see it
      </h2>
      {deleted || (!canUpdate && !canShare) ? (
        <ReadOnlySharing
          document={document}
          organization={organization}
          departments={departments}
        />
      ) : (
        <>
          <VisibilityField
            legend="Who can see it"
            legendHidden
            noun="it"
            organization={organization}
            organizationWide={organizationWide}
            departmentIds={departmentIds}
            departments={departments}
            disabled={busy}
            error={error}
            locked={
              canUpdate ? undefined : (
                <span className="flex items-start gap-1.5">
                  <LockIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  Only people who can edit documents can switch between everyone
                  and departments.
                </span>
              )
            }
            onChange={(next) => {
              setOrganizationWide(next.organizationWide);
              setDepartmentIds(next.departmentIds);
            }}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!changed || busy}
              onClick={() => void save()}
            >
              Save sharing
            </Button>
            {changed && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={discard}
              >
                Discard
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function ReadOnlySharing({
  document,
  organization,
  departments,
}: {
  document: DocumentResponseDto;
  organization: string;
  departments: ReadonlyMap<string, string>;
}) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <Visibility
        document={document}
        label={
          document.isOrganizationWide
            ? `Everyone in ${organization}`
            : `Only ${andList(document.departmentIds.map((id) => departments.get(id) ?? 'Unknown department'))}`
        }
        className="font-medium"
      />
      <p className="text-muted-foreground">
        {document.isOrganizationWide
          ? 'Organization-wide. Everyone can find it and get answers from it.'
          : 'Everyone else won’t see it in Search or Ask.'}
      </p>
    </div>
  );
}

function Details({
  document,
  uploader,
}: {
  document: DocumentResponseDto;
  uploader: string | undefined;
}) {
  const languages = parseOcrLanguages(document.ocrLanguages)
    .map((language) => OCR_LANGUAGE_LABEL[language])
    .join(', ');
  const rows: [string, ReactNode][] = [
    ['Type', fileTypeLabel(document.fileType)],
    ['Size', fileSize(document.fileSizeBytes)],
    ['OCR languages', languages || '—'],
    ['Passages', document.status === 'INDEXED' ? document.chunkCount : '—'],
    [
      uploader ? 'Uploaded by' : 'Uploaded',
      uploader
        ? `${uploader}, ${dayDate(document.createdAt)}`
        : dayDate(document.createdAt),
    ],
    [
      'Updated',
      <time key="u" dateTime={document.updatedAt}>
        {updatedLabel(document.updatedAt)}
      </time>,
    ],
  ];
  return (
    <section
      aria-labelledby="details-heading"
      className="flex flex-col gap-4 rounded-lg border p-5"
    >
      <h2 id="details-heading" className="text-xl font-semibold">
        Details
      </h2>
      <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-muted-foreground">{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** "What the AI reads": the passages, in order, each opening the reader there. */
function Passages({ document }: { document: DocumentResponseDto }) {
  const [page, setPage] = useState(1);
  const indexed = document.chunkCount > 0;
  const chunks = useDocumentsControllerListChunksV1(
    document.id,
    { page, limit: PASSAGES_PAGE, sortBy: 'chunkIndex', sortOrder: 'ASC' },
    { query: { enabled: indexed } },
  );
  const pageData = chunks.data?.data;
  return (
    <section
      aria-labelledby="passages-heading"
      className="flex flex-col gap-3 rounded-lg border p-5"
    >
      <h2 id="passages-heading" className="text-xl font-semibold">
        What the AI reads
      </h2>
      <p className="text-sm text-muted-foreground">
        The passages Search and Ask answer from, in order.
      </p>
      {!indexed ? (
        <p className="text-sm text-muted-foreground">
          Passages appear here once the document is indexed.
        </p>
      ) : !pageData ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {pageData.items.map((chunk) => {
              const name = `Passage ${chunk.chunkIndex + 1}${chunk.pageNumber ? `, page ${chunk.pageNumber}` : ''}`;
              return (
                <li key={chunk.id}>
                  <Link
                    href={`/knowledge/articles/${document.id}?passage=${chunk.id}`}
                    aria-label={name}
                    className="flex items-center gap-3 rounded-lg border p-3 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-xs text-muted-foreground">
                        {[
                          `Passage ${chunk.chunkIndex + 1}`,
                          chunk.pageNumber ? `Page ${chunk.pageNumber}` : null,
                          `${chunk.tokenCount} tokens`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      <span className="line-clamp-2 text-sm">
                        {chunk.contentText}
                      </span>
                    </span>
                    <ChevronRightIcon
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
          <Pagination meta={pageData.meta} onPage={setPage} noun="passages" />
        </>
      )}
    </section>
  );
}
