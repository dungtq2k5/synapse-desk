'use client';

import {
  platformControllerApplyPlanV1,
  usePlatformControllerGetPlanV1,
  type ApplyPlanResponseDto,
  type PlanSubscriberProjectionResponseDto,
} from '@synapsedesk/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CircleCheckIcon,
  InfoIcon,
  MinusIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { StatTiles } from '@/components/analytics/tiles';
import { Pagination } from '@/components/documents/parts';
import { ConfirmDialog } from '@/components/settings/confirm-dialog';
import { Status } from '@/components/settings/badges';
import { LoadError, Loading } from '@/components/settings/settings-frame';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { absoluteTime, andList } from '@/lib/format';
import {
  changeLines,
  count,
  overLimitLine,
  overLimitWarning,
  type OverLimitItem,
} from '@/lib/platform';
import { ConsolePage } from './console-page';
import { planRefusal } from './plan-form';

const PAGE_SIZE = 10;

const itemsOf = (row: PlanSubscriberProjectionResponseDto): OverLimitItem[] =>
  row.overLimitItems ?? [];

/**
 * Apply a plan's catalog row to its subscribers: the dry run first, what
 * changes for each, the ones it would put over a limit named right above the
 * button, then the apply and its result.
 */
export function PlanApply({ planId }: { planId: string }) {
  const plan = usePlatformControllerGetPlanV1(planId, {
    query: { retry: false },
  });
  // The dry run is a POST that changes nothing: read once, never refetched
  // behind the reader's back.
  const dryRun = useQuery({
    queryKey: ['platform-apply-preview', planId],
    queryFn: () => platformControllerApplyPlanV1(planId, { dryRun: true }),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const preview = dryRun.data?.data ?? null;
  const [applied, setApplied] = useState<{
    at: string;
    result: ApplyPlanResponseDto;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const name = plan.data?.data?.name ?? 'the plan';

  const crumbs = [
    { label: 'Plans', href: '/platform/plans' },
    { label: name, href: `/platform/plans/${planId}` },
    { label: 'Apply' },
  ];
  const shown = applied?.result ?? preview;
  if (!shown || !plan.data) {
    return (
      <ConsolePage crumbs={crumbs} title={`Apply ${name} to its subscribers`}>
        {dryRun.isError || plan.isError ? (
          <LoadError
            what="the preview"
            onRetry={() => {
              void plan.refetch();
              void dryRun.refetch();
            }}
          />
        ) : (
          <Loading what="the preview" className="h-96" />
        )}
      </ConsolePage>
    );
  }

  const rows = shown.subscribers.filter(
    (row) => row.skippedPinned || Object.keys(row.changes).length > 0,
  );
  const changing = rows.filter((row) => !row.skippedPinned);
  const over = changing.filter((row) => itemsOf(row).length > 0);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const meta = {
    currentPage: page,
    totalPages: Math.ceil(rows.length / PAGE_SIZE),
    totalItems: rows.length,
    itemsPerPage: PAGE_SIZE,
    itemCount: pageRows.length,
  };
  const subscribers =
    plan.data.data?.subscriberCount ?? shown.subscribers.length;
  const checked =
    shown.evaluatedDimensions.length >= 3
      ? 'Checked: seats, storage and documents.'
      : 'Checked: seats only; storage and documents couldn’t be read.';
  const warning = overLimitWarning(
    over.map((row) => ({ name: row.organizationName, items: itemsOf(row) })),
    name,
  );

  const apply = async () => {
    try {
      const answer = await platformControllerApplyPlanV1(planId, {
        dryRun: false,
      });
      if (answer.data) {
        setApplied({ at: new Date().toISOString(), result: answer.data });
        setPage(1);
      }
      void queryClient.invalidateQueries({
        queryKey: ['/api/v1/platform/organizations'],
      });
      void queryClient.invalidateQueries({
        queryKey: ['/api/v1/platform/audit-logs'],
      });
    } catch (error) {
      return planRefusal(error);
    }
  };

  return (
    <ConsolePage
      crumbs={crumbs}
      title={`Apply ${name} to its subscribers`}
      description={
        applied
          ? `Applied ${absoluteTime(applied.at)}.`
          : `Saving ${name} changed the catalog. Applying changes each subscriber’s limits to match.`
      }
    >
      {applied ? (
        <Alert variant="success" role="status">
          <CircleCheckIcon aria-hidden />
          <AlertTitle>{`${name} is applied`}</AlertTitle>
          <AlertDescription>
            {`${count(applied.result.changedCount, 'organization')} changed, ${applied.result.overLimitCount} of them now over a limit; ${applied.result.skippedPinnedCount} ${applied.result.skippedPinnedCount === 1 ? 'was' : 'were'} skipped because ${applied.result.skippedPinnedCount === 1 ? 'its terms are' : 'their terms are'} negotiated. Lower AI allowances start with each organization’s next cycle.`}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="info">
          <InfoIcon aria-hidden />
          <AlertTitle>Nothing has changed yet</AlertTitle>
          <AlertDescription>
            {`This is a preview of applying ${name}’s catalog row to its ${subscribers.toLocaleString('en-US')} subscribers. ${checked}`}
          </AlertDescription>
        </Alert>
      )}
      <StatTiles
        className="grid-cols-1 md:grid-cols-3 lg:grid-cols-3"
        tiles={[
          applied
            ? {
                label: 'Changed',
                value: String(applied.result.changedCount),
                counts: `Their limits now match ${name}`,
              }
            : {
                label: 'Will change',
                value: String(shown.changedCount),
                counts: `Their limits move to ${name}’s`,
              },
          {
            label: 'Over a limit',
            value: String(shown.overLimitCount),
            counts: applied
              ? `Changed, and using more than ${name} grants`
              : `Would use more than ${name} grants`,
          },
          {
            label: 'Skipped',
            value: String(shown.skippedPinnedCount),
            counts: 'Negotiated terms are never overwritten',
          },
        ]}
      />
      <div className="hidden overflow-hidden rounded-lg border md:block">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Organization</TableHead>
              <TableHead>What changes</TableHead>
              <TableHead>Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((row) => (
              <TableRow key={row.organizationId}>
                <TableCell>
                  <OrganizationLink row={row} />
                </TableCell>
                <TableCell className="whitespace-normal">
                  <Changes row={row} />
                </TableCell>
                <TableCell className="whitespace-normal">
                  <Result row={row} applied={Boolean(applied)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="flex flex-col gap-2 md:hidden">
        {pageRows.map((row) => (
          <li
            key={row.organizationId}
            className="flex flex-col gap-2 rounded-lg border bg-card p-4 text-sm"
          >
            <OrganizationLink row={row} />
            <Changes row={row} />
            <Result row={row} applied={Boolean(applied)} />
          </li>
        ))}
      </ul>
      {!applied && over.length > 0 && (
        <Alert variant="warning">
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>{warning.title}</AlertTitle>
          <AlertDescription>{warning.description}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {meta.totalPages > 1 ? (
          <Pagination meta={meta} onPage={setPage} noun="subscribers" stacked />
        ) : (
          <span />
        )}
        <div className="flex flex-wrap gap-2">
          {applied ? (
            <Link
              href={`/platform/plans/${planId}`}
              className={buttonVariants({ variant: 'outline' })}
            >
              {`Back to ${name}`}
            </Link>
          ) : (
            <>
              <Link
                href={`/platform/plans/${planId}`}
                className={buttonVariants({ variant: 'outline' })}
              >
                Cancel
              </Link>
              <Button
                disabled={shown.changedCount === 0}
                onClick={() => setConfirming(true)}
              >
                {`Apply ${name} to ${count(shown.changedCount, 'organization')}`}
              </Button>
            </>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Apply ${name} to ${count(shown.changedCount, 'organization')}?`}
        description="Their limits change now."
        confirmLabel={`Apply ${name} to ${count(shown.changedCount, 'organization')}`}
        destructive={false}
        onConfirm={apply}
      />
    </ConsolePage>
  );
}

function OrganizationLink({
  row,
}: {
  row: PlanSubscriberProjectionResponseDto;
}) {
  return (
    <Link
      href={`/platform/organizations/${row.organizationId}`}
      className="font-medium text-primary underline-offset-4 hover:underline"
    >
      {row.organizationName}
    </Link>
  );
}

function Changes({ row }: { row: PlanSubscriberProjectionResponseDto }) {
  if (row.skippedPinned) {
    return (
      <span className="text-muted-foreground">
        Nothing: its terms are negotiated
      </span>
    );
  }
  return (
    <span className="flex flex-col">
      {changeLines(row.changes, row.budgetDeferred).map((line) => (
        <span key={line}>{line}</span>
      ))}
    </span>
  );
}

function Result({
  row,
  applied,
}: {
  row: PlanSubscriberProjectionResponseDto;
  applied: boolean;
}) {
  if (row.skippedPinned) {
    return (
      <Status tone="muted" icon={MinusIcon}>
        Skipped: negotiated terms
      </Status>
    );
  }
  const items = itemsOf(row);
  if (items.length === 0) {
    return applied ? (
      <Status tone="success" icon={CircleCheckIcon}>
        Changed
      </Status>
    ) : (
      <Status tone="info" icon={CircleCheckIcon}>
        Will change
      </Status>
    );
  }
  return (
    <span className="flex flex-col items-start gap-1">
      <Status tone="warning" icon={TriangleAlertIcon}>
        {applied ? 'Changed, over a limit' : 'Will change, over a limit'}
      </Status>
      <span className="text-sm text-warning-subtle-foreground">
        {andList(items.map(overLimitLine))}
      </span>
    </span>
  );
}
