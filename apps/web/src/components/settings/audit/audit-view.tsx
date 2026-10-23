'use client';

import {
  auditLogsControllerCreateExportV1,
  useAuditLogsControllerGetExportV1,
  useAuditLogsControllerListActionsV1,
  useAuditLogsControllerListV1,
  type AuditLogResponseDto,
  type AuditLogsControllerListV1Action as Action,
  type AuditLogsControllerListV1ResourceType as ResourceType,
} from '@synapsedesk/api-client';
import {
  CalendarIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleXIcon,
  DownloadIcon,
  LoaderCircleIcon,
  SearchXIcon,
  XIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type SubmitEvent } from 'react';
import { Field } from '@/components/auth/field';
import {
  ALL,
  Empty,
  FilterSelect,
  Pagination,
  useDepartmentNames,
} from '@/components/documents/parts';
import { UserAvatar } from '@/components/shell/user-avatar';
import { usePeople } from '@/components/ticket/use-directory';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useViewer } from '@/hooks/use-viewer';
import { RESOURCE_TYPE_WORDS, auditActionWords } from '@/lib/administration';
import { dayDate, logTime } from '@/lib/format';
import { useStoredExport } from '@/lib/stored-export';
import { announce } from '@/lib/toast';
import { refusalText } from '../people/person-dialogs';
import { useOrganizationName, useRoles } from '../people/shared';
import {
  LoadError,
  Loading,
  PageHeading,
  SettingsFrame,
} from '../settings-frame';
import { PageUnavailable } from '@/components/shell/page-unavailable';

const PAGE_SIZE = 20;
/**
 * Where a requested export waits while the viewer is elsewhere. Also the
 * event the same tab's writers raise.
 */
const EXPORT_KEY = 'synapsedesk.audit-export';

const RANGES = {
  today: 'Today',
  week: 'Last 7 days',
  month: 'Last 30 days',
  year: 'This year',
} as const;
type Range = keyof typeof RANGES;

/** A preset as the first and last moment it covers. */
export function rangeBounds(
  range: Range,
  now: Date = new Date(),
): { from: Date; to: Date } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (range === 'week') start.setDate(start.getDate() - 6);
  if (range === 'month') start.setDate(start.getDate() - 29);
  if (range === 'year') start.setMonth(0, 1);
  return { from: start, to: now };
}

/** "1 Oct – 18 Oct 2026". */
export function rangeLabel(from: Date | string, to: Date | string): string {
  const short = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
  });
  return `${short.format(new Date(from))} – ${dayDate(to)}`;
}

type Filters = {
  action?: Action;
  userId?: string;
  resourceType?: ResourceType;
};

/** The filters in words, for the export's line: "Action: Locked a person". */
function filterWords(
  filters: Filters,
  people: ReadonlyMap<string, string>,
): string[] {
  return [
    filters.action && `Action: ${auditActionWords(filters.action)}`,
    filters.userId && `Person: ${people.get(filters.userId) ?? 'Someone'}`,
    filters.resourceType &&
      `Resource type: ${RESOURCE_TYPE_WORDS[filters.resourceType]}`,
  ].filter((word): word is string => Boolean(word));
}

/** An export asked for: its id and what it covers, in words. */
type Requested = { id: string; from: string; to: string; filters: string[] };

