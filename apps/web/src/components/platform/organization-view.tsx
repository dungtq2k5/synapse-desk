'use client';

import {
  ApiError,
  usePlatformAuditLogsControllerListV1,
  usePlatformControllerGetOrganizationV1,
  type PlatformAuditLogResponseDto,
  type PlatformOrganizationDetailResponseDto,
} from '@synapsedesk/api-client';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronRightIcon,
  HardDriveIcon,
  PencilIcon,
  RotateCcwIcon,
  SparklesIcon,
  TriangleAlertIcon,
  UserSearchIcon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageUnavailable } from '@/components/shell/page-unavailable';
import { LoadError, Loading } from '@/components/settings/settings-frame';
import { UsageMeter } from '@/components/settings/usage-meter';
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
import { aiMoney } from '@/lib/billing';
import { absoluteTime, dayDate, fileSize } from '@/lib/format';
import {
  consequence,
  consoleStatus,
  organizationAct,
  reasonOf,
  STATUS_WORDS,
  type ConsoleStatus,
} from '@/lib/platform';
import { cn } from '@/lib/utils';
import { ConsoleStatusBadge } from './badges';
import { ConsoleCard, ConsolePage, Facts } from './console-page';
import {
  OffboardDialog,
  ResetCycleDialog,
  RestoreDialog,
  StatusDialog,
} from './organization-dialogs';

type Dialog = 'status' | 'reset' | 'offboard' | 'restore' | null;

const linkClass =
  'inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline';

/**
 * One organization, as the platform sees it: its status and what that does,
 * profile, plan and limits, usage, people, the platform's own recent acts on
 * it, and break glass. Offboarded, it says when and why, with Restore.
 */
export function OrganizationView({
  organizationId,
}: {
  organizationId: string;
}) {
  const detail = usePlatformControllerGetOrganizationV1(organizationId, {
    query: { retry: false },
  });
  const acts = usePlatformAuditLogsControllerListV1(
    {
      resourceType: 'ORGANIZATION',
      resourceId: organizationId,
      limit: 5,
      sortOrder: 'DESC',
    },
    { query: { retry: false } },
  );
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const crumbs = [{ label: 'Organizations', href: '/platform/organizations' }];

  const data = detail.data?.data;
  if (detail.error instanceof ApiError && detail.error.status === 404) {
    return (
      <ConsolePage crumbs={crumbs} title="Organization">
        <PageUnavailable
          back={{ href: '/platform/organizations', label: 'Organizations' }}
        />
      </ConsolePage>
    );
  }
  if (!data) {
    return (
      <ConsolePage crumbs={crumbs} title="Organization">
        {detail.isError ? (
          <LoadError
            what="the organization"
            onRetry={() => void detail.refetch()}
          />
        ) : (
          <Loading what="the organization" className="h-96" />
        )}
      </ConsolePage>
    );
  }

  const organization = data.organization;
  const status = consoleStatus(organization.status, data.deletedAt);
  const offboarded = status === 'OFFBOARDED';
  const subject = {
    id: organization.id,
    name: organization.name,
    people: data.userCount,
  };
  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: [`/api/v1/platform/organizations/${organizationId}`],
    });
    void queryClient.invalidateQueries({
      queryKey: ['/api/v1/platform/organizations'],
    });
    void queryClient.invalidateQueries({
      queryKey: ['/api/v1/platform/audit-logs'],
    });
  };
  const close = () => setDialog(null);
  const findPeople = `/platform/people?organizationId=${organization.id}`;
  const offboarding = (acts.data?.data?.items ?? []).find(
    (entry) => entry.action === 'PLATFORM_ORGANIZATION_OFFBOARDED',
  );

  return (
    <ConsolePage
      crumbs={[...crumbs, { label: organization.name }]}
      title={organization.name}
      badge={<ConsoleStatusBadge status={status} />}
      description={[
        organization.slug,
        data.planName,
        `Created ${dayDate(organization.createdAt)}`,
      ]
        .filter(Boolean)
        .join(' · ')}
      actions={
        offboarded ? (
          <Button onClick={() => setDialog('restore')}>
            <RotateCcwIcon aria-hidden />
            Restore
          </Button>
        ) : (
          <>
            <Link
              href={findPeople}
              className={buttonVariants({ variant: 'outline' })}
            >
              <UserSearchIcon aria-hidden />
              Find its people
            </Link>
            <Link
              href={`/platform/organizations/${organization.id}/edit`}
              className={buttonVariants({ variant: 'outline' })}
            >
              <PencilIcon aria-hidden />
              Edit
            </Link>
            <Button variant="outline" onClick={() => setDialog('status')}>
              Change status
            </Button>
          </>
        )
      }
    >
      {offboarded && data.deletedAt && (
        <Alert variant="warning">
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>
            {`${organization.name} was offboarded on ${dayDate(data.deletedAt)}`}
          </AlertTitle>
          <AlertDescription>
            <p>
              {offboarding
                ? `By ${offboarding.actorName ?? 'a Super Admin'}: “${reasonOf(offboarding.metadata) ?? '—'}” `
                : ''}
              Nobody can sign in. Restore brings it back as it was; nobody’s
              sessions come back.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => setDialog('restore')}
            >
              <RotateCcwIcon aria-hidden />
              Restore
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <ConsoleCard
        title="Status"
        lead={
          offboarded
            ? undefined
            : 'Each status says what it does to the organization’s people.'
        }
      >
        <p className="flex flex-wrap items-center gap-3 text-sm">
          <ConsoleStatusBadge status={status} />
          <span>{statusLine(status, data.statusChangedAt)}</span>
        </p>
      </ConsoleCard>
      <div className="grid gap-6 lg:grid-cols-2">
        <ConsoleCard title="Profile">
          <Facts
            rows={[
              ['Address', organization.slug],
              ['Domain', organization.domain ?? '—'],
              [
                'Allowed email domains',
                organization.allowedEmailDomains.length
                  ? organization.allowedEmailDomains.join(', ')
                  : '—',
              ],
              ['Created', dayDate(organization.createdAt)],
            ]}
          />
        </ConsoleCard>
        <PlanAndLimits data={data} offboarded={offboarded} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Usage data={data} onRetry={() => void detail.refetch()} />
        <ConsoleCard title="People and teams">
          <Facts
            rows={[
              [
                'People',
                <span key="people" className="flex flex-wrap gap-x-3">
                  {data.userCount.toLocaleString('en-US')}
                  {!offboarded && (
                    <Link href={findPeople} className={linkClass}>
                      Find its people
                      <ChevronRightIcon aria-hidden className="size-4" />
                    </Link>
                  )}
                </span>,
              ],
              [
                'Pending invitations',
                data.pendingInvitationCount.toLocaleString('en-US'),
              ],
              ['Departments', data.departmentCount.toLocaleString('en-US')],
            ]}
          />
          <p className="text-sm text-muted-foreground">
            Acting on a person happens in their organization; here you can only
            find them.
          </p>
        </ConsoleCard>
      </div>
      <PlatformActions
        organizationId={organization.id}
        entries={acts.data?.data?.items}
        failed={acts.isError}
        onRetry={() => void acts.refetch()}
      />
      {!offboarded && (
        <BreakGlass
          people={data.userCount}
          onReset={() => setDialog('reset')}
          onOffboard={() => setDialog('offboard')}
        />
      )}
      <StatusDialog
        key={`status-${status}`}
        organization={subject}
        status={status}
        open={dialog === 'status'}
        onOpenChange={(open) => setDialog(open ? 'status' : null)}
        onChanged={refresh}
      />
      <ResetCycleDialog
        organization={subject}
        allowance={aiMoney(organization.monthlyAiTokenBudget, 'en-US')}
        open={dialog === 'reset'}
        onOpenChange={(open) => setDialog(open ? 'reset' : null)}
        onReset={() => {
          close();
          refresh();
        }}
      />
      <OffboardDialog
        organization={subject}
        open={dialog === 'offboard'}
        onOpenChange={(open) => setDialog(open ? 'offboard' : null)}
        onOffboarded={() => {
          close();
          refresh();
        }}
      />
      <RestoreDialog
        organization={subject}
        open={dialog === 'restore'}
        onOpenChange={(open) => setDialog(open ? 'restore' : null)}
        onRestored={() => {
          close();
          refresh();
        }}
      />
    </ConsolePage>
  );
}

