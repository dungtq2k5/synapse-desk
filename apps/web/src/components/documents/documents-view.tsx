'use client';

import {
  useDocumentsControllerListFlagsV1,
  useDocumentsControllerListIngestionJobsV1,
  useDocumentsControllerListV1,
  useDocumentsControllerStorageUsageV1,
  type DocumentResponseDto,
  type DocumentsControllerListV1Params,
  type StorageUsageResponseDto,
} from '@synapsedesk/api-client';
import { keepPreviousData } from '@tanstack/react-query';
import {
  CircleAlertIcon,
  EllipsisIcon,
  FileTextIcon,
  FilterIcon,
  HardDriveIcon,
  SearchIcon,
  SearchXIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { AppHeader } from '@/components/shell/app-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useIsMobile } from '@/hooks/use-mobile';
import { useViewer } from '@/hooks/use-viewer';
import {
  DOCUMENT_STATUS_LABEL,
  FILE_TYPE_LABEL,
  UPDATING,
  fileTypeLabel,
  isWorking,
  latestRun,
  stageCaption,
  storageLevel,
  updatedLabel,
  visibilityLabel,
} from '@/lib/documents';
import { fileSize } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  KnowledgeHeader,
  KnowledgeUnavailable,
} from '../knowledge/knowledge-header';
import {
  DeletedBadge,
  DocumentStatusBadge,
  FlagCount,
  Visibility,
} from './badges';
import {
  DeleteDocumentDialog,
  EditDocumentDialog,
  useDocumentActions,
} from './document-actions';
import { ReplaceDialog } from './replace-dialog';
import {
  ALL,
  Empty,
  FilterSelect,
  Pagination,
  PlanLink,
  useDepartmentNames,
} from './parts';
import { UploadButton } from './upload-dialog';
import { useDocumentLive } from './use-document-live';

const PAGE = 8;
/** How often a list with work in flight looks again. */
const WORKING_POLL_MS = 5000;

type Filters = Pick<
  DocumentsControllerListV1Params,
  'searchTerm' | 'status' | 'departmentId' | 'fileType' | 'includeDeleted'
>;

/**
 * Knowledge › Documents: every document the AI answers from, how each is
 * processed, and what may be done to it, each action behind its permission.
 * A list with work in flight looks again every few seconds, and an indexed
 * or failed document changes in place.
 */
