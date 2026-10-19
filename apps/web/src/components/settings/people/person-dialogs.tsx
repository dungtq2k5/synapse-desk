'use client';

import {
  ApiError,
  userAdminControllerLockV1,
  userAdminControllerSetDepartmentsV1,
  userAdminControllerSetRolesV1,
} from '@synapsedesk/api-client';
import { LockIcon, PlusIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { Field } from '@/components/auth/field';
import { MultiSelect } from '@/components/documents/multi-select';
import { useDepartmentNames } from '@/components/documents/parts';
import { serverMessage } from '@/components/ticket/use-directory';
import { Button } from '@/components/ui/button';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { asSentence } from '@/lib/documents';
import { ConfirmDialog, RefusalAlert, type Refusal } from '../confirm-dialog';
import { useRoles } from './shared';

const REASON_MAX = 500;
const ROLES_MAX = 50;

/** Whether the server refused because this is the last active Org Admin. */
export function isLastAdmin(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    /last active org admin/i.test(error.message)
  );
}

/** "{name} is the last active Org Admin", with the fix for this action. */
export function lastAdminRefusal(name: string, fix: string): Refusal {
  return { title: `${name} is the last active Org Admin`, description: fix };
}

/** A refusal in the server's words, with its period. */
export function refusalText(error: unknown): string {
  return error instanceof ApiError
    ? asSentence(error.message)
    : serverMessage(error);
}

/** Any other refusal, in the server's words. */
export function serverRefusal(title: string, error: unknown): Refusal {
  return { title, description: refusalText(error) };
}

type Person = { id: string; fullName: string };

/**
 * Lock {name}: the reason (emailed to them) and until when, the consequence
 * first. The last active Org Admin is refused in words.
 */