/** Settings › Audit log: who did what, filtered, each entry in a sheet; export. */
export function AuditView() {
  const { can, query: viewer } = useViewer();
  const organization = useOrganizationName();
  const { names: people } = usePeople();
  const actions = useAuditLogsControllerListActionsV1({
    query: { enabled: can('audit.read'), staleTime: 300_000 },
  });
  const [filters, setFilters] = useState<Filters>({});
  const [range, setRange] = useState<Range>('month');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AuditLogResponseDto | null>(null);
  const [exporting, setExporting] = useState(false);
  const [requested, setRequested] = useStoredExport<Requested>(EXPORT_KEY);
  const bounds = useMemo(() => rangeBounds(range), [range]);
  const list = useAuditLogsControllerListV1(
    {
      page,
      limit: PAGE_SIZE,
      sortOrder: 'DESC',
      ...filters,
      from: bounds.from.toISOString(),
      to: bounds.to.toISOString(),
    },
    { query: { enabled: can('audit.read') } },
  );

  if (viewer.isSuccess && !can('audit.read')) {
    return (
      <SettingsFrame crumbs={[{ label: 'Audit log' }]}>
        <PageUnavailable back={{ href: '/settings', label: 'Settings' }} />
      </SettingsFrame>
    );
  }

  const change = (next: Filters) => {
    setFilters(next);
    setPage(1);
  };
  const filtered =
    filters.action !== undefined ||
    filters.userId !== undefined ||
    filters.resourceType !== undefined ||
    range !== 'month';
  const clear = () => {
    change({});
    setRange('month');
  };
  const data = list.data?.data;

  return (
    <SettingsFrame crumbs={[{ label: 'Audit log' }]}>
      <PageHeading
        title="Audit log"
        description={`Who did what in ${organization || 'your organization'}, and when. Entries can’t be changed.`}
        action={
          can('audit.export') && (
            <Button variant="outline" onClick={() => setExporting(true)}>
              <DownloadIcon aria-hidden />
              <span className="md:hidden">Export</span>
              <span className="hidden md:inline">Export CSV</span>
            </Button>
          )
        }
      />
      {requested && (
        <ExportStatusCard
          requested={requested}
          onRetry={() => setExporting(true)}
          onDismiss={() => setRequested(null)}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Action"
          value={filters.action}
          options={Object.fromEntries(
            (actions.data?.data?.actions ?? [])
              .map((action): [string, string] => [
                action,
                auditActionWords(action),
              ])
              .sort(([, a], [, b]) => a.localeCompare(b)),
          )}
          onValue={(value) =>
            change({
              ...filters,
              action: value === ALL ? undefined : (value as Action),
            })
          }
        />
        <FilterSelect
          label="Person"
          value={filters.userId}
          options={Object.fromEntries(people)}
          onValue={(value) =>
            change({ ...filters, userId: value === ALL ? undefined : value })
          }
        />
        <FilterSelect
          label="Resource type"
          value={filters.resourceType}
          options={RESOURCE_TYPE_WORDS}
          onValue={(value) =>
            change({
              ...filters,
              resourceType: value === ALL ? undefined : (value as ResourceType),
            })
          }
        />
        <Select
          value={range}
          onValueChange={(value) => {
            setRange(value as Range);
            setPage(1);
          }}
        >
          <SelectTrigger aria-label="Dates" className="w-auto gap-2">
            <CalendarIcon aria-hidden />
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="shadow-md">
            {Object.entries(RANGES).map(([key, text]) => (
              <SelectItem key={key} value={key}>
                {text}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtered && (
          <Button variant="ghost" onClick={clear}>
            Clear filters
          </Button>
        )}
      </div>
      {list.isError && !data ? (
        <LoadError what="the audit log" onRetry={() => void list.refetch()} />
      ) : !data ? (
        <Loading what="the audit log" className="h-96" />
      ) : data.items.length === 0 ? (
        <Empty
          icon={<SearchXIcon />}
          title="No entries match"
          description="Try a wider date range or fewer filters."
          action={
            filtered && (
              <Button variant="outline" onClick={clear}>
                Clear filters
              </Button>
            )
          }
        />
      ) : (
        <>
          <Entries items={data.items} people={people} onOpen={setOpen} />
          {data.meta.totalPages > 1 && (
            <Pagination meta={data.meta} onPage={setPage} noun="entries" />
          )}
        </>
      )}
      <EntrySheet entry={open} people={people} onClose={() => setOpen(null)} />
      <ExportDialog
        open={exporting}
        onOpenChange={setExporting}
        filters={filters}
        range={bounds}
        people={people}
        onRequested={(next) => {
          setRequested(next);
          announce('Preparing your export');
        }}
      />
    </SettingsFrame>
  );
}

/** A resource as "{type} · {name}", the name when this page can find it. */
function useResourceName() {
  const departments = useDepartmentNames();
  const { names: roles } = useRoles();
  const { names: people } = usePeople();
  return (entry: AuditLogResponseDto): string => {
    if (!entry.resourceType) return '—';
    const type = RESOURCE_TYPE_WORDS[entry.resourceType];
    const metadata = (entry.metadata ?? {}) as Record<string, unknown>;
    const id = entry.resourceId ?? '';
    const name =
      (entry.resourceType === 'USER' && people.get(id)) ||
      (entry.resourceType === 'DEPARTMENT' && departments.get(id)) ||
      (entry.resourceType === 'ROLE' && roles.get(id)) ||
      ['name', 'email', 'url', 'fileName']
        .map((key) => metadata[key])
        .find((value): value is string => typeof value === 'string');
    return name ? `${type} · ${name}` : type;
  };
}

function Who({
  entry,
  people,
}: {
  entry: AuditLogResponseDto;
  people: ReadonlyMap<string, string>;
}) {
  const name = entry.userId
    ? (people.get(entry.userId) ?? 'Someone')
    : 'SynapseDesk';
  return (
    <span className="flex items-center gap-2">
      <UserAvatar name={name} className="size-6 text-[10px]" />
      {name}
    </span>
  );
}

function Entries({
  items,
  people,
  onOpen,
}: {
  items: AuditLogResponseDto[];
  people: ReadonlyMap<string, string>;
  onOpen: (entry: AuditLogResponseDto) => void;
}) {
  const resource = useResourceName();
  const action = (entry: AuditLogResponseDto) => (
    <button
      type="button"
      className="text-left font-medium text-primary underline-offset-4 hover:underline"
      onClick={() => onOpen(entry)}
    >
      {entry.action ? auditActionWords(entry.action) : '—'}
    </button>
  );
  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border md:block">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Resource</TableHead>
              <TableHead>IP address</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="text-muted-foreground">
                  <time dateTime={entry.createdAt}>
                    {logTime(entry.createdAt)}
                  </time>
                </TableCell>
                <TableCell>
                  <Who entry={entry} people={people} />
                </TableCell>
                <TableCell className="max-w-56 whitespace-normal">
                  {action(entry)}
                </TableCell>
                <TableCell className="max-w-56 whitespace-normal">
                  {resource(entry)}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {entry.ipAddress ?? '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="flex flex-col gap-2 md:hidden">
        {items.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-col gap-1 rounded-lg border bg-card p-4 text-sm"
          >
            {action(entry)}
            <span className="text-muted-foreground">{resource(entry)}</span>
            <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
              <Who entry={entry} people={people} /> ·{' '}
              <time dateTime={entry.createdAt}>{logTime(entry.createdAt)}</time>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

const show = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' || typeof value === 'number')
    return String(value);
  return JSON.stringify(value);
};

/** "Field", the metadata key in words: `lockedUntil` → "Locked until". */
const fieldWords = (key: string) => {
  const words = key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * What changed: a `before`/`after` pair when the entry carries one, each
 * other detail as an after with nothing before.
 */
export function changes(
  metadata: unknown,
): { field: string; before: string; after: string }[] {
  if (!metadata || typeof metadata !== 'object') return [];
  const { before, after, ...rest } = metadata as Record<string, unknown>;
  const was = (before && typeof before === 'object' ? before : {}) as Record<
    string,
    unknown
  >;
  const now = (after && typeof after === 'object' ? after : {}) as Record<
    string,
    unknown
  >;
  const keys = [...new Set([...Object.keys(was), ...Object.keys(now)])];
  return [
    ...keys.map((key) => ({
      field: fieldWords(key),
      before: show(was[key]),
      after: show(now[key]),
    })),
    ...Object.entries(rest).map(([key, value]) => ({
      field: fieldWords(key),
      before: '—',
      after: show(value),
    })),
  ];
}

function EntrySheet({
  entry,
  people,
  onClose,
}: {
  entry: AuditLogResponseDto | null;
  people: ReadonlyMap<string, string>;
  onClose: () => void;
}) {
  const resource = useResourceName();
  const rows = entry ? changes(entry.metadata) : [];
  return (
    <Sheet open={entry !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {entry && (
          <>
            <SheetHeader>
              <SheetTitle>
                {entry.action ? auditActionWords(entry.action) : 'Entry'}
              </SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-6 px-4 pb-6">
              <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">When</dt>
                <dd>
                  {dayDate(entry.createdAt)},{' '}
                  {new Date(entry.createdAt).toLocaleTimeString('en-GB', {
                    hourCycle: 'h23',
                  })}
                </dd>
                <dt className="text-muted-foreground">Who</dt>
                <dd>
                  {entry.userId
                    ? (people.get(entry.userId) ?? 'Someone')
                    : 'SynapseDesk'}
                </dd>
                <dt className="text-muted-foreground">Action</dt>
                <dd>{entry.action ? auditActionWords(entry.action) : '—'}</dd>
                <dt className="text-muted-foreground">Code</dt>
                <dd className="font-mono text-xs">{entry.action ?? '—'}</dd>
                <dt className="text-muted-foreground">Resource</dt>
                <dd>{resource(entry)}</dd>
                <dt className="text-muted-foreground">IP address</dt>
                <dd className="font-mono text-xs">{entry.ipAddress ?? '—'}</dd>
                <dt className="text-muted-foreground">Browser</dt>
                <dd className="break-words">{entry.userAgent ?? '—'}</dd>
              </dl>
              {rows.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">What changed</h3>
                  <div className="overflow-hidden rounded-lg border">
                    <Table>
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead>Field</TableHead>
                          <TableHead>Before</TableHead>
                          <TableHead>After</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((row) => (
                          <TableRow key={row.field}>
                            <TableCell>{row.field}</TableCell>
                            <TableCell className="whitespace-normal">
                              {row.before}
                            </TableCell>
                            <TableCell className="whitespace-normal break-words">
                              {row.after}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </section>
              )}
              <Collapsible>
                <CollapsibleTrigger className="group flex items-center gap-1 text-sm">
                  <ChevronRightIcon
                    aria-hidden
                    className="size-4 transition-transform group-data-[state=open]:rotate-90"
                  />
                  Raw details
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">
                    {JSON.stringify(entry.metadata, null, 2)}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

const isoDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function ExportDialog({
  open,
  onOpenChange,
  filters,
  range,
  people,
  onRequested,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: Filters;
  range: { from: Date; to: Date };
  people: ReadonlyMap<string, string>;
  onRequested: (requested: Requested) => void;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kept, setKept] = useState<Filters>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const request = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Days, as the export's range is kept: the tenant's own timezone
      // decides where each one starts.
      const created = await auditLogsControllerCreateExportV1({
        from,
        to,
        filters: Object.keys(kept).length > 0 ? { ...kept } : null,
      });
      onRequested({
        id: created.data.id,
        from: `${from}T00:00:00`,
        to: `${to}T00:00:00`,
        filters: filterWords(kept, people),
      });
      onOpenChange(false);
    } catch (failure) {
      setError(refusalText(failure));
    } finally {
      setBusy(false);
    }
  };

  const chips: { key: keyof Filters; text: string }[] = (
    ['action', 'userId', 'resourceType'] as const
  )
    .filter((key) => kept[key] !== undefined)
    .map((key) => ({
      key,
      text: filterWords({ [key]: kept[key] }, people)[0],
    }));

  // Each opening starts afresh: a controlled dialog's onOpenChange
  // only hears it close.
  const [shown, setShown] = useState(false);
  if (open !== shown) {
    setShown(open);
    if (open) {
      setFrom(isoDay(range.from));
      setTo(isoDay(range.to));
      setKept(Object.fromEntries(Object.entries(filters).filter(([, v]) => v)));
      setError(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => void request(event)}
        >
          <DialogHeader>
            <DialogTitle>Export the audit log</DialogTitle>
            <DialogDescription>
              A CSV of the entries in a date range, with the filters you’ve set.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="export-from" label="From">
              {(aria) => (
                <Input
                  id="export-from"
                  type="date"
                  value={from}
                  max={to}
                  required
                  onChange={(event) => setFrom(event.target.value)}
                  {...aria}
                />
              )}
            </Field>
            <Field id="export-to" label="To">
              {(aria) => (
                <Input
                  id="export-to"
                  type="date"
                  value={to}
                  min={from}
                  required
                  onChange={(event) => setTo(event.target.value)}
                  {...aria}
                />
              )}
            </Field>
          </div>
          {chips.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Filters</span>
              <ul className="flex flex-wrap gap-1.5">
                {chips.map((chip) => (
                  <li
                    key={chip.key}
                    className="inline-flex items-center gap-1 rounded-md bg-secondary py-0.5 pr-0.5 pl-2 text-xs font-medium text-secondary-foreground"
                  >
                    {chip.text}
                    <button
                      type="button"
                      aria-label={`Remove ${chip.text}`}
                      className="rounded-sm p-0.5 hover:bg-background"
                      onClick={() =>
                        setKept({ ...kept, [chip.key]: undefined })
                      }
                    >
                      <XIcon aria-hidden className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            It’s prepared in the background. You can leave this page; it’ll be
            waiting here.
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={busy || !from || !to}>
              <DownloadIcon aria-hidden />
              Request export
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The export's state, polled until it's ready or failed, each announced. */
function ExportStatusCard({
  requested,
  onRetry,
  onDismiss,
}: {
  requested: Requested;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const query = useAuditLogsControllerGetExportV1(requested.id, {
    query: {
      refetchInterval: (state) =>
        state.state.data?.data?.status === 'PENDING' ? 2000 : false,
    },
  });
  const job = query.data?.data;
  const status = job?.status ?? 'PENDING';

  useEffect(() => {
    if (status === 'READY') announce('Your export is ready');
    if (status === 'FAILED') announce('The export failed', 'assertive');
  }, [status]);

  if (query.isError && !job) {
    // An export that's gone (expired or another account's) is forgotten.
    return null;
  }
  const covers = [
    rangeLabel(requested.from, requested.to),
    ...requested.filters,
  ].join(' · ');

  if (status === 'READY') {
    return (
      <Alert variant="success">
        <CircleCheckIcon aria-hidden />
        <AlertTitle>Your export is ready</AlertTitle>
        <AlertDescription>
          <p>
            {covers} · {job?.rowCount ?? 0}{' '}
            {job?.rowCount === 1 ? 'entry' : 'entries'}.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {job?.downloadUrl && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (job.downloadUrl) window.open(job.downloadUrl);
                }}
              >
                <DownloadIcon aria-hidden />
                Download CSV
              </Button>
            )}
          </div>
        </AlertDescription>
      </Alert>
    );
  }
  if (status === 'FAILED') {
    return (
      <Alert variant="destructive">
        <CircleXIcon aria-hidden />
        <AlertTitle>The export failed</AlertTitle>
        <AlertDescription>
          <p>
            Something went wrong while preparing it. Nothing was downloaded.
          </p>
          <div className="mt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onDismiss();
                onRetry();
              }}
            >
              Try again
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="info">
      <LoaderCircleIcon
        aria-hidden
        className="animate-spin motion-reduce:animate-none"
      />
      <AlertTitle>Preparing your export</AlertTitle>
      <AlertDescription>
        {covers}. You can leave this page; it’ll be waiting here when it’s
        ready.
      </AlertDescription>
    </Alert>
  );
}