export function DocumentsView() {
  const { can, query: viewer } = useViewer();
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const fresh = useDocumentLive();
  const departments = useDepartmentNames();
  const readable = can('document.read');

  const list = useDocumentsControllerListV1(
    {
      ...filters,
      page,
      limit: PAGE,
      sortBy: 'createdAt',
      sortOrder: 'DESC',
    },
    {
      query: {
        enabled: readable,
        placeholderData: keepPreviousData,
        refetchInterval: (query) =>
          query.state.data?.data?.items.some((document) =>
            isWorking(document.status),
          )
            ? WORKING_POLL_MS
            : false,
      },
    },
  );
  const storage = useDocumentsControllerStorageUsageV1({
    query: { enabled: readable },
  });
  const flags = useDocumentsControllerListFlagsV1(
    { limit: 100 },
    { query: { enabled: readable } },
  );
  const flagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const flag of flags.data?.data?.items ?? []) {
      counts.set(flag.documentId, (counts.get(flag.documentId) ?? 0) + 1);
    }
    return counts;
  }, [flags.data]);

  const changeFilters = useCallback((next: Filters) => {
    setFilters(next);
    setPage(1);
  }, []);
  // Bumped by "Clear filters", so the toolbar starts again with an empty box.
  const [cleared, setCleared] = useState(0);

  const usage = storage.data?.data;
  const full = usage
    ? storageLevel(usage.usedBytes, usage.limitBytes) === 'full'
    : false;
  const fullAlert = useId();
  const pageData = list.data?.data;
  const { includeDeleted, ...narrowing } = filters;
  const filtered =
    Object.values(narrowing).some((value) => value !== undefined) ||
    Boolean(includeDeleted);

  if (!viewer.isPending && !readable) {
    return (
      <>
        <AppHeader
          crumbs={[
            { label: 'Knowledge', href: '/knowledge' },
            { label: 'Not found' },
          ]}
        />
        <main id="main" tabIndex={-1} className="p-4 outline-none md:p-6">
          <KnowledgeUnavailable />
        </main>
      </>
    );
  }

  return (
    <>
      <AppHeader
        crumbs={[
          { label: 'Knowledge', href: '/knowledge' },
          { label: 'Documents' },
        ]}
      />
      <main
        id="main"
        tabIndex={-1}
        className="flex flex-col gap-5 p-4 outline-none md:p-6"
      >
        <KnowledgeHeader
          tab="documents"
          description="The documents the AI answers from, and how each is processed."
          actions={
            can('document.create') && (
              <UploadButton
                disabled={full}
                describedBy={full ? fullAlert : undefined}
              />
            )
          }
        />

        {usage && <Storage usage={usage} alertId={fullAlert} />}

        <Toolbar
          key={cleared}
          filters={filters}
          onChange={changeFilters}
          departments={departments}
          showDeleted={can('document.delete')}
        />

        {list.isError && !pageData ? (
          <Empty
            icon={<CircleAlertIcon />}
            title="Couldn’t load the documents"
            description="Check your connection and try again."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => void list.refetch()}
              >
                Try again
              </Button>
            }
          />
        ) : !pageData ? (
          <Loading />
        ) : pageData.items.length === 0 ? (
          filtered ? (
            <Empty
              icon={<SearchXIcon />}
              title="No documents match"
              description="Try other words or clear the filters."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    changeFilters({});
                    setCleared((count) => count + 1);
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <Empty
              icon={<FileTextIcon />}
              title="No documents yet"
              description="Upload your policies, guides and FAQs. Ask answers better when it has documents to answer from."
              action={
                can('document.create') && (
                  <UploadButton label="Upload documents" size="sm" />
                )
              }
            />
          )
        ) : (
          <>
            <div
              aria-busy={list.isFetching || undefined}
              className="hidden overflow-hidden rounded-lg border md:block"
            >
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Visibility</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead>Flags</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageData.items.map((document) => (
                    <DocumentRow
                      key={document.id}
                      document={document}
                      fresh={fresh.has(document.id)}
                      visibility={visibilityLabel(document, departments)}
                      flags={flagCounts.get(document.id) ?? 0}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul
              aria-busy={list.isFetching || undefined}
              className="flex flex-col gap-2 md:hidden"
            >
              {pageData.items.map((document) => (
                <DocumentCard
                  key={document.id}
                  document={document}
                  fresh={fresh.has(document.id)}
                  visibility={visibilityLabel(document, departments)}
                  flags={flagCounts.get(document.id) ?? 0}
                />
              ))}
            </ul>

            <Pagination
              meta={pageData.meta}
              onPage={setPage}
              noun="documents"
            />
          </>
        )}
      </main>
    </>
  );
}

