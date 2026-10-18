'use client';

import {
  ApiError,
  departmentsControllerCreateV1,
  departmentsControllerRemoveV1,
  departmentsControllerRestoreV1,
  departmentsControllerUpdateV1,
  useDepartmentsControllerListV1,
  type DepartmentResponseDto,
} from '@synapsedesk/api-client';
import { useQueryClient } from '@tanstack/react-query';
import {
  EllipsisIcon,
  NetworkIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  SearchXIcon,
  Trash2Icon,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/auth/field';
import { Empty, Pagination } from '@/components/documents/parts';
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
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
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
import { asSentence } from '@/lib/documents';
import { toastError } from '@/lib/toast';
import { Status } from '../badges';
import { ConfirmDialog, type Refusal, useMenuHandoff } from '../confirm-dialog';
import { refusalText, serverRefusal } from '../people/person-dialogs';
import {
  LoadError,
  PageHeading,
  SettingsFrame,
  SettingsUnavailable,
} from '../settings-frame';

const NAME_MAX = 100;
const DESCRIPTION_MAX = 2000;

/** Refetches every department and people view after a change. */
export function useDepartmentCache() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        typeof queryKey[0] === 'string' &&
        /^\/api\/v1\/(departments|users)/.test(queryKey[0]),
    });
}

export const members = (count: number) =>
  count === 1 ? '1 member' : `${count} members`;

/** "{name} still has {n} members", the server's 409 for a department in use. */
export function stillHasMembers(
  department: Pick<DepartmentResponseDto, 'name'>,
  error: unknown,
): Refusal | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const count = /still has (\d+)/.exec(error.message)?.[1];
  if (!count) return null;
  return {
    title: `${department.name} still has ${members(Number(count))}`,
    description:
      'Move them to another department first. Someone whose primary department this is needs a new primary.',
  };
}

/** Settings › Departments: the list, New, each one's actions, Show deleted. */
export function DepartmentsView() {
  const { can, query: viewer } = useViewer();
  const [search, setSearch] = useState('');
  const [searchTerm, setSearchTerm] = useState<string | undefined>();
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const list = useDepartmentsControllerListV1(
    {
      page,
      limit: 20,
      searchTerm,
      includeDeleted: includeDeleted || undefined,
      sortBy: 'name',
      sortOrder: 'ASC',
    },
    { query: { enabled: can('department.read') } },
  );

  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      setSearchTerm(search.trim() || undefined);
      setPage(1);
    }, 300);
    return () => globalThis.clearTimeout(timer);
  }, [search]);

  if (viewer.isSuccess && !can('department.read')) {
    return (
      <SettingsFrame crumbs={[{ label: 'Departments' }]}>
        <SettingsUnavailable />
      </SettingsFrame>
    );
  }

  const data = list.data?.data;
  const newButton = can('department.create') && (
    <Button onClick={() => setCreating(true)}>
      <PlusIcon aria-hidden />
      New department
    </Button>
  );

  return (
    <SettingsFrame crumbs={[{ label: 'Departments' }]}>
      <PageHeading
        title="Departments"
        description="Groups of people. Documents are shared with them, and tickets belong to them."
        action={newButton}
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full md:w-65">
          <SearchIcon
            aria-hidden
            className="absolute top-2.5 left-3 size-4 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Search departments"
            placeholder="Search departments"
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {can('department.delete') && (
          <div className="ml-auto flex items-center gap-2">
            <Switch
              id="show-deleted-departments"
              checked={includeDeleted}
              onCheckedChange={(checked) => {
                setIncludeDeleted(checked);
                setPage(1);
              }}
            />
            <Label htmlFor="show-deleted-departments" className="font-normal">
              Show deleted
            </Label>
          </div>
        )}
      </div>
      {list.isError && !data ? (
        <LoadError what="the departments" onRetry={() => void list.refetch()} />
      ) : !data ? (
        <Skeleton className="h-80 w-full" />
      ) : data.items.length === 0 ? (
        searchTerm ? (
          <Empty
            icon={<SearchXIcon />}
            title="No departments match"
            description="Try other words or clear the filters."
          />
        ) : (
          <Empty
            icon={<NetworkIcon />}
            title="No departments yet"
            description="Departments group people. Documents are shared with them, and tickets belong to them."
            action={newButton}
          />
        )
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((department) => (
                  <TableRow key={department.id}>
                    <TableCell>
                      <DepartmentName department={department} />
                    </TableCell>
                    <TableCell className="max-w-96 whitespace-normal text-muted-foreground">
                      {department.description}
                    </TableCell>
                    <TableCell>{members(department.memberCount)}</TableCell>
                    <TableCell className="text-right">
                      <RowActions department={department} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden">
            {data.items.map((department) => (
              <li
                key={department.id}
                className="flex flex-col gap-1 rounded-lg border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <DepartmentName department={department} />
                  <RowActions department={department} />
                </div>
                {department.description && (
                  <p className="text-sm text-muted-foreground">
                    {department.description}
                  </p>
                )}
                <p className="text-sm">{members(department.memberCount)}</p>
              </li>
            ))}
          </ul>
          {data.meta.totalPages > 1 && (
            <Pagination meta={data.meta} onPage={setPage} noun="departments" />
          )}
        </>
      )}
      <DepartmentDialog open={creating} onOpenChange={setCreating} />
    </SettingsFrame>
  );
}

function DepartmentName({ department }: { department: DepartmentResponseDto }) {
  return department.deletedAt ? (
    <span className="flex flex-wrap items-center gap-2 font-medium">
      {department.name}
      <Status tone="muted" icon={Trash2Icon}>
        Deleted
      </Status>
    </span>
  ) : (
    <Link
      href={`/settings/departments/${department.id}`}
      className="font-medium text-primary underline-offset-4 hover:underline"
    >
      {department.name}
    </Link>
  );
}

function RowActions({ department }: { department: DepartmentResponseDto }) {
  const { can } = useViewer();
  const refresh = useDepartmentCache();
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null);
  const menu = useMenuHandoff();

  const restore = async () => {
    try {
      await departmentsControllerRestoreV1(department.id);
      toast.success(`${department.name} restored.`);
      void refresh();
    } catch (error) {
      toastError('Couldn’t restore it', refusalText(error));
    }
  };

  if (department.deletedAt) {
    if (!can('department.delete')) return null;
    return (
      <Button
        variant="outline"
        size="sm"
        aria-label={`Restore ${department.name}`}
        onClick={() => void restore()}
      >
        <RotateCcwIcon aria-hidden />
        Restore
      </Button>
    );
  }

  const edit = can('department.update');
  const remove = can('department.delete');
  if (!edit && !remove) return null;
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Actions for ${department.name}`}
          >
            <EllipsisIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="shadow-md"
          onCloseAutoFocus={menu.onCloseAutoFocus}
        >
          {edit && (
            <DropdownMenuItem
              onSelect={() => menu.handOff(() => setDialog('edit'))}
            >
              Edit
            </DropdownMenuItem>
          )}
          {remove && (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => menu.handOff(() => setDialog('delete'))}
            >
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <DepartmentDialog
        department={department}
        open={dialog === 'edit'}
        onOpenChange={(open) => setDialog(open ? 'edit' : null)}
      />
      <DeleteDepartmentDialog
        department={department}
        open={dialog === 'delete'}
        onOpenChange={(open) => setDialog(open ? 'delete' : null)}
      />
    </>
  );
}

/** "Delete {name}?"; refused while it has members, saying how many. */
export function DeleteDepartmentDialog({
  department,
  open,
  onOpenChange,
  onDeleted,
}: {
  department: DepartmentResponseDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const refresh = useDepartmentCache();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${department.name}?`}
      description="It’s hidden from lists and can’t take new members. You can restore it later from Show deleted."
      confirmLabel="Delete"
      icon={Trash2Icon}
      onConfirm={async () => {
        try {
          await departmentsControllerRemoveV1(department.id);
          void refresh();
          onDeleted?.();
        } catch (error) {
          return (
            stillHasMembers(department, error) ??
            serverRefusal('Couldn’t delete it', error)
          );
        }
      }}
    />
  );
}