/**
 * What the status does, then since when: past due says it in its own
 * sentence; the others add "{Status} since {date}." when it's known.
 *
 * @example statusLine('FROZEN', '2026-10-20T13:45:00Z') // 'Its people are … Active again. Frozen since 20 Oct 2026.'
 */
export function statusLine(
  status: ConsoleStatus,
  since: string | null | undefined,
): string {
  if (status === 'SUSPENDED_PAST_DUE') return consequence(status, since);
  const words = consequence(status);
  if (!since || status === 'OFFBOARDED') return words;
  return `${words} ${STATUS_WORDS[status]} since ${dayDate(since)}.`;
}

function PlanAndLimits({
  data,
  offboarded,
}: {
  data: PlatformOrganizationDetailResponseDto;
  offboarded: boolean;
}) {
  const organization = data.organization;
  const plan = data.planName
    ? `${data.planName} (${data.billedThroughStripe ? 'Stripe' : 'assigned'})`
    : 'Free (assigned)';
  return (
    <ConsoleCard title="Plan and limits">
      <Facts
        rows={[
          ['Plan', plan],
          ['Seats', organization.maxAgentSeats.toLocaleString('en-US')],
          ['Document storage', fileSize(organization.maxStorageBytes)],
          [
            'AI allowance',
            `${aiMoney(organization.monthlyAiTokenBudget, 'en-US')} a month`,
          ],
          ['Analytics ranges', `up to ${organization.analyticsRangeDays} days`],
          ['Billing cycle started', dayDate(organization.billingCycleStart)],
        ]}
      />
      {data.billedThroughStripe && (
        <p className="flex items-start gap-2 text-sm text-warning-subtle-foreground">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          Stripe sets these. A change here lasts until its next Stripe event.
        </p>
      )}
      {!offboarded && (
        <Link
          href={`/platform/organizations/${organization.id}/edit#limits`}
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'sm' }),
            'self-start md:self-end',
          )}
        >
          <PencilIcon aria-hidden />
          Edit limits
        </Link>
      )}
    </ConsoleCard>
  );
}