/** "Storage · {used} of {limit} · {n} documents", its bar, and the alerts. */
function Storage({
  usage,
  alertId,
}: {
  usage: StorageUsageResponseDto;
  alertId: string;
}) {
  const { can } = useViewer();
  const level = storageLevel(usage.usedBytes, usage.limitBytes);
  const percent =
    usage.limitBytes > 0
      ? Math.min(100, (usage.usedBytes / usage.limitBytes) * 100)
      : 100;
  const label = `${fileSize(usage.usedBytes)} of ${fileSize(usage.limitBytes)} · ${usage.documentCount} ${
    usage.documentCount === 1 ? 'document' : 'documents'
  }`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:w-80">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <HardDriveIcon aria-hidden className="size-4 text-muted-foreground" />
          <span className="font-medium">Storage</span>
          <span className="text-muted-foreground">{label}</span>
          {level === 'almost' && <Badge variant="warning">Almost full</Badge>}
          {level === 'full' && (
            <Badge
              variant="outline"
              className="border-destructive-border bg-destructive-subtle text-destructive-subtle-foreground"
            >
              Full
            </Badge>
          )}
        </p>
        <Progress
          value={percent}
          aria-label={`Storage, ${label}`}
          className={cn(
            'bg-muted',
            level === 'almost' && '[&>*]:bg-warning',
            level === 'full' && '[&>*]:bg-destructive',
          )}
        />
      </div>
      {level === 'almost' && (
        <Alert className="border-warning-border bg-warning-subtle text-warning-subtle-foreground">
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>Storage is almost full</AlertTitle>
          <AlertDescription className="text-warning-subtle-foreground">
            {`${fileSize(usage.usedBytes)} of ${fileSize(usage.limitBytes)} used. Delete documents you no longer need, or move to a larger plan.`}
          </AlertDescription>
        </Alert>
      )}
      {level === 'full' && (
        <Alert variant="destructive" id={alertId}>
          <CircleAlertIcon aria-hidden />
          <AlertTitle>Storage is full</AlertTitle>
          <AlertDescription>
            Your document storage is full. New uploads will be refused until
            space is freed or your plan is changed.
            <PlanLink canChange={can('organization.update')} />
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function Toolbar({
  filters,
  onChange,
  departments,
  showDeleted,
}: {
  filters: Filters;
  onChange: (filters: Filters) => void;
  departments: ReadonlyMap<string, string>;
  showDeleted: boolean;
}) {
  const mobile = useIsMobile();
  const [search, setSearch] = useState(filters.searchTerm ?? '');

  // The search is sent once typing pauses.
  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      const searchTerm = search.trim() || undefined;
      if (searchTerm !== filters.searchTerm)
        onChange({ ...filters, searchTerm });
    }, 300);
    return () => globalThis.clearTimeout(timer);
  }, [search, filters, onChange]);

  const set = <K extends keyof Filters>(key: K, value: string) =>
    onChange({ ...filters, [key]: value === ALL ? undefined : value });
  const chosen = [
    filters.status,
    filters.departmentId,
    filters.fileType,
  ].filter(Boolean).length;

  const selects = (
    <>
      <FilterSelect
        label="Status"
        value={filters.status}
        options={DOCUMENT_STATUS_LABEL}
        onValue={(value) => set('status', value)}
      />
      {departments.size > 0 && (
        <FilterSelect
          label="Department"
          value={filters.departmentId}
          options={Object.fromEntries(departments)}
          onValue={(value) => set('departmentId', value)}
        />
      )}
      <FilterSelect
        label="Type"
        value={filters.fileType}
        options={FILE_TYPE_LABEL}
        onValue={(value) => set('fileType', value)}
      />
    </>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full md:w-70">
        <SearchIcon
          aria-hidden
          className="absolute top-2.5 left-3 size-4 text-muted-foreground"
        />
        <Input
          type="search"
          aria-label="Search documents"
          placeholder="Search documents"
          className="pl-9"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {mobile ? (
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline">
              <FilterIcon aria-hidden />
              {chosen ? `Filters (${chosen})` : 'Filters'}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" aria-describedby={undefined}>
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-3 px-4 pb-6 [&_button[role=combobox]]:w-full">
              {selects}
            </div>
          </SheetContent>
        </Sheet>
      ) : (
        selects
      )}
      {showDeleted && (
        <div className="ml-auto flex items-center gap-2">
          <Switch
            id="show-deleted"
            checked={Boolean(filters.includeDeleted)}
            onCheckedChange={(checked) =>
              onChange({ ...filters, includeDeleted: checked || undefined })
            }
          />
          <Label htmlFor="show-deleted" className="font-normal">
            Show deleted
          </Label>
        </div>
      )}
    </div>
  );
}

/**
 * Where a document is: its status, and, while it's worked on, the latest
 * attempt's stage (or why it waits) and whether it still answers from its
 * last version.
 */
function useProgress(document: DocumentResponseDto) {
  const working = isWorking(document.status);
  const jobs = useDocumentsControllerListIngestionJobsV1(document.id, {
    query: {
      enabled: working,
      refetchInterval: working ? WORKING_POLL_MS : false,
    },
  });
  const { latest, updating } = latestRun(jobs.data?.data?.items ?? []);
  return {
    working,
    caption: working ? stageCaption(latest) : null,
    updating: working && updating,
  };
}

function TitleLink({
  document,
  caption,
}: {
  document: DocumentResponseDto;
  caption: string | null;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <Link
        href={`/knowledge/documents/${document.id}`}
        className={cn(
          'inline-flex min-w-0 items-center gap-2 font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring',
          document.deletedAt && 'text-muted-foreground',
        )}
      >
        <FileTextIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="truncate">{document.title}</span>
      </Link>
      {caption && (
        <span className="text-xs whitespace-normal text-muted-foreground">
          {caption}
        </span>
      )}
    </div>
  );
}