export function LockDialog({
  person,
  open,
  onOpenChange,
  onDone,
}: {
  person: Person;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState<'unlocked' | 'date'>('unlocked');
  const [when, setWhen] = useState('');
  const [errors, setErrors] = useState<{ reason?: string; when?: string }>({});

  const reset = () => {
    setReason('');
    setUntil('unlocked');
    setWhen('');
    setErrors({});
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={`Lock ${person.fullName}?`}
      description="They’re signed out everywhere now and can’t sign in until the lock ends."
      confirmLabel="Lock"
      icon={LockIcon}
      onConfirm={async () => {
        const found: typeof errors = {};
        if (!reason.trim()) found.reason = 'Give a reason.';
        const lockedUntil = until === 'date' && when ? new Date(when) : null;
        if (until === 'date' && (!lockedUntil || lockedUntil <= new Date())) {
          found.when = 'Choose a time after now.';
        }
        setErrors(found);
        if (Object.keys(found).length > 0) return false;
        try {
          await userAdminControllerLockV1(person.id, {
            reason: reason.trim(),
            ...(lockedUntil ? { lockedUntil: lockedUntil.toISOString() } : {}),
          });
          reset();
          onDone();
        } catch (error) {
          return isLastAdmin(error)
            ? lastAdminRefusal(
                person.fullName,
                'Make someone else an Org Admin before locking this account.',
              )
            : serverRefusal('Couldn’t lock them', error);
        }
      }}
    >
      <Field
        id="lock-reason"
        label="Reason"
        description="Sent to them by email."
        error={errors.reason}
        count={{ length: reason.length, max: REASON_MAX }}
      >
        {(aria) => (
          <Textarea
            id="lock-reason"
            value={reason}
            maxLength={REASON_MAX}
            onChange={(event) => setReason(event.target.value)}
            {...aria}
          />
        )}
      </Field>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">How long</legend>
        <RadioGroup
          value={until}
          onValueChange={(value) => setUntil(value as typeof until)}
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem id="lock-until-unlocked" value="unlocked" />
            <Label htmlFor="lock-until-unlocked" className="font-normal">
              Until someone unlocks them
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id="lock-until-date" value="date" />
            <Label htmlFor="lock-until-date" className="font-normal">
              Until a date and time
            </Label>
          </div>
        </RadioGroup>
        {until === 'date' && (
          <Field id="lock-when" label="Date and time" error={errors.when}>
            {(aria) => (
              <Input
                id="lock-when"
                type="datetime-local"
                value={when}
                onChange={(event) => setWhen(event.target.value)}
                {...aria}
              />
            )}
          </Field>
        )}
      </fieldset>
    </ConfirmDialog>
  );
}

/** Replace someone's roles; the last active Org Admin keeps theirs. */
export function EditRolesDialog({
  person,
  roleIds,
  open,
  onOpenChange,
  onDone,
}: {
  person: Person;
  roleIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { roles } = useRoles();
  const [chosen, setChosen] = useState(roleIds);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setRefusal(null);
    try {
      await userAdminControllerSetRolesV1(person.id, { roleIds: chosen });
      onDone();
      onOpenChange(false);
    } catch (error) {
      setRefusal(
        isLastAdmin(error)
          ? lastAdminRefusal(
              person.fullName,
              'Make someone else an Org Admin before taking the role away from this account.',
            )
          : serverRefusal('Couldn’t save their roles', error),
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
      setChosen(roleIds);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setRefusal(null);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit roles</DialogTitle>
          <DialogDescription>{person.fullName}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="edit-roles">Roles</Label>
            <span className="text-xs text-muted-foreground">Up to 50</span>
          </div>
          <MultiSelect
            id="edit-roles"
            label="Roles"
            placeholder="Add a role"
            options={roles.map((role) => ({
              value: role.id,
              label: role.name,
            }))}
            value={chosen}
            onChange={setChosen}
            max={ROLES_MAX}
          />
        </div>
        {refusal && <RefusalAlert refusal={refusal} />}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button disabled={busy} onClick={() => void save()}>
            Save roles
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Membership = { departmentId: string; isPrimary: boolean };

/** Replace someone's departments, exactly one of them their primary. */
export function EditDepartmentsDialog({
  person,
  memberships,
  open,
  onOpenChange,
  onDone,
}: {
  person: Person;
  memberships: Membership[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const departments = useDepartmentNames();
  const [rows, setRows] = useState(memberships);
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState(false);
  const primary = rows.find((row) => row.isPrimary)?.departmentId ?? '';
  const addable = [...departments].filter(
    ([id]) => !rows.some((row) => row.departmentId === id),
  );

  const save = async () => {
    if (rows.length > 0 && !primary) {
      setError('Choose one primary department.');
      return;
    }
    setError(null);
    setBusy(true);
    setRefusal(null);
    try {
      await userAdminControllerSetDepartmentsV1(person.id, {
        departments: rows,
      });
      onDone();
      onOpenChange(false);
    } catch (failure) {
      setRefusal(serverRefusal('Couldn’t save their departments', failure));
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
      setRows(memberships);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setError(null);
        setRefusal(null);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit departments</DialogTitle>
          <DialogDescription>{person.fullName}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between text-sm font-medium">
            <span id="edit-departments-heading">Departments</span>
            <span>Primary</span>
          </div>
          <RadioGroup
            aria-label="Primary department"
            aria-describedby="edit-departments-help"
            value={primary}
            onValueChange={(id) =>
              setRows(
                rows.map((row) => ({
                  ...row,
                  isPrimary: row.departmentId === id,
                })),
              )
            }
            className="gap-0 rounded-md border"
          >
            {rows.map((row) => {
              const name =
                departments.get(row.departmentId) ?? 'Unknown department';
              return (
                <div
                  key={row.departmentId}
                  className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0"
                >
                  <span className="flex-1 text-sm">{name}</span>
                  <RadioGroupItem
                    value={row.departmentId}
                    aria-label={`${name} is their primary department`}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`Remove ${name}`}
                    onClick={() =>
                      setRows(
                        rows.filter(
                          (each) => each.departmentId !== row.departmentId,
                        ),
                      )
                    }
                  >
                    <XIcon aria-hidden />
                  </Button>
                </div>
              );
            })}
          </RadioGroup>
          {addable.length > 0 && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="w-fit">
                  <PlusIcon aria-hidden />
                  Add a department
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="shadow-md">
                {addable.map(([id, name]) => (
                  <DropdownMenuItem
                    key={id}
                    onSelect={() =>
                      setRows([
                        ...rows,
                        { departmentId: id, isPrimary: rows.length === 0 },
                      ])
                    }
                  >
                    {name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <p
            id="edit-departments-help"
            className="text-sm text-muted-foreground"
          >
            Exactly one department is their primary.
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        {refusal && <RefusalAlert refusal={refusal} />}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button disabled={busy} onClick={() => void save()}>
            Save departments
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
