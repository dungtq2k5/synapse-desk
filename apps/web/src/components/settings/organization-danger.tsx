'use client';

import {
  organizationsControllerRequestOffboardV1,
  type OrganizationResponseDto,
} from '@synapsedesk/api-client';
import { CircleAlertIcon, Trash2Icon } from 'lucide-react';
import { useId, useState } from 'react';
import { Field } from '@/components/auth/field';
import { serverMessage } from '@/components/ticket/use-directory';
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toastError } from '@/lib/toast';

const REASON_MAX = 500;

/** Where the admin lands once everyone, them included, is signed out. */
export function afterDeleting(name: string): string {
  return `/login?organization-deleted=${encodeURIComponent(name)}`;
}

/**
 * Delete this organization: the strongest confirmation in the product. The
 * answer signs everyone out, the admin included, so the page goes to sign-in,
 * which says why.
 */
export function DangerZone({
  organization,
}: {
  organization: OrganizationResponseDto;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="danger-heading" className="max-w-2xl">
      <div className="flex flex-col gap-5 rounded-xl border border-destructive-border bg-card p-6 text-card-foreground shadow-sm">
        <header className="flex flex-col gap-1">
          <h2
            id="danger-heading"
            className="text-base font-semibold text-destructive"
          >
            Delete this organization
          </h2>
          <p className="text-sm text-muted-foreground">Danger zone</p>
        </header>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">
            Freezes {organization.name} and signs everyone out at once, you
            included. A platform administrator finishes the deletion later, or
            reverses it.
          </p>
          <Button
            variant="destructive"
            className="w-fit shrink-0"
            onClick={() => setOpen(true)}
          >
            <Trash2Icon aria-hidden />
            Delete organization
          </Button>
        </div>
      </div>
      <DeleteOrganizationDialog
        organization={organization}
        open={open}
        onOpenChange={setOpen}
      />
    </section>
  );
}

function DeleteOrganizationDialog({
  organization,
  open,
  onOpenChange,
}: {
  organization: OrganizationResponseDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const mismatchId = useId();
  const matches = typed === organization.name;
  const ready = reason.trim().length > 0 && matches;

  const remove = async () => {
    setBusy(true);
    try {
      await organizationsControllerRequestOffboardV1({ reason: reason.trim() });
      // Every session ended with that answer, this one too.
      window.location.assign(afterDeleting(organization.name));
    } catch (error) {
      setBusy(false);
      toastError('Couldn’t delete the organization', serverMessage(error));
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason('');
          setTyped('');
        }
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {organization.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This is the strongest step there is. Read what happens, then
            confirm.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden />
          <AlertTitle>What happens</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              <li>
                {organization.name} is frozen at once: no tickets, answers or
                sign-ins.
              </li>
              <li>Everyone is signed out now, you included.</li>
              <li>
                A platform administrator finishes the deletion later, or
                reverses it.
              </li>
            </ul>
          </AlertDescription>
        </Alert>
        <Field
          id="delete-reason"
          label="Why are you deleting it?"
          count={{ length: reason.length, max: REASON_MAX }}
        >
          {(aria) => (
            <Textarea
              id="delete-reason"
              value={reason}
              maxLength={REASON_MAX}
              onChange={(event) => setReason(event.target.value)}
              {...aria}
            />
          )}
        </Field>
        <div className="flex flex-col gap-2">
          <Field
            id="delete-name"
            label={`Type ${organization.name} to confirm`}
          >
            {(aria) => (
              <Input
                id="delete-name"
                value={typed}
                autoComplete="off"
                onChange={(event) => setTyped(event.target.value)}
                {...aria}
                aria-describedby={matches ? undefined : mismatchId}
              />
            )}
          </Field>
          <span id={mismatchId} className="sr-only">
            The name doesn’t match yet
          </span>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={!ready || busy}
            onClick={() => void remove()}
          >
            <Trash2Icon aria-hidden />
            Delete organization
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
