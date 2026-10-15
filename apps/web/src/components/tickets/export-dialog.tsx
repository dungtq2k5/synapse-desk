'use client';

import {
  ApiError,
  ticketsControllerCreateExportV1,
  useTicketsControllerGetExportV1,
} from '@synapsedesk/api-client';
import {
  CircleAlertIcon,
  CircleCheckIcon,
  DownloadIcon,
  FileDownIcon,
  LoaderCircleIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/auth/field';
import { useDepartments } from '@/components/ticket/use-directory';
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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { calendarDate } from '@/lib/format';
import { announce, toastError } from '@/lib/toast';

/** The latest export, kept so reopening the dialog after a reload resumes it. */
const STORED = 'synapsedesk.ticket-export';
const POLL_MS = 2000;
const ALL = 'all';

type Started = {
  id: string;
  from: string;
  to: string;
  departmentId: string | null;
};

/** The stored export, or none when storage is empty, unreadable or blocked. */
function readStored(): Started | null {
  try {
    const raw = globalThis.localStorage.getItem(STORED);
    return raw ? (JSON.parse(raw) as Started) : null;
  } catch {
    return null;
  }
}

function writeStored(started: Started | null) {
  try {
    if (started) {
      globalThis.localStorage.setItem(STORED, JSON.stringify(started));
    } else {
      globalThis.localStorage.removeItem(STORED);
    }
  } catch {
    // Storage can be unavailable; the dialog then starts fresh next time.
  }
}

const day = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Export, and the dialog behind it: a CSV of the tickets in a period. The
 * export runs on the server; this polls it until it's ready or failed, also
 * while the dialog is closed, and says so with a toast then.
 */
export function ExportButton() {
  const departments = useDepartments();
  const [open, setOpen] = useState(false);
  const [stored, setStarted] = useState<Started | null>(null);

  const job = useTicketsControllerGetExportV1(stored?.id ?? '', {
    query: {
      enabled: Boolean(stored),
      refetchInterval: (query) =>
        query.state.data?.data?.status === 'PENDING' ? POLL_MS : false,
      staleTime: 0,
      gcTime: 0,
      retry: false,
    },
  });
  // An id the server no longer knows: start fresh.
  const gone = job.error instanceof ApiError && job.error.status === 404;
  const started = gone ? null : stored;
  const status = started
    ? (job.data?.data?.status ?? (job.isError ? 'FAILED' : 'PENDING'))
    : null;
  const running = status === 'PENDING';

  const range = started
    ? `${calendarDate(started.from, 'UTC')} – ${calendarDate(started.to, 'UTC')}`
    : '';
  const department = started?.departmentId
    ? (departments.names.get(started.departmentId) ?? 'Unknown department')
    : 'All departments';

  useEffect(() => {
    if (gone) writeStored(null);
  }, [gone]);

  // Said once when an export this page watched finishes, open or not; a
  // toast offers the file when the dialog was closed.
  const watched = useRef(false);
  const isOpen = useRef(open);
  useEffect(() => {
    isOpen.current = open;
  }, [open]);
  useEffect(() => {
    if (status === 'PENDING') watched.current = true;
    if ((status !== 'READY' && status !== 'FAILED') || !watched.current) return;
    watched.current = false;
    if (status === 'FAILED') return announce('Export failed', 'assertive');
    announce('Export ready');
    const url = job.data?.data?.downloadUrl;
    if (!isOpen.current && url) {
      toast.success('Your export is ready', {
        description: range,
        duration: Infinity,
        action: { label: 'Download CSV', onClick: () => window.open(url) },
      });
    }
  }, [status, job.data, range]);

  const show = (next: boolean) => {
    if (next && !stored) setStarted(readStored());
    setOpen(next);
  };

  const begin = (next: Started) => {
    writeStored(next);
    setStarted(next);
  };

  const restart = () => {
    writeStored(null);
    setStarted(null);
  };

  return (
    <Dialog open={open} onOpenChange={show}>
      <Button
        variant="outline"
        size="sm"
        aria-haspopup="dialog"
        aria-label={running ? 'Export, running' : undefined}
        onClick={() => show(true)}
      >
        {running ? (
          <LoaderCircleIcon aria-hidden className="motion-safe:animate-spin" />
        ) : (
          <FileDownIcon aria-hidden />
        )}
        {running ? 'Exporting…' : 'Export'}
      </Button>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Export tickets</DialogTitle>
          {!started && (
            <DialogDescription>
              A CSV of the tickets in this period. You can close this dialog
              while it’s prepared.
            </DialogDescription>
          )}
        </DialogHeader>
        {!started ? (
          <ExportForm departments={departments.items} onStarted={begin} />
        ) : status === 'READY' ? (
          <>
            <Alert variant="success">
              <CircleCheckIcon aria-hidden />
              <AlertTitle>Your export is ready</AlertTitle>
              <AlertDescription>
                {range} · {department}
              </AlertDescription>
            </Alert>
            <DialogFooter>
              <Button variant="outline" onClick={restart}>
                New export
              </Button>
              <Button
                autoFocus
                onClick={() => {
                  const url = job.data?.data?.downloadUrl;
                  if (url) window.open(url);
                }}
              >
                <DownloadIcon aria-hidden />
                Download CSV
              </Button>
            </DialogFooter>
          </>
        ) : status === 'FAILED' ? (
          <>
            <Alert variant="destructive">
              <CircleAlertIcon aria-hidden />
              <AlertTitle>The export failed</AlertTitle>
              <AlertDescription>
                {job.data?.data?.error ?? 'Something went wrong on our side.'}
              </AlertDescription>
            </Alert>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Close</Button>
              </DialogClose>
              <Button autoFocus onClick={restart}>
                Try again
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div
              aria-busy
              className="flex flex-col gap-1 rounded-md border p-3 text-sm"
            >
              <span className="flex items-center gap-2 font-medium">
                <LoaderCircleIcon
                  aria-hidden
                  className="size-4 motion-safe:animate-spin"
                />
                Preparing your export…
              </span>
              <span className="text-muted-foreground">
                {range} · {department}
              </span>
              <span className="text-muted-foreground">
                This can take a minute. You can close this dialog; we’ll tell
                you when it’s ready.
              </span>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button autoFocus>Close</Button>
              </DialogClose>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ExportForm({
  departments,
  onStarted,
}: {
  departments: { id: string; name: string }[];
  onStarted: (started: Started) => void;
}) {
  const [from, setFrom] = useState(() =>
    day(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)),
  );
  const [to, setTo] = useState(() => day(new Date()));
  const [departmentId, setDepartmentId] = useState(ALL);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!from || !to || from > to) {
      return setError('Choose a start date on or before the end date.');
    }
    setError(null);
    setBusy(true);
    const department = departmentId === ALL ? null : departmentId;
    try {
      const answer = await ticketsControllerCreateExportV1({
        from,
        to,
        departmentId: department,
      });
      if (!answer.data) throw new Error('No export');
      onStarted({ id: answer.data.id, from, to, departmentId: department });
    } catch {
      toastError('The export failed', 'Something went wrong on our side.');
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
      <div className="grid grid-cols-2 gap-3">
        <Field id="export-from" label="From" error={error}>
          {(aria) => (
            <Input
              id="export-from"
              type="date"
              autoFocus
              value={from}
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
              onChange={(event) => setTo(event.target.value)}
              {...aria}
            />
          )}
        </Field>
      </div>
      <Field id="export-department" label="Department (optional)">
        {(aria) => (
          <Select value={departmentId} onValueChange={setDepartmentId}>
            <SelectTrigger id="export-department" className="w-full" {...aria}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value={ALL}>All departments</SelectItem>
              {departments.map((department) => (
                <SelectItem key={department.id} value={department.id}>
                  {department.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={busy}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={busy}>
          <FileDownIcon aria-hidden />
          Start export
        </Button>
      </DialogFooter>
    </form>
  );
}
