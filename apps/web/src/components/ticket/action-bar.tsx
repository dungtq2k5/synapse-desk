'use client';

import {
  ticketsControllerAssignToSelfV1,
  ticketsControllerAssignV1,
  ticketsControllerRemoveV1,
  ticketsControllerRestoreV1,
  ticketsControllerUnassignV1,
  type TicketResponseDto,
} from '@synapsedesk/api-client';
import { TICKET_STATUS_TRANSITIONS } from '@synapsedesk/contracts';
import {
  ChevronDownIcon,
  EllipsisIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
  UserIcon,
  UserMinusIcon,
  UserPlusIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Toolbar } from 'radix-ui';
import { useState } from 'react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/tickets/badges';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useViewer } from '@/hooks/use-viewer';
import { STATUS_LABEL, statusMoves, type StatusMove } from '@/lib/tickets';
import { toastError } from '@/lib/toast';
import { AssignDialog } from './assign-dialog';
import { EditDialog } from './edit-dialog';
import { StatusDialog } from './status-dialog';
import { serverMessage, useDepartments, useTicketCache } from './use-directory';

/**
 * What an agent can do to a ticket, as one toolbar: Tab enters it once and
 * the arrow keys move inside. Each action shows only with its permission;
 * at phone width Edit moves into More.
 */
