'use client';

import {
  ApiError,
  departmentsControllerAddMembersV1,
  departmentsControllerRemoveMemberV1,
  useDepartmentsControllerGetV1,
  useDepartmentsControllerListMembersV1,
  type DepartmentMemberResponseDto,
  type DepartmentResponseDto,
  type UserResponseDto,
} from '@synapsedesk/api-client';
import {
  ChevronRightIcon,
  PencilIcon,
  Trash2Icon,
  UserPlusIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { Empty, Pagination } from '@/components/documents/parts';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useViewer } from '@/hooks/use-viewer';
import { dayDate } from '@/lib/format';
import { toastError } from '@/lib/toast';
import { PrimaryBadge } from '../badges';
import { RefusalAlert, type Refusal } from '../confirm-dialog';
import { PeoplePicker, type Picked } from '../people-picker';
import { refusalText, serverRefusal } from '../people/person-dialogs';
import { PersonCell } from '../people/shared';
import {
  LoadError,
  PageHeading,
  SettingsFrame,
  SettingsUnavailable,
} from '../settings-frame';
import {
  DeleteDepartmentDialog,
  DepartmentDialog,
  members,
  useDepartmentCache,
} from './departments-view';

const ADD_MAX = 50;

type Member = Pick<UserResponseDto, 'id' | 'fullName' | 'email' | 'avatarUrl'>;
const memberUser = (member: DepartmentMemberResponseDto) =>
  member.user as Member;

