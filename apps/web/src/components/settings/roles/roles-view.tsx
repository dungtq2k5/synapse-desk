'use client';

import {
  ApiError,
  rolesControllerCreateV1,
  rolesControllerRemoveV1,
  useUserAdminControllerListV1,
  type RoleResponseDto,
} from '@synapsedesk/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { EllipsisIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type SubmitEvent } from 'react';
import { Field } from '@/components/auth/field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useViewer } from '@/hooks/use-viewer';
import { permissionWords, roleDescription } from '@/lib/administration';
import { asSentence } from '@/lib/documents';
import { SystemBadge } from '../badges';
import {
  ConfirmDialog,
  RefusalAlert,
  type Refusal,
  useMenuHandoff,
} from '../confirm-dialog';
import { refusalText, serverRefusal } from '../people/person-dialogs';
import { useOrganizationName, useRoles } from '../people/shared';
import {
  PageHeading,
  SettingsFrame,
  SettingsUnavailable,
} from '../settings-frame';

const NAME_MAX = 100;
const DESCRIPTION_MAX = 2000;
const NOTHING = '__nothing__';

/** How many of the catalog's permissions there are, retired ones aside. */
export const CATALOG_SIZE = 44;

export const people = (count: number) =>
  count === 1 ? '1 person' : `${count} people`;

/** Refetches every role and people view after a change. */
export function useRoleCache() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        typeof queryKey[0] === 'string' &&
        /^\/api\/v1\/(roles|users)/.test(queryKey[0]),
    });
}

/** The server's no-escalation refusal, naming what isn't the viewer's to give. */
export function escalationRefusal(error: unknown): Refusal | null {
  if (!(error instanceof ApiError) || error.status !== 403) return null;
  const codes = /do not hold: (.+)$/.exec(error.message)?.[1];
  if (!codes) return null;
  return {
    title: 'You can’t grant permissions you don’t hold',
    description: `${codes
      .replace(/[.!]$/, '')
      .split(', ')
      .map(permissionWords)
      .join(
        ', ',
      )} isn’t yours to give. Untick it, or ask an Org Admin to change this role.`,
  };
}

/** Settings › Roles: system roles first, then custom roles. */
export function RolesView() {
  const { can, query: viewer } = useViewer();
  const { roles, loaded } = useRoles();
  const organization = useOrganizationName();
  const [creating, setCreating] = useState(false);

  if (viewer.isSuccess && !can('role.read')) {
    return (
      <SettingsFrame crumbs={[{ label: 'Roles' }]}>
        <SettingsUnavailable />
      </SettingsFrame>
    );
  }

  const system = roles.filter((role) => role.isSystemRole);
  const custom = roles.filter((role) => !role.isSystemRole);

  return (
    <SettingsFrame crumbs={[{ label: 'Roles' }]}>
      <PageHeading
        title="Roles"
        description="What each role lets people do. System roles are shared by every organization and can’t be changed."
        action={
          can('role.create') && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon aria-hidden />
              New role
            </Button>
          )
        }
      />
      {!loaded ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <>
          <RoleTable
            title="System roles"
            roles={system}
            organization={organization}
          />
          {custom.length > 0 && (
            <RoleTable
              title="Custom roles"
              roles={custom}
              organization={organization}
            />
          )}
        </>
      )}
      <NewRoleDialog open={creating} onOpenChange={setCreating} />
    </SettingsFrame>
  );
}

