'use client';

import {
  ApiError,
  rolesControllerAssignUsersV1,
  rolesControllerRevokeUserV1,
  rolesControllerSetPermissionsV1,
  rolesControllerUpdateV1,
  usePermissionsControllerListV1,
  useRolesControllerGetV1,
  useUserAdminControllerListV1,
  type PermissionResponseDto,
  type RoleResponseDto,
  type RoleResponseDtoPermissionCodesItem as PermissionCode,
} from '@synapsedesk/api-client';
import {
  CopyIcon,
  LockIcon,
  Trash2Icon,
  UserPlusIcon,
  XIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/auth/field';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useViewer } from '@/hooks/use-viewer';
import {
  PERMISSION_GROUPS,
  PERMISSION_WORDS,
  permissionWords,
  roleDescription,
} from '@/lib/administration';
import { asSentence } from '@/lib/documents';
import { toastError } from '@/lib/toast';
import { Status } from '../badges';
import { RefusalAlert, type Refusal } from '../confirm-dialog';
import { PeoplePicker, type Picked } from '../people-picker';
import {
  isLastAdmin,
  lastAdminRefusal,
  refusalText,
  serverRefusal,
} from '../people/person-dialogs';
import { PersonCell, useOrganizationName } from '../people/shared';
import { LoadError, PageHeading, SettingsFrame } from '../settings-frame';
import {
  CATALOG_SIZE,
  DeleteRoleDialog,
  NewRoleDialog,
  escalationRefusal,
  people,
  useRoleCache,
} from './roles-view';
import { PageUnavailable } from '@/components/shell/page-unavailable';

const NAME_MAX = 100;
const DESCRIPTION_MAX = 2000;
const HOLDERS_SHOWN = 20;
const ADD_MAX = 50;

/** Settings › Roles › {name}: what it lets people do, and who holds it. */
export function RoleView({ roleId }: { roleId: string }) {
  const { can, query: viewer } = useViewer();
  const router = useRouter();
  const organization = useOrganizationName();
  const [dialog, setDialog] = useState<'copy' | 'delete' | null>(null);
  const role = useRolesControllerGetV1(roleId, {
    query: { enabled: can('role.read') },
  });
  const crumbs = (name?: string) => [
    { label: 'Roles', href: '/settings/roles' },
    ...(name ? [{ label: name }] : []),
  ];

  if (viewer.isSuccess && !can('role.read')) {
    return (
      <SettingsFrame crumbs={crumbs()}>
        <PageUnavailable back={{ href: '/settings', label: 'Settings' }} />
      </SettingsFrame>
    );
  }
  const data = role.data?.data;
  if (role.isError && !data) {
    return (
      <SettingsFrame crumbs={crumbs()}>
        <LoadError what="this role" onRetry={() => void role.refetch()} />
      </SettingsFrame>
    );
  }
  if (!data) {
    return (
      <SettingsFrame crumbs={crumbs()}>
        <Skeleton className="h-96 w-full" />
      </SettingsFrame>
    );
  }

  const actions = data.isSystemRole
    ? can('role.create') && (
        <Button variant="outline" onClick={() => setDialog('copy')}>
          <CopyIcon aria-hidden />
          <span className="md:hidden">Copy</span>
          <span className="hidden md:inline">Copy to a new role</span>
        </Button>
      )
    : can('role.delete') && (
        <Button
          variant="destructive-outline"
          onClick={() => setDialog('delete')}
        >
          <Trash2Icon aria-hidden />
          Delete
        </Button>
      );

  return (
    <SettingsFrame crumbs={crumbs(data.name)}>
      <div className="flex flex-col gap-3">
        <PageHeading
          title={data.name}
          description={roleDescription(data, organization) ?? undefined}
          action={actions}
        />
        {data.isSystemRole && (
          <div>
            <Status tone="muted" icon={LockIcon}>
              System role · read-only
            </Status>
          </div>
        )}
      </div>
      {!data.isSystemRole && can('role.update') && <NameCard role={data} />}
      <Catalog role={data} />
      <Holders role={data} />
      <NewRoleDialog
        open={dialog === 'copy'}
        onOpenChange={(open) => setDialog(open ? 'copy' : null)}
        from={data}
      />
      <DeleteRoleDialog
        role={data}
        open={dialog === 'delete'}
        onOpenChange={(open) => setDialog(open ? 'delete' : null)}
        onDeleted={() => {
          toast.success(`${data.name} deleted.`);
          router.push('/settings/roles');
        }}
      />
    </SettingsFrame>
  );
}

function Section({
  title,
  lead,
  aside,
  children,
}: {
  title: string;
  lead?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <Card>
        <CardContent className="flex flex-col gap-5">
          <header className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-col gap-1">
              <h2 id={id} className="text-base font-semibold">
                {title}
              </h2>
              {lead && <p className="text-sm text-muted-foreground">{lead}</p>}
            </div>
            {aside}
          </header>
          {children}
        </CardContent>
      </Card>
    </section>
  );
}

function NameCard({ role }: { role: RoleResponseDto }) {
  const refresh = useRoleCache();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const changed =
    name.trim() !== role.name ||
    (description.trim() || null) !== role.description;

  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setNameError(null);
    try {
      await rolesControllerUpdateV1(role.id, {
        name: name.trim(),
        description: description.trim() || null,
      });
      void refresh();
      toast.success('Changes saved.');
    } catch (error) {
      setNameError(
        error instanceof ApiError && error.status === 409
          ? `A role named ${name.trim()} already exists.`
          : refusalText(error),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Name and description">
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => void save(event)}
        noValidate
      >
        <Field
          id="role-edit-name"
          label="Name"
          error={nameError}
          announce
          count={{ length: name.length, max: NAME_MAX }}
        >
          {(aria) => (
            <Input
              id="role-edit-name"
              value={name}
              maxLength={NAME_MAX}
              onChange={(event) => setName(event.target.value)}
              {...aria}
            />
          )}
        </Field>
        <Field id="role-edit-description" label="Description">
          {(aria) => (
            <Textarea
              id="role-edit-description"
              value={description}
              maxLength={DESCRIPTION_MAX}
              onChange={(event) => setDescription(event.target.value)}
              {...aria}
            />
          )}
        </Field>
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={busy || !changed || name.trim().length < 2}
          >
            Save changes
          </Button>
        </div>
      </form>
    </Section>
  );
}

/**
 * The catalog by area, each permission in words with its code beside it.
 * One the viewer doesn't hold can't be ticked, and says why; a retired one
 * can only be unticked.
 */
function Catalog({ role }: { role: RoleResponseDto }) {
  const { can } = useViewer();
  const refresh = useRoleCache();
  const catalog = usePermissionsControllerListV1({
    query: { staleTime: 300_000 },
  });
  const editable = !role.isSystemRole && can('role.permission.assign');
  const [ticked, setTicked] = useState<ReadonlySet<string>>(
    () => new Set(role.permissionCodes),
  );
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(role.permissionCodes);

  // A save elsewhere (another tab, the copy) brings new codes: start from them.
  if (saved !== role.permissionCodes) {
    setSaved(role.permissionCodes);
    setTicked(new Set(role.permissionCodes));
  }

  const groups = useMemo(() => {
    const items = catalog.data?.data ?? [];
    return PERMISSION_GROUPS.map((group) => ({
      group,
      items: items.filter(
        (item) =>
          (PERMISSION_WORDS[item.code]?.group ?? 'Organization') === group,
      ),
    })).filter((entry) => entry.items.length > 0);
  }, [catalog.data]);

  const unsaved =
    ticked.size !== role.permissionCodes.length ||
    role.permissionCodes.some((code) => !ticked.has(code));

  const save = async () => {
    setBusy(true);
    setRefusal(null);
    try {
      await rolesControllerSetPermissionsV1(role.id, {
        permissionCodes: [...ticked] as PermissionCode[],
      });
      void refresh();
      toast.success('Permissions saved.');
    } catch (error) {
      setRefusal(
        escalationRefusal(error) ?? serverRefusal('Couldn’t save them', error),
      );
    } finally {
      setBusy(false);
    }
  };

  const toggle = (code: string, on: boolean) => {
    const next = new Set(ticked);
    if (on) next.add(code);
    else next.delete(code);
    setTicked(next);
  };

  return (
    <Section
      title="What it lets people do"
      lead={`${role.permissionCodes.length} of ${CATALOG_SIZE} permissions.`}
    >
      {catalog.isError && !catalog.data ? (
        <LoadError
          what="the permissions"
          onRetry={() => void catalog.refetch()}
        />
      ) : !catalog.data ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map(({ group, items }) => (
            <fieldset key={group} className="rounded-lg border p-4">
              <legend className="sr-only">{group}</legend>
              <p aria-hidden className="mb-3 text-sm font-semibold">
                {group}{' '}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  {items.filter((item) => ticked.has(item.code)).length} of{' '}
                  {items.length}
                </span>
              </p>
              <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
                {items.map((item) => (
                  <Permission
                    key={item.code}
                    item={item}
                    checked={ticked.has(item.code)}
                    editable={editable}
                    grantable={can(item.code)}
                    onChange={(on) => toggle(item.code, on)}
                  />
                ))}
              </div>
            </fieldset>
          ))}
          {refusal && <RefusalAlert refusal={refusal} />}
          {editable && (
            <div className="flex items-center justify-end gap-3">
              {unsaved && (
                <span className="text-sm text-muted-foreground">
                  Unsaved changes
                </span>
              )}
              <Button disabled={busy || !unsaved} onClick={() => void save()}>
                Save permissions
              </Button>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function Permission({
  item,
  checked,
  editable,
  grantable,
  onChange,
}: {
  item: PermissionResponseDto;
  checked: boolean;
  editable: boolean;
  grantable: boolean;
  onChange: (on: boolean) => void;
}) {
  const id = `permission-${item.code}`;
  const reasonId = `${id}-reason`;
  // Unticking is always allowed: it only takes away.
  const disabled = !editable || (!checked && (!grantable || item.isRetired));
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        aria-describedby={editable && !grantable ? reasonId : undefined}
        onCheckedChange={(state) => onChange(state === true)}
        className="mt-0.5"
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-sm leading-tight">
          {permissionWords(item.code)}
          {item.isRetired && (
            <span className="ml-2 text-xs text-muted-foreground">Retired</span>
          )}
        </label>
        <code className="font-mono text-xs text-muted-foreground">
          {item.code}
        </code>
        {editable && !grantable && (
          <span id={reasonId} className="text-xs text-muted-foreground">
            You don’t hold it, so you can’t grant it.
          </span>
        )}
      </div>
    </div>
  );
}

/** Who holds it: a page of them, add several, take it from one. */
function Holders({ role }: { role: RoleResponseDto }) {
  const { can } = useViewer();
  const refresh = useRoleCache();
  const [adding, setAdding] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const holders = useUserAdminControllerListV1({
    roleId: role.id,
    limit: HOLDERS_SHOWN,
    sortBy: 'fullName',
    sortOrder: 'ASC',
  });
  const assign = can('user.role.assign');
  const items = holders.data?.data?.items ?? [];
  const total = holders.data?.data?.meta.totalItems ?? role.userAssigned;

  const take = async (user: { id: string; fullName: string }) => {
    setRefusal(null);
    try {
      await rolesControllerRevokeUserV1(role.id, user.id);
      void refresh();
    } catch (error) {
      setRefusal(
        isLastAdmin(error)
          ? lastAdminRefusal(
              user.fullName,
              'Give someone else the Org Admin role before taking it from this account.',
            )
          : serverRefusal('Couldn’t take it away', error),
      );
    }
  };

  return (
    <Section
      title="Who holds it"
      lead={
        items.length < total
          ? `${people(total)} · showing ${items.length}.`
          : `${people(total)}.`
      }
      aside={
        assign && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <UserPlusIcon aria-hidden />
            Add people
          </Button>
        )
      }
    >
      {refusal && <RefusalAlert refusal={refusal} />}
      {holders.isError && !holders.data ? (
        <LoadError what="who holds it" onRetry={() => void holders.refetch()} />
      ) : !holders.data ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        items.length > 0 && (
          <ul className="flex flex-col gap-3">
            {items.map(({ user }) => (
              <li
                key={user.id}
                className="flex items-center justify-between gap-2"
              >
                <PersonCell user={user} />
                {assign && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={`Take ${role.name} from ${user.fullName}`}
                    onClick={() => void take(user)}
                  >
                    <XIcon aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )
      )}
      <GiveRoleDialog
        role={role}
        exclude={items.map(({ user }) => user.id)}
        open={adding}
        onOpenChange={setAdding}
      />
    </Section>
  );
}

/** Give {role} to people: several at once. */
function GiveRoleDialog({
  role,
  exclude,
  open,
  onOpenChange,
}: {
  role: RoleResponseDto;
  exclude: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useRoleCache();
  const [picked, setPicked] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);

  const give = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      await rolesControllerAssignUsersV1(role.id, {
        userIds: picked.map((person) => person.id),
      });
      void refresh();
      onOpenChange(false);
    } catch (error) {
      toastError(
        'Couldn’t give it',
        error instanceof ApiError
          ? asSentence(error.message)
          : refusalText(error),
      );
    } finally {
      setBusy(false);
    }
  };

  // Each opening starts afresh: a controlled dialog's onOpenChange
  // only hears it close.
  const [shown, setShown] = useState(false);
  if (open !== shown) {
    setShown(open);
    if (open) {
      setPicked([]);
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
          onSubmit={(event) => void give(event)}
        >
          <DialogHeader>
            <DialogTitle>Give {role.name} to people</DialogTitle>
          </DialogHeader>
          <PeoplePicker
            id="role-people"
            value={picked}
            onChange={setPicked}
            exclude={exclude}
            max={ADD_MAX}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={busy || picked.length === 0}>
              {picked.length === 1
                ? 'Give to 1 person'
                : `Give to ${picked.length} people`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