/** New department, or Edit {name}: the name (409 when taken) and description. */
export function DepartmentDialog({
  department,
  open,
  onOpenChange,
}: {
  department?: DepartmentResponseDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useDepartmentCache();
  const [name, setName] = useState(department?.name ?? '');
  const [description, setDescription] = useState(department?.description ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setNameError(null);
    const body = {
      name: name.trim(),
      description: description.trim() || null,
    };
    try {
      if (department) await departmentsControllerUpdateV1(department.id, body);
      else await departmentsControllerCreateV1(body);
      void refresh();
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setNameError(`A department named ${body.name} already exists.`);
      } else {
        setNameError(
          error instanceof ApiError
            ? asSentence(error.message)
            : refusalText(error),
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
      setName(department?.name ?? '');
      setDescription(department?.description ?? '');
      setNameError(null);
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
          onSubmit={(event) => void save(event)}
          noValidate
        >
          <DialogHeader>
            <DialogTitle>
              {department ? `Edit ${department.name}` : 'New department'}
            </DialogTitle>
          </DialogHeader>
          <Field
            id="department-name"
            label="Name"
            error={nameError}
            announce
            count={{ length: name.length, max: NAME_MAX }}
          >
            {(aria) => (
              <Input
                id="department-name"
                value={name}
                maxLength={NAME_MAX}
                onChange={(event) => setName(event.target.value)}
                {...aria}
              />
            )}
          </Field>
          <Field
            id="department-description"
            label="Description (optional)"
            description="What it covers, in a sentence."
            count={{ length: description.length, max: DESCRIPTION_MAX }}
          >
            {(aria) => (
              <Textarea
                id="department-description"
                value={description}
                maxLength={DESCRIPTION_MAX}
                onChange={(event) => setDescription(event.target.value)}
                {...aria}
              />
            )}
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={busy || name.trim().length < 2}>
              {department ? 'Save changes' : 'Create department'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
