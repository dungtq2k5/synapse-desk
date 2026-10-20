'use client';

import {
  useAnalyticsControllerCreateExportV1,
  useAnalyticsControllerGetExportV1,
  type CreateExportDtoKind,
} from '@synapsedesk/api-client';
import {
  CircleCheckIcon,
  CircleXIcon,
  DownloadIcon,
  LoaderCircleIcon,
  RotateCwIcon,
} from 'lucide-react';
import { useEffect, useId, useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDepartments } from '@/components/ticket/use-directory';
import {
  longDay,
  MAX_EXPORT_DAYS,
  rangeWords,
  spanDays,
} from '@/lib/analytics';
import { clockTime } from '@/lib/format';
import { useStoredExport } from '@/lib/stored-export';
import { announce, toastError } from '@/lib/toast';
import type { AnalyticsFilters } from './frame';
import { RangePicker } from './range-picker';

/** Where a requested export waits while the reader is elsewhere in Analytics. */
const EXPORT_KEY = 'synapsedesk.analytics-export';

const KINDS: { kind: CreateExportDtoKind; label: string; hint: string }[] = [
  {
    kind: 'TICKET',
    label: 'Tickets',
    hint: 'One row per ticket created in the range.',
  },
  {
    kind: 'TICKET_DAILY',
    label: 'Tickets per day',
    hint: 'One row per day: created, resolved, escalated.',
  },
  {
    kind: 'AGENT_DAILY',
    label: 'Agents per day',
    hint: 'One row per agent and day.',
  },
];

/** An export asked for, and what it covers in words. */
type Requested = {
  id: string;
  kind: CreateExportDtoKind;
  from: string;
  to: string;
  departmentId: string | null;
  /** "all departments" or the one's name. */
  department: string;
};

const covers = (requested: Requested) =>
  `${KINDS.find((one) => one.kind === requested.kind)?.label ?? 'Tickets'}, ${rangeWords(requested.from, requested.to)}, ${requested.department}`;

const ALL = 'all';

