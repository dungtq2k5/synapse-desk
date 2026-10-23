'use client';

import {
  platformControllerOffboardV1,
  platformControllerResetBillingCycleV1,
  platformControllerRestoreV1,
  platformControllerSetStatusV1,
} from '@synapsedesk/api-client';
import { OrgStatus } from '@synapsedesk/contracts';
import { CircleAlertIcon, LockIcon, TriangleAlertIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/auth/field';
import {
  ConfirmDialog,
  type Refusal,
} from '@/components/settings/confirm-dialog';
import { serverMessage } from '@/components/ticket/use-directory';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { announce } from '@/lib/toast';
import {
  consequence,
  count,
  reachable,
  statusAction,
  STATUS_WORDS,
  type ConsoleStatus,
} from '@/lib/platform';
import { ConsoleStatusBadge } from './badges';
import { ReasonField } from './fields';

const REASON_REQUIRED = 'A reason is required.';

type Subject = { id: string; name: string; people: number };

/** A refusal the console doesn't know, in the server's words with a period. */
const refusalOf = (error: unknown): Refusal => ({
  title: 'That didn’t go through',
  description: serverMessage(error).replace(/!$/, '.'),
});

/**
 * Change an organization's status: only the statuses it can reach, each
 * with what it does, and a reason. The main button names the change, and is
 * destructive for Frozen. Freezing says how many sessions it ended.
 */
export function StatusDialog({
  organization,
  status,
  open,
  onOpenChange,
  onChanged,
}: {
  organization: Subject;
  status: ConsoleStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const options = reachable(status);
  const [to, setTo] = useState<OrgStatus | null>(options[0] ?? null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const labelId = useId();

  const reset = (next: boolean) => {
    if (!next) {
      setTo(options[0] ?? null);
      setReason('');
      setError(null);
    }
    onOpenChange(next);
  };

  const confirm = async (): Promise<Refusal | false | void> => {
    if (!reason.trim()) {
      setError(REASON_REQUIRED);
      document.getElementById('status-reason')?.focus();
      return false;
    }
    if (!to) return false;
    try {
      const answer = await platformControllerSetStatusV1(organization.id, {
        status: to,
        reason: reason.trim(),
      });
      const signedOut = answer.data?.revokedSessionCount ?? 0;
      toast.success(`${organization.name} is ${STATUS_WORDS[to]}`, {
        description:
          to === OrgStatus.FROZEN
            ? `${count(signedOut, 'session')} were signed out.`
            : undefined,
      });
      onChanged();
      reset(false);
    } catch (failed) {
      if (/isn.t possible|Cannot move/i.test(serverMessage(failed))) {
        return {
          title: `That status change isn’t possible from ${STATUS_WORDS[status]}.`,
          description: '',
        };
      }
      return refusalOf(failed);
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={reset}
      title={`Change ${organization.name}’s status`}
      description={`It’s ${STATUS_WORDS[status]}. It can move to:`}
      confirmLabel={to ? statusAction(to, organization.name) : 'Change status'}
      icon={to === OrgStatus.FROZEN ? LockIcon : undefined}
      destructive={to === OrgStatus.FROZEN}
      onConfirm={confirm}
    >
      <RadioGroup
        aria-labelledby={labelId}
        value={to ?? ''}
        onValueChange={(value) => setTo(value as OrgStatus)}
        className="gap-3"
      >
        <span id={labelId} className="sr-only">
          New status
        </span>
        {options.map((option) => (
          <div key={option} className="flex items-start gap-3">
            <RadioGroupItem
              value={option}
              id={`status-${option}`}
              aria-describedby={`status-${option}-what`}
              className="mt-1"
            />
            <div className="flex flex-col gap-1">
              <Label htmlFor={`status-${option}`} className="w-fit">
                <ConsoleStatusBadge status={option} />
              </Label>
              <p
                id={`status-${option}-what`}
                className="text-sm text-muted-foreground"
              >
                {consequence(option)}
              </p>
            </div>
          </div>
        ))}
      </RadioGroup>
      <ReasonField
        id="status-reason"
        value={reason}
        onChange={(value) => {
          setReason(value);
          if (value.trim()) setError(null);
        }}
        error={error}
      />
    </ConfirmDialog>
  );
}

/** Reset the billing cycle: break glass, with what it does and a reason. */
export function ResetCycleDialog({
  organization,
  allowance,
  open,
  onOpenChange,
  onReset,
}: {
  organization: Subject;
  /** "$10.00": the fresh allowance. */
  allowance: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReset: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const confirm = async (): Promise<Refusal | false | void> => {
    if (!reason.trim()) {
      setError(REASON_REQUIRED);
      document.getElementById('reset-reason')?.focus();
      return false;
    }
    try {
      await platformControllerResetBillingCycleV1(organization.id, {
        reason: reason.trim(),
      });
      announce(`Billing cycle reset for ${organization.name}.`);
      toast.success(`Billing cycle reset for ${organization.name}.`);
      setReason('');
      onReset();
    } catch (failed) {
      return refusalOf(failed);
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason('');
          setError(null);
        }
        onOpenChange(next);
      }}
      title={`Reset ${organization.name}’s billing cycle?`}
      description={`Its AI allowance starts again today, with a fresh ${allowance}. Its cycle stops matching Stripe’s invoice period, and the allowance and the invoice disagree until Stripe’s next event for it.`}
      confirmLabel="Reset the cycle"
      onConfirm={confirm}
    >
      <Alert variant="warning">
        <TriangleAlertIcon aria-hidden />
        <AlertTitle>Break glass</AlertTitle>
        <AlertDescription>
          Use it when an organization is blocked by its allowance today. To
          change what it pays for, change its plan instead.
        </AlertDescription>
      </Alert>
      <ReasonField
        id="reset-reason"
        value={reason}
        onChange={(value) => {
          setReason(value);
          if (value.trim()) setError(null);
        }}
        error={error}
      />
    </ConfirmDialog>
  );
}

/**
 * Offboard: what happens to whom, a reason, and the name typed. The button's
 * unavailability is explained by the field's description.
 */
export function OffboardDialog({
  organization,
  open,
  onOpenChange,
  onOffboarded,
}: {
  organization: Subject;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOffboarded: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const matches = typed.trim() === organization.name;

  const confirm = async (): Promise<Refusal | false | void> => {
    if (!reason.trim()) {
      setError(REASON_REQUIRED);
      document.getElementById('offboard-reason')?.focus();
      return false;
    }
    if (!matches) {
      document.getElementById('offboard-name')?.focus();
      return false;
    }
    try {
      const answer = await platformControllerOffboardV1(organization.id, {
        reason: reason.trim(),
      });
      toast.success(`${organization.name} is offboarded`, {
        description: `${count(answer.data?.revokedSessionCount ?? 0, 'session')} were signed out.`,
      });
      setReason('');
      setTyped('');
      onOffboarded();
    } catch (failed) {
      return refusalOf(failed);
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason('');
          setTyped('');
          setError(null);
        }
        onOpenChange(next);
      }}
      title={`Offboard ${organization.name}?`}
      description="It stops working for everyone in it, at once."
      confirmLabel={`Offboard ${organization.name}`}
      onConfirm={confirm}
    >
      <Alert variant="destructive">
        <CircleAlertIcon aria-hidden />
        <AlertTitle>What happens</AlertTitle>
        <AlertDescription>
          {`Its ${organization.people.toLocaleString('en-US')} people are signed out now and can’t sign in. Its data is kept, and its address and domain stay reserved, so it can be restored from this console.`}
        </AlertDescription>
      </Alert>
      <ReasonField
        id="offboard-reason"
        value={reason}
        onChange={(value) => {
          setReason(value);
          if (value.trim()) setError(null);
        }}
        error={error}
      />
      <Field
        id="offboard-name"
        label={`Type ${organization.name} to confirm`}
        description={
          matches ? undefined : (
            <span className="sr-only">The name doesn’t match yet</span>
          )
        }
      >
        {(aria) => (
          <Input
            id="offboard-name"
            autoComplete="off"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            {...aria}
          />
        )}
      </Field>
    </ConfirmDialog>
  );
}

/** Restore: it comes back as it was; nobody's sessions do. */
export function RestoreDialog({
  organization,
  open,
  onOpenChange,
  onRestored,
}: {
  organization: Subject;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Restore ${organization.name}?`}
      description={`It comes back as it was, with its ${organization.people.toLocaleString('en-US')} people, plan and data. Nobody’s sessions come back: everyone signs in again.`}
      confirmLabel={`Restore ${organization.name}`}
      destructive={false}
      onConfirm={async () => {
        try {
          await platformControllerRestoreV1(organization.id);
          announce(`${organization.name} is restored`);
          toast.success(`${organization.name} is restored`);
          onRestored();
        } catch (failed) {
          return refusalOf(failed);
        }
      }}
    />
  );
}
