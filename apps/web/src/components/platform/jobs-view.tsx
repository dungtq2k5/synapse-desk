'use client';

import {
  platformJobsControllerBackfillV1,
  platformJobsControllerRunV1,
  usePlatformControllerListOrganizationsV1,
  usePlatformJobsControllerGetHealthV1,
  type JobRunStatusResponseDto,
} from '@synapsedesk/api-client';
import { useQueryClient } from '@tanstack/react-query';
import {
  HistoryIcon,
  PlayIcon,
  RotateCwIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/auth/field';
import {
  ConfirmDialog,
  type Refusal,
} from '@/components/settings/confirm-dialog';
import { LoadError, Loading } from '@/components/settings/settings-frame';
import { serverMessage } from '@/components/ticket/use-directory';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { addDays, duration, todayIso } from '@/lib/analytics';
import { absoluteTime } from '@/lib/format';
import {
  count,
  jobsOf,
  jobWords,
  parentOf,
  RUNNABLE_JOBS,
  serviceWords,
  type Health,
} from '@/lib/platform';
import { cn } from '@/lib/utils';
import { HealthBadge } from './badges';
import { ConsolePage } from './console-page';
import { ReasonField } from './fields';

type Row = {
  jobName: string;
  service: string;
  health: Health;
  status: JobRunStatusResponseDto | null;
  step: boolean;
};

/**
 * The jobs in the table's order: each job, its steps indented under it, then
 * the jobs of a service that didn't answer, read from the schedule and
 * marked "Not reached".
 */
export function jobRows(
  items: JobRunStatusResponseDto[],
  unavailable: string[],
): Row[] {
  const jobs = items.filter((item) => item.health !== 'step');
  const steps = items.filter((item) => item.health === 'step');
  const rows: Row[] = [];
  for (const job of jobs) {
    rows.push({
      jobName: job.jobName,
      service: job.service,
      health: job.health,
      status: job,
      step: false,
    });
    for (const step of steps.filter(
      (one) => parentOf(one.jobName) === job.jobName,
    )) {
      rows.push({
        jobName: step.jobName,
        service: step.service,
        health: 'step',
        status: step,
        step: true,
      });
    }
  }
  for (const step of steps.filter(
    (one) => !jobs.some((job) => job.jobName === parentOf(one.jobName)),
  )) {
    rows.push({
      jobName: step.jobName,
      service: step.service,
      health: 'step',
      status: step,
      step: true,
    });
  }
  for (const service of unavailable) {
    for (const name of jobsOf(service)) {
      rows.push({
        jobName: name,
        service,
        health: 'not-reached',
        status: null,
        step: false,
      });
    }
  }
  return rows;
}

/** The scheduled work: health, Run now and Backfill on the two daily rollups. */
export function JobsView() {
  const health = usePlatformJobsControllerGetHealthV1({
    query: { retry: false },
  });
  const [running, setRunning] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState<string | null>(null);
  const data = health.data?.data;

  return (
    <ConsolePage
      crumbs={[{ label: 'Jobs' }]}
      title="Jobs"
      description="The scheduled work behind analytics, usage and housekeeping, and whether it’s running."
    >
      {health.isError && !data ? (
        <LoadError what="jobs" onRetry={() => void health.refetch()} />
      ) : !data ? (
        <Loading what="jobs" className="h-96" />
      ) : (
        <>
          {data.unavailable.map((service) => (
            <Alert key={service} variant="warning" role="status">
              <TriangleAlertIcon aria-hidden />
              <AlertTitle>{`The ${serviceWords(service)} service didn’t answer`}</AlertTitle>
              <AlertDescription>
                <p>
                  {`Its jobs (${jobsOf(service).map(jobWords).join(', ')}) aren’t listed. The rest are up to date. Try again in a minute.`}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => void health.refetch()}
                >
                  <RotateCwIcon aria-hidden />
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          ))}
          {data.items.length === 0 && data.unavailable.length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs reported</p>
          ) : (
            <JobTable
              rows={jobRows(data.items, data.unavailable)}
              busy={health.isFetching}
              onRun={setRunning}
              onBackfill={setBackfilling}
            />
          )}
        </>
      )}
      <RunDialog
        job={running}
        onClose={() => setRunning(null)}
        onRan={() => void health.refetch()}
      />
      <BackfillDialog
        job={backfilling}
        onClose={() => setBackfilling(null)}
        onDone={() => void health.refetch()}
      />
    </ConsolePage>
  );
}