function DocumentRow({
  document,
  fresh,
  visibility,
  flags,
}: {
  document: DocumentResponseDto;
  fresh: boolean;
  visibility: string;
  flags: number;
}) {
  const progress = useProgress(document);
  const notSearchable =
    document.status !== 'INDEXED' && !progress.updating
      ? 'Not searchable yet'
      : null;
  return (
    <TableRow
      className={cn(
        'transition-colors duration-[2s] motion-reduce:transition-none',
        fresh && 'bg-accent',
      )}
    >
      <TableCell className="w-full max-w-0">
        <TitleLink
          document={document}
          caption={progress.updating ? UPDATING : notSearchable}
        />
      </TableCell>
      <TableCell>{fileTypeLabel(document.fileType)}</TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-0.5">
          <div className="flex items-center gap-1.5">
            <DocumentStatusBadge status={document.status} />
            {document.deletedAt && <DeletedBadge />}
          </div>
          {progress.caption && (
            <span className="max-w-36 text-xs whitespace-normal text-muted-foreground">
              {progress.caption}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <Visibility document={document} label={visibility} />
      </TableCell>
      <TableCell>{fileSize(document.fileSizeBytes)}</TableCell>
      <TableCell className="text-muted-foreground">
        <time dateTime={document.updatedAt}>
          {updatedLabel(document.updatedAt)}
        </time>
      </TableCell>
      <TableCell>
        <FlagCount count={flags} />
      </TableCell>
      <TableCell>
        <RowActions document={document} />
      </TableCell>
    </TableRow>
  );
}

function DocumentCard({
  document,
  fresh,
  visibility,
  flags,
}: {
  document: DocumentResponseDto;
  fresh: boolean;
  visibility: string;
  flags: number;
}) {
  const progress = useProgress(document);
  return (
    <li
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-3 transition-colors duration-[2s] motion-reduce:transition-none',
        fresh && 'bg-accent',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <TitleLink
          document={document}
          caption={progress.updating ? UPDATING : null}
        />
        <RowActions document={document} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <DocumentStatusBadge status={document.status} />
        {document.deletedAt && <DeletedBadge />}
        {progress.caption && <span>{progress.caption}</span>}
        {document.status !== 'INDEXED' && !progress.updating && (
          <span>Not searchable yet</span>
        )}
        {flags > 0 && <FlagCount count={flags} />}
      </div>
      <Visibility document={document} label={visibility} className="text-sm" />
      <p className="text-xs text-muted-foreground">
        {`${fileTypeLabel(document.fileType)} · ${fileSize(document.fileSizeBytes)} · `}
        <time dateTime={document.updatedAt}>
          {updatedLabel(document.updatedAt)}
        </time>
      </p>
    </li>
  );
}

/** A row's menu: each action only with its permission. */
function RowActions({ document }: { document: DocumentResponseDto }) {
  const { can } = useViewer();
  const { reindex, restore } = useDocumentActions();
  const [dialog, setDialog] = useState<'edit' | 'replace' | 'delete' | null>(
    null,
  );
  const href = `/knowledge/documents/${document.id}`;
  const editable = can('document.update');

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${document.title}`}
          >
            <EllipsisIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="shadow-md">
          <DropdownMenuItem asChild>
            <Link href={href}>Open</Link>
          </DropdownMenuItem>
          {document.deletedAt ? (
            can('document.delete') && (
              <DropdownMenuItem onSelect={() => void restore(document)}>
                Restore
              </DropdownMenuItem>
            )
          ) : (
            <>
              {editable && (
                <DropdownMenuItem onSelect={() => setDialog('edit')}>
                  Edit
                </DropdownMenuItem>
              )}
              {can('document.share') && (
                <DropdownMenuItem asChild>
                  <Link href={`${href}#sharing`}>Sharing</Link>
                </DropdownMenuItem>
              )}
              {editable && (
                <DropdownMenuItem onSelect={() => setDialog('replace')}>
                  Replace file
                </DropdownMenuItem>
              )}
              {can('document.reindex') && (
                <DropdownMenuItem
                  disabled={document.status !== 'INDEXED'}
                  onSelect={() => void reindex(document)}
                >
                  Reindex
                </DropdownMenuItem>
              )}
              {can('document.delete') && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setDialog('delete')}
                  >
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <EditDocumentDialog
        document={document}
        open={dialog === 'edit'}
        onOpenChange={(open) => setDialog(open ? 'edit' : null)}
      />
      <ReplaceDialog
        document={document}
        open={dialog === 'replace'}
        onOpenChange={(open) => setDialog(open ? 'replace' : null)}
      />
      <DeleteDocumentDialog
        document={document}
        open={dialog === 'delete'}
        onOpenChange={(open) => setDialog(open ? 'delete' : null)}
      />
    </>
  );
}

function Loading() {
  return (
    <div aria-busy className="flex flex-col gap-2">
      <span className="sr-only" role="status">
        Loading documents
      </span>
      {Array.from({ length: 6 }, (_, row) => (
        <div
          key={row}
          className="flex items-center gap-4 rounded-lg border p-3"
        >
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="hidden h-4 w-28 md:block" />
          <Skeleton className="hidden h-4 w-16 md:block" />
        </div>
      ))}
    </div>
  );
}