function RoleTable({
  title,
  roles,
  organization,
}: {
  title: string;
  roles: RoleResponseDto[];
  organization: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold">{title}</h2>
      <div className="hidden overflow-hidden rounded-lg border md:block">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>Held by</TableHead>
              <TableHead>Permissions</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((role) => (
              <TableRow key={role.id}>
                <TableCell className="max-w-md whitespace-normal">
                  <RoleCell role={role} organization={organization} />
                </TableCell>
                <TableCell>{people(role.userAssigned)}</TableCell>
                <TableCell>
                  {role.permissionCodes.length} of {CATALOG_SIZE}
                </TableCell>
                <TableCell className="text-right">
                  {!role.isSystemRole && <RowActions role={role} />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="flex flex-col gap-2 md:hidden">
        {roles.map((role) => (
          <li
            key={role.id}
            className="flex flex-col gap-2 rounded-lg border bg-card p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <RoleCell role={role} organization={organization} />
              {!role.isSystemRole && <RowActions role={role} />}
            </div>
            <p className="text-sm text-muted-foreground">
              Held by {people(role.userAssigned)} ·{' '}
              {role.permissionCodes.length} of {CATALOG_SIZE} permissions
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RoleCell({
  role,
  organization,
}: {
  role: RoleResponseDto;
  organization: string;
}) {
  const description = roleDescription(role, organization);
  return (
    <div className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <Link
          href={`/settings/roles/${role.id}`}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {role.name}
        </Link>
        {role.isSystemRole && <SystemBadge />}
      </span>
      {description && (
        <span className="text-xs text-muted-foreground">{description}</span>
      )}
    </div>
  );
}

function RowActions({ role }: { role: RoleResponseDto }) {
  const { can } = useViewer();
  const [deleting, setDeleting] = useState(false);
  const menu = useMenuHandoff();
  if (!can('role.delete')) return null;
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Actions for ${role.name}`}
          >
            <EllipsisIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="shadow-md"
          onCloseAutoFocus={menu.onCloseAutoFocus}
        >
          <DropdownMenuItem asChild>
            <Link href={`/settings/roles/${role.id}`}>Open</Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => menu.handOff(() => setDeleting(true))}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteRoleDialog
        role={role}
        open={deleting}
        onOpenChange={setDeleting}
      />
    </>
  );
}

/**
 * "Delete {name}?"; refused while anyone holds it, naming them. The names
 * come from the people list filtered by the role, a page of them at most.
 */
export function DeleteRoleDialog({
  role,
  open,
  onOpenChange,
  onDeleted,
}: {
  role: RoleResponseDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const refresh = useRoleCache();
  const holders = useUserAdminControllerListV1(
    { roleId: role.id, limit: 5, sortBy: 'fullName', sortOrder: 'ASC' },
    { query: { enabled: open && role.userAssigned > 0 } },
  );
  const held = role.userAssigned > 0;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${role.name}?`}
      description={
        held
          ? 'People holding it lose its permissions.'
          : 'Nobody holds it. It’s removed for good.'
      }
      confirmLabel="Delete"
      icon={Trash2Icon}
      onConfirm={async () => {
        try {
          await rolesControllerRemoveV1(role.id);
          void refresh();
          onDeleted?.();
        } catch (error) {
          const count = /assigned to (\d+)/.exec(
            error instanceof ApiError ? error.message : '',
          )?.[1];
          if (!count) return serverRefusal('Couldn’t delete it', error);
          const names = (holders.data?.data?.items ?? []).map(
            (item) => item.user.fullName,
          );
          return {
            title: `${role.name} is held by ${people(Number(count))}`,
            description: `Take it away from ${names.length > 0 ? listed(names, Number(count)) : 'them'} first, then delete it.`,
          };
        }
      }}
    />
  );
}

/** "Sam, Kai and 3 others", or every name when there are few. */
function listed(names: string[], total: number): string {
  const rest = total - names.length;
  if (rest > 0)
    return `${names.join(', ')} and ${rest} ${rest === 1 ? 'other' : 'others'}`;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * New role: its name (409 when taken), description, and a role to start
 * from, whose permissions come ticked. It opens on the new role's page.
 */
export function NewRoleDialog({
  open,
  onOpenChange,
  from,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A role to copy, preset in Start from. */
  from?: RoleResponseDto;
}) {
  const router = useRouter();
  const refresh = useRoleCache();
  const { roles } = useRoles();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [start, setStart] = useState(NOTHING);
  const [nameError, setNameError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setNameError(null);
    setRefusal(null);
    const trimmed = name.trim();
    try {
      const created = await rolesControllerCreateV1({
        name: trimmed,
        description: description.trim() || null,
        permissionCodes:
          roles.find((role) => role.id === start)?.permissionCodes ?? [],
      });
      void refresh();
      onOpenChange(false);
      router.push(`/settings/roles/${created.data.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setNameError(`A role named ${trimmed} already exists.`);
      } else {
        setRefusal(
          escalationRefusal(error) ?? {
            title: 'Couldn’t create it',
            description:
              error instanceof ApiError
                ? asSentence(error.message)
                : refusalText(error),
          },
        );
      }
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
      setName('');
      setDescription('');
      setStart(from?.id ?? NOTHING);
      setNameError(null);
      setRefusal(null);
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
          onSubmit={(event) => void create(event)}
          noValidate
        >
          <DialogHeader>
            <DialogTitle>New role</DialogTitle>
          </DialogHeader>
          <Field
            id="role-name"
            label="Name"
            error={nameError}
            announce
            count={{ length: name.length, max: NAME_MAX }}
          >
            {(aria) => (
              <Input
                id="role-name"
                value={name}
                maxLength={NAME_MAX}
                onChange={(event) => setName(event.target.value)}
                {...aria}
              />
            )}
          </Field>
          <Field id="role-description" label="Description (optional)">
            {(aria) => (
              <Textarea
                id="role-description"
                value={description}
                maxLength={DESCRIPTION_MAX}
                placeholder="Who it’s for, in a sentence."
                onChange={(event) => setDescription(event.target.value)}
                {...aria}
              />
            )}
          </Field>
          <Field
            id="role-start"
            label="Start from"
            description="Its permissions are ticked to begin with. You choose the rest next."
          >
            {(aria) => (
              <Select value={start} onValueChange={setStart}>
                <SelectTrigger id="role-start" className="w-full" {...aria}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="shadow-md">
                  <SelectItem value={NOTHING}>Nothing</SelectItem>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          {refusal && <RefusalAlert refusal={refusal} />}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={busy || name.trim().length < 2}>
              Create role
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