function JobTable({
  rows,
  busy,
  onRun,
  onBackfill,
}: {
  rows: Row[];
  busy: boolean;
  onRun: (job: string) => void;
  onBackfill: (job: string) => void;
}) {
  const actions = (row: Row) =>
    RUNNABLE_JOBS.includes(row.jobName) && row.status ? (
      <span className="flex flex-wrap gap-1">
        <Button
          variant="outline"
          size="xs"
          aria-label={`Run now: ${jobWords(row.jobName)}`}
          onClick={() => onRun(row.jobName)}
        >
          <PlayIcon aria-hidden />
          Run now
        </Button>
        <Button
          variant="ghost"
          size="xs"
          aria-label={`Backfill: ${jobWords(row.jobName)}`}
          onClick={() => onBackfill(row.jobName)}
        >
          <HistoryIcon aria-hidden />
          Backfill
        </Button>
      </span>
    ) : null;
  const name = (row: Row) => (
    <span className={cn('flex flex-col', row.step && 'pl-5')}>
      <span>{jobWords(row.jobName)}</span>
      <code className="font-mono text-xs text-muted-foreground">
        {row.jobName}
      </code>
    </span>
  );
  const lastError = (row: Row) =>
    row.status?.lastError ? (
      <span className="text-destructive">{row.status.lastError}</span>
    ) : (
      '—'
    );
  return (
    <>
      <div
        aria-busy={busy || undefined}
        className="hidden overflow-x-auto rounded-lg border md:block"
      >
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead>Service</TableHead>
              <TableHead>Health</TableHead>
              <TableHead>Last success</TableHead>
              <TableHead>Took</TableHead>
              <TableHead className="text-right">Failures in a row</TableHead>
              <TableHead>Last error</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={`${row.service}:${row.jobName}`}>
                <TableCell>{name(row)}</TableCell>
                <TableCell>{serviceWords(row.service)}</TableCell>
                <TableCell>
                  <HealthBadge health={row.health} />
                </TableCell>
                <TableCell>
                  {row.status?.lastSucceededAt ? (
                    <time dateTime={row.status.lastSucceededAt}>
                      {absoluteTime(row.status.lastSucceededAt)}
                    </time>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell>
                  {row.status?.lastDurationMs != null
                    ? duration(row.status.lastDurationMs / 1000)
                    : '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.status ? row.status.consecutiveFailures : '—'}
                </TableCell>
                <TableCell className="max-w-48 whitespace-normal break-words">
                  {lastError(row)}
                </TableCell>
                <TableCell>{actions(row)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="flex flex-col gap-2 md:hidden">
        {rows.map((row) => (
          <li
            key={`${row.service}:${row.jobName}`}
            className={cn(
              'flex flex-col gap-2 rounded-lg border bg-card p-4 text-sm',
              row.step && 'ml-4',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              {name(row)}
              <HealthBadge health={row.health} />
            </div>
            <p className="text-muted-foreground">
              {[
                serviceWords(row.service),
                row.status?.lastSucceededAt
                  ? `Last success ${absoluteTime(row.status.lastSucceededAt)}`
                  : null,
                row.status?.consecutiveFailures
                  ? `${count(row.status.consecutiveFailures, 'failure')} in a row`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {row.status?.lastError && (
              <p className="text-destructive">{row.status.lastError}</p>
            )}
            {actions(row)}
          </li>
        ))}
      </ul>
    </>
  );
}

const REASON_REQUIRED = 'A reason is required.';

/** Run a daily rollup now, for every organization, with a reason. */
function RunDialog({
  job,
  onClose,
  onRan,
}: {
  job: string | null;
  onClose: () => void;
  onRan: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const words = job ? jobWords(job) : '';

  const confirm = async (): Promise<Refusal | false | void> => {
    if (!job) return false;
    if (!reason.trim()) {
      setError(REASON_REQUIRED);
      document.getElementById('run-reason')?.focus();
      return false;
    }
    try {
      const answer = await platformJobsControllerRunV1(job, {
        reason: reason.trim(),
      });
      toast.success(`${words} ran`, {
        description: `${count(answer.data?.tenants ?? 0, 'organization')}, ${count(answer.data?.rows ?? 0, 'row')}.`,
      });
      setReason('');
      onRan();
      void queryClient.invalidateQueries({
        queryKey: ['/api/v1/platform/audit-logs'],
      });
    } catch (failed) {
      return {
        title: `Couldn’t run ${words}`,
        description: serverMessage(failed).replace(/!$/, '.'),
      };
    }
  };

  return (
    <ConfirmDialog
      open={job !== null}
      onOpenChange={(open) => {
        if (!open) {
          setReason('');
          setError(null);
          onClose();
        }
      }}
      title={`Run the ${words.toLowerCase().replace(/, (daily|hourly)$/, '')} now?`}
      description="It recomputes for every organization now, as the nightly run does."
      confirmLabel="Run now"
      icon={PlayIcon}
      destructive={false}
      onConfirm={confirm}
    >
      <ReasonField
        id="run-reason"
        value={reason}
        onChange={(value) => {
          setReason(value);
          if (value.trim()) setError(null);
        }}
        error={error}
        help="Required. Recorded in the audit log, with your name."
      />
    </ConfirmDialog>
  );
}

const ALL = 'all';

/** Backfill a range, optionally for one organization, with a reason. */
function BackfillDialog({
  job,
  onClose,
  onDone,
}: {
  job: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const today = todayIso();
  const [from, setFrom] = useState(addDays(today, -7));
  const [to, setTo] = useState(addDays(today, -1));
  const [organizationId, setOrganizationId] = useState(ALL);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ range?: string; reason?: string }>({});
  const queryClient = useQueryClient();
  const organizations = usePlatformControllerListOrganizationsV1(
    { limit: 100, sortBy: 'name', sortOrder: 'ASC' },
    { query: { enabled: job !== null } },
  );
  const words = job ? jobWords(job) : '';

  const confirm = async (): Promise<Refusal | false | void> => {
    if (!job) return false;
    const found = {
      range:
        from && to && from <= to
          ? undefined
          : 'The start must be on or before the end.',
      reason: reason.trim() ? undefined : REASON_REQUIRED,
    };
    setErrors(found);
    if (found.range) {
      document.getElementById('backfill-from')?.focus();
      return false;
    }
    if (found.reason) {
      document.getElementById('backfill-reason')?.focus();
      return false;
    }
    try {
      const answer = await platformJobsControllerBackfillV1(job, {
        from,
        to,
        reason: reason.trim(),
        organizationId: organizationId === ALL ? undefined : organizationId,
      });
      toast.success('Backfill complete', {
        description: `${count(answer.data?.tenants ?? 0, 'organization')}, ${count(answer.data?.rows ?? 0, 'row')}.`,
      });
      setReason('');
      onDone();
      void queryClient.invalidateQueries({
        queryKey: ['/api/v1/platform/audit-logs'],
      });
    } catch (failed) {
      return {
        title: `Couldn’t backfill the ${words.toLowerCase()}`,
        description: serverMessage(failed).replace(/!$/, '.'),
      };
    }
  };

  return (
    <ConfirmDialog
      open={job !== null}
      onOpenChange={(open) => {
        if (!open) {
          setReason('');
          setErrors({});
          onClose();
        }
      }}
      title={`Backfill the ${words.toLowerCase().replace(/, (daily|hourly)$/, '')}`}
      description={`Recomputes each day in the range from the source data. Existing numbers for those days are replaced.${job === 'ledger-daily' ? ' Only its AI usage rollup is redone.' : ''}`}
      confirmLabel="Backfill"
      icon={HistoryIcon}
      destructive={false}
      onConfirm={confirm}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field id="backfill-from" label="From" error={errors.range}>
          {(aria) => (
            <Input
              id="backfill-from"
              type="date"
              max={today}
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              {...aria}
            />
          )}
        </Field>
        <Field id="backfill-to" label="To">
          {(aria) => (
            <Input
              id="backfill-to"
              type="date"
              max={today}
              value={to}
              onChange={(event) => setTo(event.target.value)}
              {...aria}
            />
          )}
        </Field>
      </div>
      <Field
        id="backfill-organization"
        label="Organization"
        description="Optional. Leave it on All organizations to backfill everyone."
      >
        {(aria) => (
          <Select value={organizationId} onValueChange={setOrganizationId}>
            <SelectTrigger
              id="backfill-organization"
              className="w-full"
              {...aria}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="shadow-md">
              <SelectItem value={ALL}>All organizations</SelectItem>
              {(organizations.data?.data?.items ?? []).map((row) => (
                <SelectItem
                  key={row.organization.id}
                  value={row.organization.id}
                >
                  {row.organization.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      <ReasonField
        id="backfill-reason"
        value={reason}
        onChange={(value) => {
          setReason(value);
          if (value.trim())
            setErrors((current) => ({ ...current, reason: undefined }));
        }}
        error={errors.reason ?? null}
        help="Required. Recorded in the audit log, with your name."
      />
    </ConfirmDialog>
  );
}