export function ActionBar({ ticket }: { ticket: TicketResponseDto }) {
  const { user, can, departmentIds } = useViewer();
  const departments = useDepartments();
  const refresh = useTicketCache(ticket.id);
  const router = useRouter();
  const [move, setMove] = useState<StatusMove | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const status = ticket.status;
  const moves = status
    ? statusMoves(status, TICKET_STATUS_TRANSITIONS).filter(
        (item) => item.permission === null || can(item.permission),
      )
    : [];
  const assigned = Boolean(ticket.currentAssigneeId);
  const mine = assigned && ticket.currentAssigneeId === user?.id;
  const selfDepartments = departmentIds
    .map((id) => ({
      id,
      name: departments.names.get(id) ?? 'Unknown department',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const canSelf =
    can('ticket.assign.self') && !mine && selfDepartments.length > 0;
  const canAssign = assigned ? can('ticket.reassign') : can('ticket.assign');
  const canUnassign = assigned && can('ticket.assign');
  const canEdit = can('ticket.update');
  const canDelete = can('ticket.delete');
  const hasMore = canEdit || canUnassign || canDelete;

  const assignToMe = async (department: { id: string; name: string }) => {
    try {
      await ticketsControllerAssignToSelfV1(ticket.id, {
        departmentId: department.id,
      });
      toast.success(`Assigned to you in ${department.name}`);
      refresh();
    } catch (error) {
      toastError('Couldn’t assign the ticket', serverMessage(error));
    }
  };

  const unassign = async () => {
    const previous = {
      assigneeId: ticket.currentAssigneeId!,
      departmentId: ticket.currentDepartmentId!,
      name: ticket.assignee?.fullName ?? 'Unknown user',
    };
    try {
      await ticketsControllerUnassignV1(ticket.id);
      refresh();
      toast.success(`Ticket #${ticket.ticketNumber} is unassigned`, {
        action: {
          label: 'Undo',
          onClick: () => void undoUnassign(previous),
        },
      });
    } catch (error) {
      toastError('Couldn’t assign the ticket', serverMessage(error));
    }
  };

  const undoUnassign = async (previous: {
    assigneeId: string;
    departmentId: string;
    name: string;
  }) => {
    try {
      await ticketsControllerAssignV1(ticket.id, {
        assigneeId: previous.assigneeId,
        departmentId: previous.departmentId,
      });
      toast.success(`Assigned to ${previous.name}`);
      refresh();
    } catch (error) {
      toastError('Couldn’t assign the ticket', serverMessage(error));
    }
  };

  const remove = async () => {
    const number = ticket.ticketNumber;
    try {
      await ticketsControllerRemoveV1(ticket.id);
      refresh();
      router.push('/tickets');
      toast.success(`Ticket #${number} deleted`, {
        action: {
          label: 'Undo',
          onClick: () => void restore(ticket.id, number, refresh),
        },
      });
    } catch (error) {
      toastError('Couldn’t delete the ticket', serverMessage(error));
    }
  };

  return (
    <>
      <Toolbar.Root
        aria-label="Ticket actions"
        className="flex flex-wrap items-center gap-2"
      >
        {moves.length > 0 && status && (
          <DropdownMenu>
            <Toolbar.Button asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Status: ${STATUS_LABEL[status]}. Change status`}
                >
                  <span className="text-muted-foreground">Status</span>
                  <StatusBadge status={status} />
                  <ChevronDownIcon aria-hidden />
                </Button>
              </DropdownMenuTrigger>
            </Toolbar.Button>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Move to</DropdownMenuLabel>
              {moves.map((item) => (
                <DropdownMenuItem key={item.to} onSelect={() => setMove(item)}>
                  {item.item}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {canSelf &&
          (selfDepartments.length === 1 ? (
            <Toolbar.Button asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void assignToMe(selfDepartments[0])}
              >
                <UserIcon aria-hidden />
                Assign to me
              </Button>
            </Toolbar.Button>
          ) : (
            <DropdownMenu>
              <Toolbar.Button asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <UserIcon aria-hidden />
                    Assign to me
                    <ChevronDownIcon aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
              </Toolbar.Button>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Assign to me in</DropdownMenuLabel>
                {selfDepartments.map((department) => (
                  <DropdownMenuItem
                    key={department.id}
                    onSelect={() => void assignToMe(department)}
                  >
                    {department.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ))}

        {canAssign && (
          <Toolbar.Button asChild>
            <Button
              variant="outline"
              size="sm"
              aria-haspopup="dialog"
              onClick={() => setAssigning(true)}
            >
              <UserPlusIcon aria-hidden />
              {assigned ? 'Reassign…' : 'Assign…'}
            </Button>
          </Toolbar.Button>
        )}

        {canEdit && (
          <Toolbar.Button asChild>
            <Button
              variant="outline"
              size="sm"
              className="hidden sm:inline-flex"
              aria-haspopup="dialog"
              onClick={() => setEditing(true)}
            >
              <PencilIcon aria-hidden />
              Edit
            </Button>
          </Toolbar.Button>
        )}

        {hasMore && (
          <DropdownMenu>
            <Toolbar.Button asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="More actions"
                  // Only Edit would be in it, and Edit is on the bar.
                  className={
                    !canUnassign && !canDelete ? 'sm:hidden' : undefined
                  }
                >
                  <EllipsisIcon aria-hidden />
                </Button>
              </DropdownMenuTrigger>
            </Toolbar.Button>
            <DropdownMenuContent align="end">
              {canEdit && (
                <DropdownMenuItem
                  className="sm:hidden"
                  onSelect={() => setEditing(true)}
                >
                  <PencilIcon aria-hidden />
                  Edit ticket
                </DropdownMenuItem>
              )}
              {canUnassign && (
                <DropdownMenuItem onSelect={() => void unassign()}>
                  <UserMinusIcon aria-hidden />
                  Unassign
                </DropdownMenuItem>
              )}
              {canDelete && (
                <>
                  {(canEdit || canUnassign) && (
                    <DropdownMenuSeparator
                      className={!canUnassign ? 'sm:hidden' : undefined}
                    />
                  )}
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setDeleting(true)}
                  >
                    <Trash2Icon aria-hidden />
                    Delete ticket
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </Toolbar.Root>

      <StatusDialog
        ticket={ticket}
        move={move}
        onOpenChange={(open) => !open && setMove(null)}
        onMoved={refresh}
      />
      {canAssign && (
        <AssignDialog
          ticket={ticket}
          open={assigning}
          onOpenChange={setAssigning}
          onAssigned={refresh}
        />
      )}
      {canEdit && (
        <EditDialog
          ticket={ticket}
          open={editing}
          onOpenChange={setEditing}
          onSaved={refresh}
        />
      )}
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {`Delete ticket #${ticket.ticketNumber}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              It disappears from the ticket list for everyone. Someone who can
              delete tickets can restore it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={() => void remove()}>
              <Trash2Icon aria-hidden />
              Delete ticket
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Restores a deleted ticket and says so. */
async function restore(
  ticketId: string,
  ticketNumber: number,
  refresh: (
    answer?: Awaited<ReturnType<typeof ticketsControllerRestoreV1>>,
  ) => void,
) {
  try {
    refresh(await ticketsControllerRestoreV1(ticketId));
    toast.success(`Ticket #${ticketNumber} restored`);
  } catch (error) {
    toastError('Couldn’t restore the ticket', serverMessage(error));
  }
}

/** In place of the action bar on a deleted ticket. */
export function DeletedNotice({ ticket }: { ticket: TicketResponseDto }) {
  const { can } = useViewer();
  const refresh = useTicketCache(ticket.id);
  const [busy, setBusy] = useState(false);
  return (
    <Alert variant="warning">
      <Trash2Icon aria-hidden />
      <AlertTitle>This ticket is deleted</AlertTitle>
      {can('ticket.delete') && (
        <AlertDescription className="flex flex-col items-start gap-2">
          It’s hidden from the ticket list. Restore it to bring it back.
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void restore(ticket.id, ticket.ticketNumber, refresh).finally(
                () => setBusy(false),
              );
            }}
          >
            <RotateCcwIcon aria-hidden />
            Restore ticket
          </Button>
        </AlertDescription>
      )}
    </Alert>
  );
}
