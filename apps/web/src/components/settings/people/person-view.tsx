'use client';

import {
  ApiError,
  userAdminControllerRemoveV1,
  userAdminControllerResetTwoFactorV1,
  userAdminControllerRestoreV1,
  userAdminControllerUnlockV1,
  userAdminControllerUpdateV1,
  userSessionsControllerRevokeV1,
  useAuditLogsControllerListV1,
  useOrganizationsControllerGetUsageV1,
  useUserAdminControllerGetPermissionsV1,
  useUserAdminControllerGetV1,
  useUserSessionsControllerListV1,
  UpdateUserDtoGender,
  type UserSummaryResponseDto,
} from '@synapsedesk/api-client';
import {
  CheckIcon,
  LockIcon,
  LockOpenIcon,
  LogOutIcon,
  NetworkIcon,
  PencilIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  ShieldIcon,
  ShieldOffIcon,
  Trash2Icon,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/auth/field';
import { SectionCard } from '@/components/account/section-card';
import { DeviceIcon, sessionName } from '@/components/account/sessions-section';
import { useDepartmentNames } from '@/components/documents/parts';
import { usePeople } from '@/components/ticket/use-directory';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useViewer } from '@/hooks/use-viewer';
import {
  PERMISSION_GROUPS,
  PERMISSION_WORDS,
  permissionWords,
} from '@/lib/administration';
import {
  andList,
  calendarDate,
  clockTime,
  dayDate,
  isoDate,
  relativeTime,
  usDate,
} from '@/lib/format';
import { toastError } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { PersonStatus, PrimaryBadge, TwoStep } from '../badges';
import { ConfirmDialog, RefusalAlert, type Refusal } from '../confirm-dialog';
import { SettingsFrame, SettingsUnavailable } from '../settings-frame';
import {
  EditDepartmentsDialog,
  EditRolesDialog,
  isLastAdmin,
  lastAdminRefusal,
  LockDialog,
  refusalText,
  serverRefusal,
} from './person-dialogs';
import { useMemberships, usePeopleCache, useRoles } from './shared';

const GENDERS = [
  ['', 'Not given'],
  [UpdateUserDtoGender.FEMALE, 'Female'],
  [UpdateUserDtoGender.MALE, 'Male'],
  [UpdateUserDtoGender.OTHER, 'Other'],
] as const;

const NOT_GIVEN = 'none';

/**
 * Settings › People › {name}: details, roles and departments, what they can
 * do, security, sessions, and delete or restore, each by its permission. No
 * Lock, Delete or Sign out everywhere on your own page.
 */
export function PersonView({ userId }: { userId: string }) {
  const { can, query: viewerQuery } = useViewer();
  const person = useUserAdminControllerGetV1(userId, {
    query: { enabled: can('user.read'), retry: false },
  });
  const summary = person.data?.data;

  if ((viewerQuery.isSuccess && !can('user.read')) || person.isError) {
    return (
      <SettingsFrame crumbs={[{ label: 'People', href: '/settings/people' }]}>
        <SettingsUnavailable />
      </SettingsFrame>
    );
  }

  return (
    <SettingsFrame
      crumbs={[
        { label: 'People', href: '/settings/people' },
        ...(summary ? [{ label: summary.user.fullName }] : []),
      ]}
    >
      {summary ? (
        <Person summary={summary} />
      ) : (
        <div className="flex max-w-2xl flex-col gap-6">
          <Skeleton className="h-12 w-60" />
          <Skeleton className="h-80 w-full" />
        </div>
      )}
    </SettingsFrame>
  );
}

function Person({ summary }: { summary: UserSummaryResponseDto }) {
  const { can, user: viewer } = useViewer();
  const refresh = usePeopleCache();
  const { user } = summary;
  const own = viewer?.id === user.id;
  const deleted = summary.deletedAt !== null;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight break-words">
            {user.fullName}
          </h1>
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </div>
        <div className="flex gap-2">
          <PersonStatus
            deleted={deleted}
            locked={user.isLocked}
            lockedUntil={
              user.lockedUntil ? calendarDate(user.lockedUntil) : null
            }
          />
          <TwoStep on={user.isTwoFactorEnabled} />
        </div>
      </div>
      {deleted && <DeletedBanner summary={summary} onDone={refresh} />}
      <div className="flex flex-col gap-6">
        <Details summary={summary} />
        <RolesAndDepartments summary={summary} />
        <WhatTheyCanDo summary={summary} />
        <Security summary={summary} own={own} />
        {!deleted && can('user.session.read') && (
          <Sessions summary={summary} own={own} />
        )}
        {!deleted && !own && can('user.delete') && (
          <DeleteCard summary={summary} />
        )}
      </div>
    </>
  );
}