/** Settings › Departments › {name}: its members, the primary marked. */
export function DepartmentView({ departmentId }: { departmentId: string }) {
  const { can, query: viewer } = useViewer();
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<'edit' | 'delete' | 'add' | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const readable = can('department.read');
  const department = useDepartmentsControllerGetV1(departmentId, {
    query: { enabled: readable },
  });
  const list = useDepartmentsControllerListMembersV1(
    departmentId,
    { page, limit: 20, sortBy: 'assignedAt', sortOrder: 'ASC' },
    { query: { enabled: readable } },
  );

  const crumbs = (name?: string) => [
    { label: 'Departments', href: '/settings/departments' },
    ...(name ? [{ label: name }] : []),
  ];

  if (viewer.isSuccess && !readable) {
    return (
      <SettingsFrame crumbs={crumbs()}>
        <SettingsUnavailable />
      </SettingsFrame>
    );
  }

  const data = department.data?.data;
  if (department.isError && !data) {
    return (
      <SettingsFrame crumbs={crumbs()}>
        <LoadError
          what="this department"
          onRetry={() => void department.refetch()}
        />
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

  const assign = can('department.member.assign') && !data.deletedAt;
  const memberData = list.data?.data;
  const actions = !data.deletedAt &&
    (can('department.update') || can('department.delete')) && (
      <div className="flex gap-2">
        {can('department.update') && (
          <Button variant="outline" onClick={() => setDialog('edit')}>
            <PencilIcon aria-hidden />
            Edit
          </Button>
        )}
        {can('department.delete') && (
          <Button
            variant="destructive-outline"
            onClick={() => setDialog('delete')}
          >
            <Trash2Icon aria-hidden />
            Delete
          </Button>
        )}
      </div>
    );

  return (
    <SettingsFrame crumbs={crumbs(data.name)}>
      <PageHeading
        title={data.name}
        description={data.description ?? undefined}
        action={actions}
      />
      {refusal && <RefusalAlert refusal={refusal} />}
      <div className="flex items-center gap-3">
        <h2 className="font-medium">
          {members(memberData?.meta.totalItems ?? data.memberCount)}
        </h2>
        {assign && (
          <Button variant="outline" size="sm" onClick={() => setDialog('add')}>
            <UserPlusIcon aria-hidden />
            Add people
          </Button>
        )}
      </div>
      {list.isError && !memberData ? (
        <LoadError what="the members" onRetry={() => void list.refetch()} />
      ) : !memberData ? (
        <Skeleton className="h-80 w-full" />
      ) : memberData.items.length === 0 ? (
        <Empty
          icon={<UsersIcon />}
          title="No members yet"
          description="Add people to this department, and they show here."
        />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Primary</TableHead>
                  <TableHead>Added by</TableHead>
                  <TableHead>Added</TableHead>
                  {assign && (
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {memberData.items.map((member) => (
                  <TableRow key={memberUser(member).id}>
                    <TableCell>
                      <PersonCell user={memberUser(member)} />
                    </TableCell>
                    <TableCell>
                      {member.isPrimary ? <PrimaryBadge /> : '—'}
                    </TableCell>
                    <TableCell>{member.assignedByName ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {dayDate(member.assignedAt)}
                    </TableCell>
                    {assign && (
                      <TableCell className="text-right">
                        <RemoveButton
                          department={data}
                          member={member}
                          onRefusal={setRefusal}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden">
            {memberData.items.map((member) => (
              <li
                key={memberUser(member).id}
                className="flex flex-col gap-2 rounded-lg border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <PersonCell user={memberUser(member)} />
                  {assign && (
                    <RemoveButton
                      department={data}
                      member={member}
                      onRefusal={setRefusal}
                    />
                  )}
                </div>
                {member.isPrimary && <PrimaryBadge />}
                <p className="text-sm text-muted-foreground">
                  {member.assignedByName
                    ? `Added by ${member.assignedByName}, ${dayDate(member.assignedAt)}`
                    : dayDate(member.assignedAt)}
                </p>
              </li>
            ))}
          </ul>
          {memberData.meta.totalPages > 1 && (
            <Pagination
              meta={memberData.meta}
              onPage={setPage}
              noun="members"
            />
          )}
        </>
      )}
      <DepartmentDialog
        department={data}
        open={dialog === 'edit'}
        onOpenChange={(open) => setDialog(open ? 'edit' : null)}
      />
      <DeleteDepartmentDialog
        department={data}
        open={dialog === 'delete'}
        onOpenChange={(open) => setDialog(open ? 'delete' : null)}
        onDeleted={() => {
          toast.success(`${data.name} deleted.`);
          router.push('/settings/departments');
        }}
      />
      <AddPeopleDialog
        department={data}
        exclude={memberData?.items.map((member) => memberUser(member).id) ?? []}
        open={dialog === 'add'}
        onOpenChange={(open) => setDialog(open ? 'add' : null)}
      />
    </SettingsFrame>
  );
}

/** "{department} is {name}’s primary department", with a link to their page. */
function primaryRefusal(department: string, person: Member): Refusal {
  const first = person.fullName.split(' ')[0];
  return {
    title: `${department} is ${person.fullName}’s primary department`,
    description: (
      <span className="flex flex-col items-start gap-2">
        Give {first} another primary department on their page first, then remove
        them here.
        <Link
          href={`/settings/people/${person.id}`}
          className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
        >
          Open {person.fullName}
          <ChevronRightIcon aria-hidden className="size-4" />
        </Link>
      </span>
    ),
  };
}

function RemoveButton({
  department,
  member,
  onRefusal,
}: {
  department: DepartmentResponseDto;
  member: DepartmentMemberResponseDto;
  onRefusal: (refusal: Refusal | null) => void;
}) {
  const refresh = useDepartmentCache();
  const person = memberUser(member);

  const remove = async () => {
    onRefusal(null);
    try {
      await departmentsControllerRemoveMemberV1(department.id, person.id);
      void refresh();
    } catch (error) {
      onRefusal(
        error instanceof ApiError &&
          error.status === 409 &&
          /primary/i.test(error.message)
          ? primaryRefusal(department.name, person)
          : serverRefusal('Couldn’t remove them', error),
      );
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      aria-label={`Remove ${person.fullName} from ${department.name}`}
      onClick={() => void remove()}
    >
      <XIcon aria-hidden />
    </Button>
  );
}

/** Add people to {department}: several at once, optionally as their primary. */
function AddPeopleDialog({
  department,
  exclude,
  open,
  onOpenChange,
}: {
  department: DepartmentResponseDto;
  exclude: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useDepartmentCache();
  const [picked, setPicked] = useState<Picked[]>([]);
  const [primary, setPrimary] = useState(false);
  const [busy, setBusy] = useState(false);

  const add = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      await departmentsControllerAddMembersV1(department.id, {
        userIds: picked.map((person) => person.id),
        isPrimary: primary,
      });
      void refresh();
      onOpenChange(false);
    } catch (error) {
      toastError('Couldn’t add them', refusalText(error));
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
      setPrimary(false);
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
          onSubmit={(event) => void add(event)}
        >
          <DialogHeader>
            <DialogTitle>Add people to {department.name}</DialogTitle>
          </DialogHeader>
          <PeoplePicker
            id="department-people"
            value={picked}
            onChange={setPicked}
            exclude={exclude}
            max={ADD_MAX}
          />
          <div className="flex items-center gap-2">
            <Checkbox
              id="department-primary"
              checked={primary}
              onCheckedChange={(checked) => setPrimary(checked === true)}
            />
            <Label htmlFor="department-primary" className="font-normal">
              Make {department.name} their primary department
            </Label>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={busy || picked.length === 0}>
              {picked.length === 1
                ? 'Add 1 person'
                : `Add ${picked.length} people`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
