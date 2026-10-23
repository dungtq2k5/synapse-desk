'use client';

import {
  platformControllerAssignPlanV1,
  platformControllerReleasePlanV1,
  usePlatformControllerListPlansV1,
  type ApplyPlanResponseDto,
} from '@synapsedesk/api-client';
import { useQuery } from '@tanstack/react-query';
import { TriangleAlertIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/auth/field';
import {
  ConfirmDialog,
  type Refusal,
} from '@/components/settings/confirm-dialog';
import { serverMessage } from '@/components/ticket/use-directory';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { andList } from '@/lib/format';
import { changeLines, overLimitLine } from '@/lib/platform';
import { ReasonField } from './fields';

type Subject = { id: string; name: string };

const REASON_REQUIRED = 'A reason is required.';

/** The Free plan's name: never offered for assigning. */
const FREE = 'Free';

/** A refusal in the server's words, ending in a period. */
const refusalOf = (error: unknown): Refusal => ({
  title: 'That didn’t go through',
  description: serverMessage(error).replace(/!$/, '.'),
});

/**
 * What an assignment or a release would do to the organization: each change
 * in words, and each limit it would be over, said before the button.
 */
function Preview({
  name,
  preview,
  loading,
}: {
  name: string;
  preview: ApplyPlanResponseDto | undefined;
  loading: boolean;
}) {
  if (loading) return <Skeleton aria-hidden className="h-16 w-full" />;
  const row = preview?.subscribers[0];
  if (!row) return null;
  const lines = changeLines(row.changes, row.budgetDeferred);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-col gap-1">
        <span className="font-medium">What changes</span>
        {lines.length === 0 ? (
          <span className="text-muted-foreground">
            Nothing: its limits already match.
          </span>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </div>
      {row.overLimitItems.length > 0 && (
        <Alert variant="warning">
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>{`${name} will be over a limit after this`}</AlertTitle>
          <AlertDescription>
            {`${andList(row.overLimitItems.map(overLimitLine))}. It still changes: that’s your call to make here.`}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/**
 * Assign a negotiated plan: choose one (offered or not), see what it changes
 * and any limit it breaks, give a reason, assign. Checkout is closed to the
 * organization until it's released.
 */
export function AssignPlanDialog({
  organization,
  open,
  onOpenChange,
  onAssigned,
}: {
  organization: Subject;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssigned: () => void;
}) {
  const [planId, setPlanId] = useState<string>('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const plans = usePlatformControllerListPlansV1(
    { limit: 100, includeInactive: true, sortBy: 'name', sortOrder: 'ASC' },
    { query: { enabled: open } },
  );
  const negotiated = (plans.data?.data?.items ?? []).filter(
    (plan) => !plan.stripeProductId && plan.name !== FREE,
  );
  const chosen = negotiated.find((plan) => plan.id === planId);
  const preview = useQuery({
    queryKey: ['platform-assign-preview', organization.id, planId],
    queryFn: () =>
      platformControllerAssignPlanV1(
        organization.id,
        { planId },
        { dryRun: true },
      ),
    enabled: open && Boolean(planId),
    retry: false,
    staleTime: Infinity,
  });

  const reset = (next: boolean) => {
    if (!next) {
      setPlanId('');
      setReason('');
      setError(null);
    }
    onOpenChange(next);
  };

  const confirm = async (): Promise<Refusal | false | void> => {
    if (!chosen) {
      document.getElementById('assign-plan')?.focus();
      return false;
    }
    if (!reason.trim()) {
      setError(REASON_REQUIRED);
      document.getElementById('assign-reason')?.focus();
      return false;
    }
    try {
      await platformControllerAssignPlanV1(organization.id, {
        planId,
        reason: reason.trim(),
      });
      toast.success(`${organization.name} is on ${chosen.name}`);
      onAssigned();
      reset(false);
    } catch (failed) {
      return refusalOf(failed);
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={reset}
      title={`Assign a plan to ${organization.name}`}
      description={`Its limits become the plan’s, and applying the plan later reaches it. Checkout is closed to it until it’s released.`}
      confirmLabel={chosen ? `Assign ${chosen.name}` : 'Assign'}
      destructive={false}
      onConfirm={confirm}
    >
      <Field
        id="assign-plan"
        label="Plan"
        description="Negotiated plans: no Stripe product, offered or not."
      >
        {(aria) => (
          <Select value={planId} onValueChange={setPlanId}>
            <SelectTrigger id="assign-plan" className="w-full" {...aria}>
              <SelectValue placeholder="Choose a negotiated plan" />
            </SelectTrigger>
            <SelectContent className="shadow-md">
              {negotiated.map((plan) => (
                <SelectItem key={plan.id} value={plan.id}>
                  {plan.isActive ? plan.name : `${plan.name} (not offered)`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      {preview.isError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>{refusalOf(preview.error).description}</AlertTitle>
        </Alert>
      ) : (
        <Preview
          name={organization.name}
          preview={preview.data?.data}
          loading={Boolean(planId) && preview.isPending}
        />
      )}
      <ReasonField
        id="assign-reason"
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
 * Release to self-service: its limits become Free's, it leaves the plan, and
 * it can choose a plan in Billing. A pin stays as it is.
 */
export function ReleasePlanDialog({
  organization,
  planName,
  open,
  onOpenChange,
  onReleased,
}: {
  organization: Subject;
  planName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReleased: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const preview = useQuery({
    queryKey: ['platform-release-preview', organization.id],
    queryFn: () =>
      platformControllerReleasePlanV1(organization.id, {}, { dryRun: true }),
    enabled: open,
    retry: false,
    staleTime: Infinity,
  });

  const reset = (next: boolean) => {
    if (!next) {
      setReason('');
      setError(null);
    }
    onOpenChange(next);
  };

  const confirm = async (): Promise<Refusal | false | void> => {
    if (!reason.trim()) {
      setError(REASON_REQUIRED);
      document.getElementById('release-reason')?.focus();
      return false;
    }
    try {
      await platformControllerReleasePlanV1(organization.id, {
        reason: reason.trim(),
      });
      toast.success(`${organization.name} is released to self-service`);
      onReleased();
      reset(false);
    } catch (failed) {
      return refusalOf(failed);
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={reset}
      title={`Release ${organization.name} to self-service?`}
      description={`It leaves ${planName}: its limits become Free’s, and it can choose a plan in Billing.`}
      confirmLabel={`Release ${organization.name}`}
      destructive={false}
      onConfirm={confirm}
    >
      {preview.isError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>{refusalOf(preview.error).description}</AlertTitle>
        </Alert>
      ) : (
        <Preview
          name={organization.name}
          preview={preview.data?.data}
          loading={preview.isPending}
        />
      )}
      <ReasonField
        id="release-reason"
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
