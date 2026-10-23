'use client';

import {
  userAdminControllerRemoveV1,
  userAdminControllerResetTwoFactorV1,
  userAdminControllerUnlockV1,
  userSessionsControllerRevokeV1,
  useUserAdminControllerListV1,
  useUserSessionsControllerListV1,
  type UserAdminControllerListV1Params,
  type UserSummaryResponseDto,
} from '@synapsedesk/api-client';
import {
  EllipsisIcon,
  FilterIcon,
  LogOutIcon,
  SearchIcon,
  SearchXIcon,
  Trash2Icon,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  ALL,
  Empty,
  FilterSelect,
  Pagination,
  useDepartmentNames,
} from '@/components/documents/parts';
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useViewer } from '@/hooks/use-viewer';
import { calendarDate, relativeTime } from '@/lib/format';
import { toastError } from '@/lib/toast';
import { PersonStatus, TwoStep } from '../badges';
import { ConfirmDialog, useMenuHandoff } from '../confirm-dialog';
import { LoadError, Loading, SettingsFrame } from '../settings-frame';
import { InviteButton } from './invite-dialog';
import {
  EditDepartmentsDialog,
  EditRolesDialog,
  isLastAdmin,
  lastAdminRefusal,
  LockDialog,
  refusalText,
  serverRefusal,
} from './person-dialogs';
import {
  PeopleHeader,
  PersonCell,
  useMemberships,
  usePeopleCache,
  useRoles,
} from './shared';
import { PageUnavailable } from '@/components/shell/page-unavailable';

const PAGE_SIZE = 10;

type Filters = {
  searchTerm?: string;
  departmentId?: string;
  roleId?: string;
  status?: 'active' | 'locked' | 'deleted';
  includeDeleted?: boolean;
};

const STATUS = { active: 'Active', locked: 'Locked', deleted: 'Deleted' };

/** The list's query for its filters: "Deleted" lists the deleted alongside. */
function paramsOf(
  filters: Filters,
  page: number,
): UserAdminControllerListV1Params {
  return {
    page,
    limit: PAGE_SIZE,
    sortBy: 'fullName',
    sortOrder: 'ASC',
    searchTerm: filters.searchTerm,
    departmentId: filters.departmentId,
    roleId: filters.roleId,
    isLocked:
      filters.status === 'locked'
        ? true
        : filters.status === 'active'
          ? false
          : undefined,
    includeDeleted:
      filters.includeDeleted || filters.status === 'deleted' || undefined,
  };
}