/** Its meters this billing period, the same its admins see. Seats aren't people. */
function Usage({
  data,
  onRetry,
}: {
  data: PlatformOrganizationDetailResponseDto;
  onRetry: () => void;
}) {
  const near = (_used: number, _limit: number, level: string) =>
    level === 'full'
      ? 'At the limit.'
      : level === 'near'
        ? 'Near the limit.'
        : null;
  return (
    <ConsoleCard
      title="Usage"
      lead="This billing period. The same meters its admins see."
    >
      <UsageMeter
        icon={UsersIcon}
        label="Seats"
        noun="seat"
        meter={data.usage.seats}
        amount={(used, limit) => `${used} of ${limit}`}
        note={near}
        onRetry={onRetry}
      />
      <UsageMeter
        icon={HardDriveIcon}
        label="Document storage"
        noun="storage"
        meter={data.usage.storage}
        amount={(used, limit) => `${fileSize(used)} of ${fileSize(limit)}`}
        note={near}
        onRetry={onRetry}
      />
      <UsageMeter
        icon={SparklesIcon}
        label="AI allowance"
        noun="AI"
        meter={data.usage.aiTokens}
        amount={(used, limit) =>
          `${limit > 0 ? Math.round((used / limit) * 100) : 100}% used`
        }
        note={near}
        onRetry={onRetry}
      />
    </ConsoleCard>
  );
}

/** The platform's recent acts on it, by resource; its own log stays its own. */
function PlatformActions({
  organizationId,
  entries,
  failed,
  onRetry,
}: {
  organizationId: string;
  entries: PlatformAuditLogResponseDto[] | undefined;
  failed: boolean;
  onRetry: () => void;
}) {
  const more = (
    <Link
      href={`/platform/audit-log?resourceType=ORGANIZATION&resourceId=${organizationId}`}
      className={cn(linkClass, 'text-sm')}
    >
      Open in the platform audit log
      <ChevronRightIcon aria-hidden className="size-4" />
    </Link>
  );
  return (
    <ConsoleCard
      title="Platform actions on it"
      lead="Changes made from this console: status, edits, cycle resets, offboarding. Its own audit log stays its own."
    >
      {failed ? (
        <LoadError what="the platform’s actions" onRetry={onRetry} />
      ) : !entries ? (
        <Loading what="the platform’s actions" className="h-40" />
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing in the audit log yet
        </p>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <When at={entry.createdAt} />
                    </TableCell>
                    <TableCell>{entry.actorName ?? '—'}</TableCell>
                    <TableCell className="whitespace-normal">
                      {organizationAct(entry.action, entry.metadata)}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {reasonOf(entry.metadata) ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-col gap-1 rounded-lg border p-3 text-sm"
              >
                <span className="font-medium">
                  {organizationAct(entry.action, entry.metadata)}
                </span>
                {reasonOf(entry.metadata) && (
                  <span className="text-muted-foreground">
                    “{reasonOf(entry.metadata)}”
                  </span>
                )}
                <span className="text-muted-foreground">
                  {entry.actorName ?? '—'} · <When at={entry.createdAt} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {more}
    </ConsoleCard>
  );
}

/** The two actions that reach every person in it, each with a reason. */
function BreakGlass({
  people,
  onReset,
  onOffboard,
}: {
  people: number;
  onReset: () => void;
  onOffboard: () => void;
}) {
  return (
    <section
      aria-labelledby="break-glass"
      className="flex flex-col gap-4 rounded-xl border border-destructive-border bg-card p-5 text-card-foreground"
    >
      <div className="flex flex-col gap-1">
        <h2 id="break-glass" className="font-semibold text-destructive">
          Break glass
        </h2>
        <p className="text-sm text-muted-foreground">
          Actions that reach every person in it. Each asks for a reason,
          recorded in the audit log.
        </p>
      </div>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Reset the billing cycle</span>
          <span className="text-muted-foreground">
            Starts a fresh AI allowance today. The cycle stops matching Stripe’s
            invoice period until Stripe’s next event.
          </span>
        </div>
        <Button variant="outline" className="w-fit shrink-0" onClick={onReset}>
          Reset the cycle
        </Button>
      </div>
      <div className="border-t" />
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Offboard the organization</span>
          <span className="text-muted-foreground">
            {`Signs out its ${people.toLocaleString('en-US')} people and closes it. Its data is kept, so it can be restored.`}
          </span>
        </div>
        <Button
          variant="destructive-outline"
          className="w-fit shrink-0"
          onClick={onOffboard}
        >
          Offboard
        </Button>
      </div>
    </section>
  );
}

/** A moment in full, in a `time` element; nothing when it's unknown. */
export function When({ at }: { at: string | null | undefined }) {
  return at ? <time dateTime={at}>{absoluteTime(at)}</time> : <>—</>;
}