/** The heading's Export button and its dialog. */
export function ExportButton({ filters }: { filters: AnalyticsFilters }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <DownloadIcon aria-hidden />
        Export
      </Button>
      {open && (
        <ExportDialog filters={filters} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function ExportDialog({
  filters: { filters, limit, today },
  onClose,
}: {
  filters: AnalyticsFilters;
  onClose: () => void;
}) {
  const id = useId();
  const [, setRequested] = useStoredExport<Requested>(EXPORT_KEY);
  const directory = useDepartments();
  const [kind, setKind] = useState<CreateExportDtoKind>('TICKET');
  const [range, setRange] = useState({ from: filters.from, to: filters.to });
  const [department, setDepartment] = useState(filters.department ?? ALL);
  const longest = Math.min(MAX_EXPORT_DAYS, limit);
  const days = spanDays(range.from, range.to);
  const tooLong = days > longest;
  const create = useAnalyticsControllerCreateExportV1();

  const submit = async () => {
    if (tooLong) return;
    const departmentId = department === ALL ? null : department;
    try {
      const answer = await create.mutateAsync({
        data: { kind, from: range.from, to: range.to, departmentId },
      });
      const exportId = answer.data?.id;
      if (!exportId) return;
      setRequested({
        id: exportId,
        kind,
        ...range,
        departmentId,
        department:
          departmentId === null
            ? 'all departments'
            : (directory.names.get(departmentId) ?? 'one department'),
      });
      announce('Preparing your export');
      onClose();
    } catch {
      toastError('Couldn’t start the export', 'Try again in a moment.');
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Export analytics</DialogTitle>
          <DialogDescription>
            A CSV file, prepared in the background. You can keep using the page.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 text-sm font-medium">What to export</legend>
            <RadioGroup
              value={kind}
              onValueChange={(value) => setKind(value as CreateExportDtoKind)}
              className="gap-3"
            >
              {KINDS.map((one) => (
                <div key={one.kind} className="flex items-start gap-3">
                  <RadioGroupItem
                    id={`${id}-${one.kind}`}
                    value={one.kind}
                    aria-describedby={`${id}-${one.kind}-hint`}
                    className="mt-0.5"
                  />
                  <div className="flex flex-col gap-0.5">
                    <Label
                      htmlFor={`${id}-${one.kind}`}
                      className="font-normal"
                    >
                      {one.label}
                    </Label>
                    <p
                      id={`${id}-${one.kind}-hint`}
                      className="text-sm text-muted-foreground"
                    >
                      {one.hint}
                    </p>
                  </div>
                </div>
              ))}
            </RadioGroup>
          </fieldset>
          <div className="flex flex-col gap-2">
            <Label id={`${id}-range`}>Range</Label>
            <RangePicker
              value={range}
              limit={longest}
              today={today}
              billing={false}
              onApply={setRange}
            />
            {tooLong ? (
              <p role="alert" className="text-sm text-destructive">
                {`An export can cover up to ${longest} days. This range is ${days}.`}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {`Up to ${longest} days. Starts as the page’s range.`}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-department`}>Department</Label>
            <Select value={department} onValueChange={setDepartment}>
              <SelectTrigger id={`${id}-department`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All departments</SelectItem>
                {directory.items.map((one) => (
                  <SelectItem key={one.id} value={one.id}>
                    {one.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={tooLong || create.isPending}>
              Export
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The export's state at the top of every Analytics page, polled until it's
 * ready or failed, each announced: it follows the reader across the pages.
 */
export function ExportStatus() {
  const [requested, setRequested] = useStoredExport<Requested>(EXPORT_KEY);
  if (!requested) return null;
  return (
    <ExportCard
      key={requested.id}
      requested={requested}
      onGone={() => setRequested(null)}
      onRetried={(next) => setRequested(next)}
    />
  );
}

function ExportCard({
  requested,
  onGone,
  onRetried,
}: {
  requested: Requested;
  onGone: () => void;
  onRetried: (next: Requested) => void;
}) {
  const query = useAnalyticsControllerGetExportV1(requested.id, {
    query: {
      refetchInterval: (state) =>
        state.state.data?.data?.status === 'PENDING' ? 2000 : false,
    },
  });
  const job = query.data?.data;
  const status = job?.status ?? 'PENDING';
  const create = useAnalyticsControllerCreateExportV1();

  useEffect(() => {
    if (status === 'READY') announce('Your export is ready');
    if (status === 'FAILED') announce('The export failed', 'assertive');
  }, [status]);
  useEffect(() => {
    // An export that's gone (expired, or another account's) is forgotten.
    if (query.isError && !job) onGone();
  }, [query.isError, job, onGone]);

  const retry = async () => {
    try {
      const answer = await create.mutateAsync({
        data: {
          kind: requested.kind,
          from: requested.from,
          to: requested.to,
          departmentId: requested.departmentId,
        },
      });
      if (answer.data?.id) onRetried({ ...requested, id: answer.data.id });
    } catch {
      toastError('Couldn’t start the export', 'Try again in a moment.');
    }
  };

  if (status === 'READY') {
    const computed = job?.rollupComputedAt;
    return (
      <Alert variant="success">
        <CircleCheckIcon aria-hidden />
        <AlertTitle>Your export is ready</AlertTitle>
        <AlertDescription>
          <p>
            {covers(requested)}.
            {computed &&
              ` Data computed ${longDay(computed.slice(0, 10))}, ${clockTime(computed)}.`}
          </p>
          {job?.downloadUrl && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => {
                if (job.downloadUrl) window.open(job.downloadUrl);
              }}
            >
              <DownloadIcon aria-hidden />
              Download CSV
            </Button>
          )}
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
            Nothing was exported. Try again; if it fails again, contact support.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={create.isPending}
            onClick={() => void retry()}
          >
            <RotateCwIcon aria-hidden />
            Try again
          </Button>
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
      <AlertTitle>Preparing your export…</AlertTitle>
      <AlertDescription>
        {covers(requested)}. You can leave this page; it keeps going.
      </AlertDescription>
    </Alert>
  );
}