function DeletedBanner({
  summary,
  onDone,
}: {
  summary: UserSummaryResponseDto;
  onDone: () => Promise<unknown>;
}) {
  const { can } = useViewer();
  const usage = useOrganizationsControllerGetUsageV1({
    query: { enabled: can('organization.read') },
  });
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState(false);
  const { user } = summary;
  const seats = usage.data?.data?.seats.limit;

  const restore = async () => {
    setBusy(true);
    setRefusal(null);
    try {
      await userAdminControllerRestoreV1(user.id);
      toast.success(`${user.fullName} restored.`);
      await onDone();
    } catch (error) {
      setRefusal(
        error instanceof ApiError && error.status === 402
          ? {
              title: `No free seat to restore ${user.fullName}`,
              description: (
                <>
                  {seats ? `All ${seats} seats are taken. ` : ''}Revoke a
                  pending invitation or change the plan, then restore.{' '}
                  {can('organization.update') ? (
                    <Link
                      href="/settings/billing"
                      className="font-medium underline underline-offset-4"
                    >
                      Plans and billing
                    </Link>
                  ) : (
                    'Ask an administrator to change the plan.'
                  )}
                </>
              ),
            }
          : serverRefusal('Couldn’t restore them', error),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <Alert className="bg-muted">
        <Trash2Icon aria-hidden />
        <AlertTitle>
          {user.fullName} was deleted on {dayDate(summary.deletedAt!)}
          {summary.deletedByName ? ` by ${summary.deletedByName}` : ''}
        </AlertTitle>
        <AlertDescription>
          They can’t sign in, and they don’t hold a seat. Restoring brings their
          account back as it was.
          {can('user.delete') && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2 text-foreground"
              disabled={busy}
              onClick={() => void restore()}
            >
              <RotateCcwIcon aria-hidden />
              Restore
            </Button>
          )}
        </AlertDescription>
      </Alert>
      {refusal && <RefusalAlert refusal={refusal} />}
    </div>
  );
}

function Details({ summary }: { summary: UserSummaryResponseDto }) {
  const { can } = useViewer();
  const refresh = usePeopleCache();
  const { user } = summary;
  const editable = can('user.update') && summary.deletedAt === null;
  const saved = {
    fullName: user.fullName,
    phoneNumber: user.phoneNumber ?? '',
    dob: user.dob ? usDate(user.dob) : '',
    gender: user.gender === 'UNSPECIFIED' ? '' : (user.gender ?? ''),
  };
  const [draft, setDraft] = useState(saved);
  const [dobError, setDobError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const changed = (Object.keys(saved) as (keyof typeof saved)[]).some(
    (key) => draft[key] !== saved[key],
  );

  if (!editable) {
    const genderWords =
      GENDERS.find(([value]) => value === saved.gender)?.[1] ?? 'Not given';
    return (
      <SectionCard title="Details" lead="What their profile says.">
        <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Full name</dt>
          <dd>{user.fullName}</dd>
          <dt className="text-muted-foreground">Email</dt>
          <dd className="break-all">{user.email}</dd>
          <dt className="text-muted-foreground">Phone number</dt>
          <dd>{user.phoneNumber ?? '—'}</dd>
          <dt className="text-muted-foreground">Date of birth</dt>
          <dd>{saved.dob || '—'}</dd>
          <dt className="text-muted-foreground">Gender</dt>
          <dd>{genderWords}</dd>
          <dt className="text-muted-foreground">Member since</dt>
          <dd>{dayDate(user.createdAt)}</dd>
        </dl>
      </SectionCard>
    );
  }

  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const dob = draft.dob.trim() ? isoDate(draft.dob) : null;
    if (draft.dob.trim() && !dob) {
      setDobError('Enter a date like 03/14/1990.');
      return;
    }
    setDobError(null);
    setBusy(true);
    try {
      await userAdminControllerUpdateV1(user.id, {
        fullName: draft.fullName.trim(),
        phoneNumber: draft.phoneNumber.trim() || null,
        dob,
        gender: draft.gender
          ? (draft.gender as UpdateUserDtoGender)
          : UpdateUserDtoGender.UNSPECIFIED,
      });
      await refresh();
    } catch (error) {
      toastError('Couldn’t save their details', refusalText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard title="Details" lead="What their profile says.">
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => void save(event)}
        noValidate
      >
        <Field id="person-name" label="Full name">
          {(aria) => (
            <Input
              id="person-name"
              value={draft.fullName}
              maxLength={150}
              onChange={(event) =>
                setDraft({ ...draft, fullName: event.target.value })
              }
              {...aria}
            />
          )}
        </Field>
        <Field
          id="person-email"
          label="Email"
          description="People change their own email address."
        >
          {(aria) => (
            <div className="relative">
              <Input
                id="person-email"
                value={user.email}
                readOnly
                className="bg-muted pr-9"
                {...aria}
              />
              <LockIcon
                aria-hidden
                className="absolute top-2.5 right-3 size-4 text-muted-foreground"
              />
            </div>
          )}
        </Field>
        <Field id="person-phone" label="Phone number">
          {(aria) => (
            <Input
              id="person-phone"
              type="tel"
              value={draft.phoneNumber}
              onChange={(event) =>
                setDraft({ ...draft, phoneNumber: event.target.value })
              }
              {...aria}
            />
          )}
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="person-dob" label="Date of birth" error={dobError}>
            {(aria) => (
              <Input
                id="person-dob"
                inputMode="numeric"
                placeholder="MM/DD/YYYY"
                value={draft.dob}
                onChange={(event) =>
                  setDraft({ ...draft, dob: event.target.value })
                }
                {...aria}
              />
            )}
          </Field>
          <div className="flex flex-col gap-2">
            <Label htmlFor="person-gender">Gender</Label>
            <Select
              value={draft.gender || NOT_GIVEN}
              onValueChange={(gender) =>
                setDraft({
                  ...draft,
                  gender: gender === NOT_GIVEN ? '' : gender,
                })
              }
            >
              <SelectTrigger id="person-gender" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GENDERS.map(([value, label]) => (
                  <SelectItem key={label} value={value || NOT_GIVEN}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={!changed || busy || draft.fullName.trim().length < 2}
          >
            Save changes
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

function RolesAndDepartments({ summary }: { summary: UserSummaryResponseDto }) {
  const { can } = useViewer();
  const refresh = usePeopleCache();
  const departments = useDepartmentNames();
  const { names: roleNames } = useRoles();
  const memberships = useMemberships(summary.user, summary.departmentIds);
  const [editing, setEditing] = useState<'roles' | 'departments' | null>(null);
  const active = summary.deletedAt === null;
  const person = { id: summary.user.id, fullName: summary.user.fullName };

  return (
    <SectionCard
      title="Roles and departments"
      lead="Their roles decide what they can do; departments group them."
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">Roles</h3>
          {active && can('user.role.assign') && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing('roles')}
            >
              <PencilIcon aria-hidden />
              Edit roles
            </Button>
          )}
        </div>
        <ul className="flex flex-wrap gap-1.5">
          {summary.roleIds.map((roleId, index) => (
            <li
              key={roleId}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium"
            >
              <ShieldIcon aria-hidden className="size-3" />
              {roleNames.get(roleId) ?? summary.roleNames[index] ?? roleId}
            </li>
          ))}
        </ul>
      </div>
      <Separator />
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">Departments</h3>
          {active && can('department.member.assign') && memberships && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing('departments')}
            >
              <PencilIcon aria-hidden />
              Edit departments
            </Button>
          )}
        </div>
        <ul className="flex flex-col gap-2 text-sm">
          {summary.departmentIds.map((departmentId) => (
            <li key={departmentId} className="flex items-center gap-2">
              <NetworkIcon
                aria-hidden
                className="size-4 text-muted-foreground"
              />
              {departments.get(departmentId) ?? 'Unknown department'}
              {memberships?.find((each) => each.departmentId === departmentId)
                ?.isPrimary && <PrimaryBadge />}
            </li>
          ))}
        </ul>
      </div>
      <EditRolesDialog
        person={person}
        roleIds={summary.roleIds}
        open={editing === 'roles'}
        onOpenChange={(open) => setEditing(open ? 'roles' : null)}
        onDone={() => void refresh()}
      />
      {memberships && (
        <EditDepartmentsDialog
          person={person}
          memberships={memberships}
          open={editing === 'departments'}
          onOpenChange={(open) => setEditing(open ? 'departments' : null)}
          onDone={() => void refresh()}
        />
      )}
    </SectionCard>
  );
}

function WhatTheyCanDo({ summary }: { summary: UserSummaryResponseDto }) {
  const permissions = useUserAdminControllerGetPermissionsV1(summary.user.id);
  const codes = permissions.data?.data?.permissionCodes;
  const groups = useMemo(
    () =>
      PERMISSION_GROUPS.map((group) => ({
        group,
        codes: (codes ?? []).filter(
          (code) =>
            PERMISSION_WORDS[code as keyof typeof PERMISSION_WORDS]?.group ===
            group,
        ),
      })).filter((entry) => entry.codes.length > 0),
    [codes],
  );

  return (
    <SectionCard
      title="What they can do"
      lead={`From their roles: ${andList(summary.roleNames)}.`}
    >
      {codes ? (
        <div className="flex flex-col gap-4">
          {groups.map(({ group, codes: inGroup }) => (
            <div key={group} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">
                {group} · {inGroup.length}
              </h3>
              <ul className="flex flex-wrap gap-1.5">
                {inGroup.map((code) => (
                  <li
                    key={code}
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium"
                  >
                    <CheckIcon aria-hidden className="size-3" />
                    {permissionWords(code)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <Skeleton className="h-24 w-full" />
      )}
    </SectionCard>
  );
}

/** The latest lock's reason and who set it, from the audit log. */
function useLastLock(userId: string, locked: boolean) {
  const { can } = useViewer();
  const { names } = usePeople();
  const log = useAuditLogsControllerListV1(
    {
      action: 'USER_LOCKED',
      resourceId: userId,
      sortOrder: 'DESC',
      limit: 1,
    },
    { query: { enabled: locked && can('audit.read') } },
  );
  const entry = log.data?.data?.items[0];
  if (!entry) return null;
  const reason = (entry.metadata as { reason?: unknown } | null)?.reason;
  return {
    reason: typeof reason === 'string' ? reason : null,
    by: entry.userId ? (names.get(entry.userId) ?? null) : null,
    on: dayDate(entry.createdAt),
  };
}

function Security({
  summary,
  own,
}: {
  summary: UserSummaryResponseDto;
  own: boolean;
}) {
  const { can } = useViewer();
  const refresh = usePeopleCache();
  const { user } = summary;
  const deleted = summary.deletedAt !== null;
  const lastLock = useLastLock(user.id, user.isLocked);
  const [dialog, setDialog] = useState<'lock' | 'reset' | null>(null);
  const [busy, setBusy] = useState(false);

  const unlock = async () => {
    setBusy(true);
    try {
      await userAdminControllerUnlockV1(user.id);
      toast.success(`${user.fullName} unlocked. They can sign in again.`);
      await refresh();
    } catch (error) {
      toastError('Couldn’t unlock them', refusalText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard title="Security">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          {user.isTwoFactorEnabled ? (
            <ShieldCheckIcon aria-hidden className="size-4" />
          ) : (
            <ShieldOffIcon aria-hidden className="size-4" />
          )}
          {user.isTwoFactorEnabled
            ? 'Two-step verification is on'
            : 'Two-step verification is off'}
        </p>
        {!deleted && user.isTwoFactorEnabled && can('user.2fa.reset') && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDialog('reset')}
          >
            Reset two-step
          </Button>
        )}
      </div>
      <Separator />
      {deleted ? (
        <p className="flex items-center gap-2 text-sm font-medium">
          <LockIcon aria-hidden className="size-4" />
          Can’t sign in while deleted
        </p>
      ) : user.isLocked ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <LockIcon aria-hidden className="size-4" />
              {user.lockedUntil
                ? `Locked until ${calendarDate(user.lockedUntil)}, ${clockTime(user.lockedUntil)}`
                : 'Locked until someone unlocks them'}
            </p>
            {can('user.lock') && !own && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void unlock()}
              >
                <LockOpenIcon aria-hidden />
                Unlock
              </Button>
            )}
          </div>
          {lastLock?.reason && (
            <p className="text-sm text-muted-foreground">
              Reason: “{lastLock.reason}”
              {lastLock.by
                ? ` Locked by ${lastLock.by} on ${lastLock.on}.`
                : ''}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <LockOpenIcon aria-hidden className="size-4" />
            Can sign in
          </p>
          {can('user.lock') && !own && (
            <Button
              variant="destructive-outline"
              size="sm"

              onClick={() => setDialog('lock')}
            >
              <LockIcon aria-hidden />
              Lock
            </Button>
          )}
        </div>
      )}
      {own && (
        <p className="text-sm text-muted-foreground">
          You can’t lock or delete your own account.
        </p>
      )}
      <LockDialog
        person={user}
        open={dialog === 'lock'}
        onOpenChange={(open) => setDialog(open ? 'lock' : null)}
        onDone={() => void refresh()}
      />
      <ConfirmDialog
        open={dialog === 'reset'}
        onOpenChange={(open) => setDialog(open ? 'reset' : null)}
        title={`Reset ${user.fullName}’s two-step verification?`}
        description="Their authenticator app and backup codes stop working at once. They sign in with their password and can set two-step up again."
        confirmLabel="Reset two-step"
        onConfirm={async () => {
          try {
            await userAdminControllerResetTwoFactorV1(user.id);
            await refresh();
          } catch (error) {
            return serverRefusal('Couldn’t reset it', error);
          }
        }}
      />
    </SectionCard>
  );
}

function Sessions({
  summary,
  own,
}: {
  summary: UserSummaryResponseDto;
  own: boolean;
}) {
  const { can } = useViewer();
  const { user } = summary;
  const sessions = useUserSessionsControllerListV1(user.id);
  const list = sessions.data?.data ?? [];
  const [confirming, setConfirming] = useState(false);
  // Read once: the days left only need to be right to the day.
  const [now] = useState(() => Date.now());
  const count = list.length;

  return (
    <section aria-labelledby="sessions-heading" className="max-w-2xl">
      <div className="flex flex-col gap-5 rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="sessions-heading" className="text-base font-semibold">
              Sessions
            </h2>
            {count > 0 && (
              <p className="text-sm text-muted-foreground">
                {count === 1
                  ? '1 device signed in.'
                  : `${count} devices signed in.`}
              </p>
            )}
          </div>
          {!own && count > 0 && can('user.session.revoke') && (
            <Button
              variant="destructive-outline"
              size="sm"

              onClick={() => setConfirming(true)}
            >
              <LogOutIcon aria-hidden />
              <span className="hidden sm:inline">Sign out everywhere</span>
              <span className="sm:hidden">Sign out all</span>
            </Button>
          )}
        </header>
        {sessions.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : count === 0 ? (
          <p className="text-sm text-muted-foreground">No active sessions.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {list.map((session) => {
              const days = Math.max(
                0,
                Math.ceil(
                  (new Date(session.expiresAt).getTime() - now) / 86_400_000,
                ),
              );
              return (
                <li key={session.id} className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                    <DeviceIcon userAgent={session.userAgent} />
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                    <span className="font-medium">{sessionName(session)}</span>
                    <span className="text-muted-foreground">
                      {session.ipAddress} · Signed in{' '}
                      {relativeTime(session.createdAt).toLowerCase()} · expires
                      in {days} {days === 1 ? 'day' : 'days'}
                    </span>
                    {session.isTrusted && session.trustedUntil && (
                      <span className="text-muted-foreground">
                        Trusted until {dayDate(session.trustedUntil)}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Sign ${user.fullName} out everywhere?`}
        description={`Their ${count} ${count === 1 ? 'session ends' : 'sessions end'} now. They’ll have to sign in again on every device.`}
        confirmLabel="Sign out everywhere"
        icon={LogOutIcon}
        onConfirm={async () => {
          try {
            const answer = await userSessionsControllerRevokeV1(user.id);
            const ended = answer.data?.revokedCount ?? count;
            toast.success(
              `Signed out of ${ended} ${ended === 1 ? 'session' : 'sessions'}.`,
            );
            await sessions.refetch();
          } catch (error) {
            return serverRefusal('Couldn’t sign them out', error);
          }
        }}
      />
    </section>
  );
}

function DeleteCard({ summary }: { summary: UserSummaryResponseDto }) {
  const refresh = usePeopleCache();
  const { user } = summary;
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="delete-heading" className="max-w-2xl">
      <div className="flex flex-col gap-5 rounded-xl border border-destructive-border bg-card p-6 text-card-foreground shadow-sm">
        <header className="flex flex-col gap-1">
          <h2
            id="delete-heading"
            className="text-base font-semibold text-destructive"
          >
            Delete {user.fullName}
          </h2>
          <p className="text-sm text-muted-foreground">Danger zone</p>
        </header>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">
            Signs them out everywhere now and frees their seat. You can restore
            them later.
          </p>
          <Button
            variant="destructive"
            className={cn('w-fit shrink-0')}
            onClick={() => setOpen(true)}
          >
            <Trash2Icon aria-hidden />
            Delete
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${user.fullName}?`}
        description="They’re signed out everywhere now and can’t sign in. Their seat is freed. You can restore them later from Show deleted."
        confirmLabel="Delete"
        icon={Trash2Icon}
        onConfirm={async () => {
          try {
            await userAdminControllerRemoveV1(user.id);
            await refresh();
          } catch (error) {
            return isLastAdmin(error)
              ? lastAdminRefusal(
                  user.fullName,
                  'Make someone else an Org Admin before deleting this account.',
                )
              : serverRefusal('Couldn’t delete them', error);
          }
        }}
      />
    </section>
  );
}
