'use client';

import {
  ticketsControllerAssignV1,
  ticketsControllerReassignV1,
  ticketsControllerUpdateV1,
  type AssignTicketDtoReason,
  type TicketResponseDto,
  type UpdateTicketDtoPriority,
} from '@synapsedesk/api-client';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/auth/field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useViewer } from '@/hooks/use-viewer';
import { ASSIGNMENT_REASON_LABEL, PRIORITY_LABEL } from '@/lib/tickets';
import { toastError } from '@/lib/toast';
import { serverMessage, useDepartments, usePeopleIn } from './use-directory';

type Reason = NonNullable<AssignTicketDtoReason>;
type Priority = NonNullable<UpdateTicketDtoPriority>;

/** The AI's suggested routing, for the agent to check before assigning. */
export type Suggestion = {
  departmentId: string;
  priority: Priority | null;
  confidence: number;
};

/**
 * Assign or reassign: a department, a person in it, and why. Assign stays
 * disabled until a person is chosen. On a reassign, changing the department
 * sets the reason to "Department change"; the agent can pick another.
 */
export function AssignDialog({
  ticket,
  open,
  onOpenChange,
  onAssigned,
  suggestion,
}: {
  ticket: TicketResponseDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssigned: () => void;
  /** Opened from the AI's routing: its department, and its priority to apply. */
  suggestion?: Suggestion;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        {open && (
          <AssignForm
            ticket={ticket}
            suggestion={suggestion}
            onDone={() => {
              onAssigned();
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AssignForm({
  ticket,
  suggestion,
  onDone,
}: {
  ticket: TicketResponseDto;
  suggestion?: Suggestion;
  onDone: () => void;
}) {
  const { can } = useViewer();
  const reassign = Boolean(ticket.currentAssigneeId);
  const departments = useDepartments();
  const [departmentId, setDepartmentId] = useState(
    suggestion?.departmentId ?? ticket.currentDepartmentId ?? '',
  );
  const offerPriority =
    suggestion?.priority &&
    suggestion.priority !== ticket.priority &&
    can('ticket.update')
      ? suggestion.priority
      : null;
  const [setPriority, setSetPriority] = useState(true);
  const [assigneeId, setAssigneeId] = useState('');
  const moved = reassign && departmentId !== ticket.currentDepartmentId;
  const [reason, setReason] = useState<Reason>(
    moved ? 'DEPARTMENT_CHANGE' : reassign ? 'MANUAL' : 'INITIAL',
  );
  const [reasonSet, setReasonSet] = useState(moved);
  const [busy, setBusy] = useState(false);
  const people = usePeopleIn(departmentId || null);
  const departmentName = departments.names.get(departmentId) ?? null;

  const chooseDepartment = (id: string) => {
    setDepartmentId(id);
    setAssigneeId('');
    if (reassign && id !== ticket.currentDepartmentId) {
      setReason('DEPARTMENT_CHANGE');
      setReasonSet(true);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!departmentId || !assigneeId) return;
    setBusy(true);
    const call = reassign
      ? ticketsControllerReassignV1
      : ticketsControllerAssignV1;
    try {
      await call(ticket.id, { assigneeId, departmentId, reason });
      if (offerPriority && setPriority) {
        await ticketsControllerUpdateV1(ticket.id, { priority: offerPriority });
      }
      const person = people.items.find((item) => item.user.id === assigneeId);
      toast.success(`Assigned to ${person?.user.fullName ?? 'Unknown user'}`);
      onDone();
    } catch (error) {
      toastError('Couldn’t assign the ticket', serverMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-busy={busy || undefined}
      className="flex flex-col gap-4"
    >
      <DialogHeader>
        <DialogTitle>
          {`${reassign && !suggestion ? 'Reassign' : 'Assign'} ticket #${ticket.ticketNumber}`}
        </DialogTitle>
        <DialogDescription>
          {suggestion
            ? `Suggested by AI: ${
                departments.names.get(suggestion.departmentId) ??
                'Unknown department'
              }${
                suggestion.priority
                  ? `, ${PRIORITY_LABEL[suggestion.priority]}`
                  : ''
              } (${Math.round(suggestion.confidence * 100)}%). Check it before you assign.`
            : reassign
              ? `Currently ${ticket.assignee?.fullName ?? 'Unknown user'} in ${
                  ticket.department?.name ?? 'Unknown department'
                }.`
              : 'Choose who handles this ticket.'}
        </DialogDescription>
      </DialogHeader>

      <Field id="assign-department" label="Department">
        {(aria) => (
          <Select value={departmentId} onValueChange={chooseDepartment}>
            <SelectTrigger
              id="assign-department"
              autoFocus
              className="w-full"
              {...aria}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {departments.items.map((department) => (
                <SelectItem key={department.id} value={department.id}>
                  {department.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      <Field
        id="assign-person"
        label="Assignee"
        description={
          departmentName
            ? `People in ${departmentName} who can take tickets.`
            : undefined
        }
      >
        {(aria) => (
          <Select
            value={assigneeId}
            onValueChange={setAssigneeId}
            disabled={!departmentId}
          >
            <SelectTrigger id="assign-person" className="w-full" {...aria}>
              <SelectValue placeholder="Choose a person" />
            </SelectTrigger>
            <SelectContent position="popper">
              {people.items.map(({ user }) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      <Field
        id="assign-reason"
        label="Reason"
        description={
          reasonSet
            ? 'Set because the department changed. You can pick another reason.'
            : undefined
        }
      >
        {(aria) => (
          <Select
            value={reason}
            onValueChange={(value) => {
              setReason(value as Reason);
              setReasonSet(false);
            }}
          >
            <SelectTrigger id="assign-reason" className="w-full" {...aria}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {Object.entries(ASSIGNMENT_REASON_LABEL).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      {offerPriority && (
        <div className="flex items-center gap-2">
          <Checkbox
            id="assign-priority"
            checked={setPriority}
            onCheckedChange={(checked) => setSetPriority(checked === true)}
          />
          <Label htmlFor="assign-priority" className="font-normal">
            Also set the priority to {PRIORITY_LABEL[offerPriority]}
          </Label>
        </div>
      )}

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={busy}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={busy || !assigneeId}>
          {reassign && !suggestion ? 'Reassign' : 'Assign'}
        </Button>
      </DialogFooter>
    </form>
  );
}