/** Settings › People: the members, their filters and each one's actions. */
export function MembersView() {
  const { can, query: viewer } = useViewer();
  const departments = useDepartmentNames();
  const { names: roleNames, roles } = useRoles();
  const [filters, setFilters] = useState<Filters>({});
  const [cleared, setCleared] = useState(0);
  const [page, setPage] = useState(1);
  const list = useUserAdminControllerListV1(paramsOf(filters, page), {
    query: { enabled: can('user.read') },
  });

  if (viewer.isSuccess && !can('user.read')) {
    return (
      <SettingsFrame crumbs={[{ label: 'People' }]}>
        <PageUnavailable back={{ href: '/settings', label: 'Settings' }} />
      </SettingsFrame>
    );
  }

  const changeFilters = (next: Filters) => {
    setFilters(next);
    setPage(1);
  };
  // "Deleted" is answered alongside everyone else, so its rows are picked here.
  const items = (list.data?.data?.items ?? []).filter(
    (item) => filters.status !== 'deleted' || item.deletedAt !== null,
  );
  const meta = list.data?.data?.meta;
  const filtered = Object.values(filters).some(Boolean);

  return (
    <SettingsFrame crumbs={[{ label: 'People' }]}>
      <PeopleHeader
        tab="members"
        action={can('user.invite') && <InviteButton />}
      />
      <Toolbar
        key={cleared}
        filters={filters}
        onChange={changeFilters}
        departments={departments}
        roles={Object.fromEntries(roles.map((role) => [role.id, role.name]))}
      />
      {list.isError && !list.data ? (
        <LoadError what="people" onRetry={() => void list.refetch()} />
      ) : !meta ? (
        <Loading what="people" className="h-96" />
      ) : items.length === 0 ? (
        <Empty
          icon={<SearchXIcon />}
          title="No one matches"
          description="Try other words or clear the filters."
          action={
            filtered && (
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
            )
          }
        />
      ) : (
        <>
          <div
            aria-busy={list.isFetching || undefined}
            className="hidden overflow-hidden rounded-lg border md:block"
          >
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Departments</TableHead>
                  <TableHead>Two-step</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last sign-in</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.user.id}>
                    <TableCell className="max-w-64">
                      <PersonCell
                        user={item.user}
                        deleted={item.deletedAt !== null}
                      />
                    </TableCell>
                    <TableCell className="max-w-48 whitespace-normal">
                      {roleSummary(item, roleNames)}
                    </TableCell>
                    <TableCell className="max-w-48 whitespace-normal">
                      {departmentSummary(item, departments)}
                    </TableCell>
                    <TableCell>
                      <TwoStep on={item.user.isTwoFactorEnabled} />
                    </TableCell>
                    <TableCell>
                      <Status item={item} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {lastSignIn(item)}
                    </TableCell>
                    <TableCell className="text-right">
                      <RowActions item={item} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul
            aria-busy={list.isFetching || undefined}
            className="flex flex-col gap-2 md:hidden"
          >
            {items.map((item) => (
              <li
                key={item.user.id}
                className="flex flex-col gap-3 rounded-lg border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <PersonCell
                    user={item.user}
                    deleted={item.deletedAt !== null}
                  />
                  <RowActions item={item} />
                </div>
                <p className="text-sm">
                  {roleSummary(item, roleNames)} ·{' '}
                  {departmentSummary(item, departments)}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <Status item={item} />
                  <TwoStep on={item.user.isTwoFactorEnabled} />
                  {item.user.lastLoginAt && (
                    <span>
                      Last sign-in{' '}
                      {relativeTime(item.user.lastLoginAt).toLowerCase()}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {meta.totalPages > 1 && (
            <Pagination meta={meta} onPage={setPage} noun="people" />
          )}
        </>
      )}
    </SettingsFrame>
  );
}

function Status({ item }: { item: UserSummaryResponseDto }) {
  return (
    <PersonStatus
      deleted={item.deletedAt !== null}
      locked={item.user.isLocked}
      lockedUntil={
        item.user.lockedUntil ? calendarDate(item.user.lockedUntil) : null
      }
    />
  );
}

function lastSignIn(item: UserSummaryResponseDto): string {
  if (item.deletedAt) return calendarDate(item.deletedAt);
  return item.user.lastLoginAt ? relativeTime(item.user.lastLoginAt) : '—';
}

/** "Knowledge Manager +1": the first role, then how many more. */
function roleSummary(
  item: UserSummaryResponseDto,
  names: ReadonlyMap<string, string>,
): string {
  const all = item.roleIds.map(
    (id, index) => names.get(id) ?? item.roleNames[index] ?? id,
  );
  if (all.length === 0) return '—';
  return all.length === 1 ? all[0] : `${all[0]} +${all.length - 1}`;
}

function departmentSummary(
  item: UserSummaryResponseDto,
  names: ReadonlyMap<string, string>,
): string {
  const all = item.departmentIds
    .map((id) => names.get(id))
    .filter((name): name is string => Boolean(name));
  return all.length ? all.join(', ') : '—';
}

function Toolbar({
  filters,
  onChange,
  departments,
  roles,
}: {
  filters: Filters;
  onChange: (filters: Filters) => void;
  departments: ReadonlyMap<string, string>;
  roles: Record<string, string>;
}) {
  const mobile = useIsMobile();
  const [search, setSearch] = useState(filters.searchTerm ?? '');

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
  const chosen = [filters.departmentId, filters.roleId, filters.status].filter(
    Boolean,
  ).length;

  const selects = (
    <>
      {departments.size > 0 && (
        <FilterSelect
          label="Department"
          value={filters.departmentId}
          options={Object.fromEntries(departments)}
          onValue={(value) => set('departmentId', value)}
        />
      )}
      <FilterSelect
        label="Role"
        value={filters.roleId}
        options={roles}
        onValue={(value) => set('roleId', value)}
      />
      <FilterSelect
        label="Status"
        value={filters.status}
        options={STATUS}
        onValue={(value) => set('status', value)}
      />
    </>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full md:w-65">
        <SearchIcon
          aria-hidden
          className="absolute top-2.5 left-3 size-4 text-muted-foreground"
        />
        <Input
          type="search"
          aria-label="Search by name or email"
          placeholder="Search by name or email"
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
      <div className="ml-auto flex items-center gap-2">
        <Switch
          id="show-deleted-people"
          checked={Boolean(filters.includeDeleted)}
          onCheckedChange={(checked) =>
            onChange({ ...filters, includeDeleted: checked || undefined })
          }
        />
        <Label htmlFor="show-deleted-people" className="font-normal">
          Show deleted
        </Label>
      </div>
    </div>
  );
}

type Dialog =
  'roles' | 'departments' | 'lock' | 'reset' | 'sign-out' | 'delete' | null;

/** A row's actions, each by its permission; none on yourself that end access. */
function RowActions({ item }: { item: UserSummaryResponseDto }) {
  const { can, user: viewer } = useViewer();
  const refresh = usePeopleCache();
  const [dialog, setDialog] = useState<Dialog>(null);
  const menu = useMenuHandoff();
  const { user } = item;
  const own = viewer?.id === user.id;
  const deleted = item.deletedAt !== null;
  const memberships = useMemberships(
    dialog === 'departments' ? user : null,
    item.departmentIds,
  );
  const sessions = useUserSessionsControllerListV1(user.id, {
    query: { enabled: dialog === 'sign-out' },
  });
  const sessionCount = sessions.data?.data?.length ?? 0;
  const person = { id: user.id, fullName: user.fullName };
  const done = () => void refresh();

  const unlock = async () => {
    try {
      await userAdminControllerUnlockV1(user.id);
      toast.success(`${user.fullName} unlocked. They can sign in again.`);
      done();
    } catch (error) {
      toastError('Couldn’t unlock them', refusalText(error));
    }
  };

  const actions = deleted
    ? []
    : [
        can('user.role.assign') && 'roles',
        can('department.member.assign') && 'departments',
        !own && can('user.lock') && (user.isLocked ? 'unlock' : 'lock'),
        user.isTwoFactorEnabled && can('user.2fa.reset') && 'reset',
        !own && can('user.session.revoke') && 'sign-out',
        !own && can('user.delete') && 'delete',
      ].filter(Boolean);

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Actions for ${user.fullName}`}
          >
            <EllipsisIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-48 shadow-md"
          onCloseAutoFocus={menu.onCloseAutoFocus}
        >
          <DropdownMenuItem asChild>
            <Link href={`/settings/people/${user.id}`}>Open</Link>
          </DropdownMenuItem>
          {actions.includes('roles') && (
            <DropdownMenuItem
              onSelect={() => menu.handOff(() => setDialog('roles'))}
            >
              Edit roles
            </DropdownMenuItem>
          )}
          {actions.includes('departments') && (
            <DropdownMenuItem
              onSelect={() => menu.handOff(() => setDialog('departments'))}
            >
              Edit departments
            </DropdownMenuItem>
          )}
          {actions.includes('lock') && (
            <DropdownMenuItem
              onSelect={() => menu.handOff(() => setDialog('lock'))}
            >
              Lock
            </DropdownMenuItem>
          )}
          {actions.includes('unlock') && (
            <DropdownMenuItem onSelect={() => void unlock()}>
              Unlock
            </DropdownMenuItem>
          )}
          {actions.includes('reset') && (
            <DropdownMenuItem
              onSelect={() => menu.handOff(() => setDialog('reset'))}
            >
              Reset two-step
            </DropdownMenuItem>
          )}
          {actions.includes('sign-out') && (
            <DropdownMenuItem
              onSelect={() => menu.handOff(() => setDialog('sign-out'))}
            >
              Sign out everywhere
            </DropdownMenuItem>
          )}
          {actions.includes('delete') && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => menu.handOff(() => setDialog('delete'))}
              >
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <EditRolesDialog
        person={person}
        roleIds={item.roleIds}
        open={dialog === 'roles'}
        onOpenChange={(open) => setDialog(open ? 'roles' : null)}
        onDone={done}
      />
      {memberships && (
        <EditDepartmentsDialog
          person={person}
          memberships={memberships}
          open={dialog === 'departments'}
          onOpenChange={(open) => setDialog(open ? 'departments' : null)}
          onDone={done}
        />
      )}
      <LockDialog
        person={person}
        open={dialog === 'lock'}
        onOpenChange={(open) => setDialog(open ? 'lock' : null)}
        onDone={done}
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
            done();
          } catch (error) {
            return serverRefusal('Couldn’t reset it', error);
          }
        }}
      />
      <ConfirmDialog
        open={dialog === 'sign-out'}
        onOpenChange={(open) => setDialog(open ? 'sign-out' : null)}
        title={`Sign ${user.fullName} out everywhere?`}
        description={`Their ${sessionCount} ${sessionCount === 1 ? 'session ends' : 'sessions end'} now. They’ll have to sign in again on every device.`}
        confirmLabel="Sign out everywhere"
        icon={LogOutIcon}
        onConfirm={async () => {
          try {
            const answer = await userSessionsControllerRevokeV1(user.id);
            const ended = answer.data?.revokedCount ?? sessionCount;
            toast.success(
              `Signed out of ${ended} ${ended === 1 ? 'session' : 'sessions'}.`,
            );
          } catch (error) {
            return serverRefusal('Couldn’t sign them out', error);
          }
        }}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => setDialog(open ? 'delete' : null)}
        title={`Delete ${user.fullName}?`}
        description="They’re signed out everywhere now and can’t sign in. Their seat is freed. You can restore them later from Show deleted."
        confirmLabel="Delete"
        icon={Trash2Icon}
        onConfirm={async () => {
          try {
            await userAdminControllerRemoveV1(user.id);
            done();
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
    </>
  );
}
