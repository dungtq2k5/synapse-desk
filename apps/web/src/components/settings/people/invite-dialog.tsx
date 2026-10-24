'use client';

import {
  ApiError,
  invitationsControllerCreateV1,
  invitationsControllerPreviewBatchV1,
  useOrganizationsControllerGetUsageV1,
  type PreviewInvitationsResponseDto,
} from '@synapsedesk/api-client';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  SendIcon,
  UserPlusIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { MultiSelect } from '@/components/documents/multi-select';
import { useDepartmentNames } from '@/components/documents/parts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useViewer } from '@/hooks/use-viewer';
import { asSentence } from '@/lib/documents';
import { EMAIL } from '@/lib/sign-in';
import { cn } from '@/lib/utils';
import { refusalText } from './person-dialogs';
import { useOrganizationName, usePeopleCache, useRoles } from './shared';

/** The server's per-address reasons, as the preview and the result say them. */
const PREVIEW_REASON: Record<string, string> = {
  'An invitation is already pending':
    'An invitation is already pending. Resend it from Invitations instead.',
  'Already has an account here': 'Already has an account here.',
};
const RESULT_REASON: [RegExp, string][] = [
  [/already pending/i, 'Not sent: an invitation is already pending.'],
  [/already has an account/i, 'Not sent: already has an account here.'],
  [/no seats/i, 'Not sent: no seats left.'],
];

function resultReason(reason: string): string {
  return (
    RESULT_REASON.find(([pattern]) => pattern.test(reason))?.[1] ??
    `Not sent: ${asSentence(reason).replace(/^./, (first) => first.toLowerCase())}`
  );
}

type Step =
  | { kind: 'compose' }
  | { kind: 'preview'; preview: PreviewInvitationsResponseDto }
  | {
      kind: 'result';
      sent: string[];
      notSent: { email: string; reason: string }[];
    };

/** "Invite people", and the dialog it opens. */
export function InviteButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlusIcon aria-hidden />
        Invite people
      </Button>
      <InviteDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

/**
 * Invite several people at once: addresses, roles and departments for the
 * batch with one primary, the seats left, then a preview the server checks,
 * then the result. Too few seats stops the send, with a way to the plan.
 */
function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { can } = useViewer();
  const refresh = usePeopleCache();
  const organization = useOrganizationName();
  const { roles, names: roleNames } = useRoles();
  const departments = useDepartmentNames();
  const usage = useOrganizationsControllerGetUsageV1({
    query: { enabled: open && can('organization.read') },
  });
  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [primary, setPrimary] = useState('');
  const [errors, setErrors] = useState<{ emails?: string; primary?: string }>(
    {},
  );
  const [step, setStep] = useState<Step>({ kind: 'compose' });
  const [tooFew, setTooFew] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const seats = usage.data?.data?.seats;
  const seatsLeft =
    step.kind === 'preview'
      ? Math.max(0, step.preview.maxAgentSeats - step.preview.seatsInUse)
      : seats?.available && seats.limit !== null && seats.used !== null
        ? Math.max(0, seats.limit - seats.used)
        : null;

  const reset = () => {
    setEmails([]);
    setDraft('');
    setRoleIds([]);
    setDepartmentIds([]);
    setPrimary('');
    setErrors({});
    setStep({ kind: 'compose' });
    setTooFew(false);
    setFailure(null);
  };

  const take = (text: string) => {
    const typed = text
      .split(/[\s,;]+/)
      .map((each) => each.trim().toLowerCase())
      .filter(Boolean);
    if (typed.length === 0) return;
    setEmails((current) => [
      ...current,
      ...typed.filter((each) => !current.includes(each)),
    ]);
    setDraft('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', ',', ' ', 'Tab'].includes(event.key) && draft.trim()) {
      event.preventDefault();
      take(draft);
    } else if (event.key === 'Backspace' && !draft && emails.length > 0) {
      setEmails(emails.slice(0, -1));
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    take(event.clipboardData.getData('text'));
  };

  const batch = (addresses: string[]) =>
    addresses.map((email) => ({
      email,
      roleIds,
      departmentIds,
      primaryDepartmentId: primary || null,
    }));

  const preview = async () => {
    const all = draft.trim() ? [...emails, draft.trim().toLowerCase()] : emails;
    if (draft.trim()) take(draft);
    const found: typeof errors = {};
    const bad = all.find((email) => !EMAIL.test(email));
    if (all.length === 0) found.emails = 'Add at least one email address.';
    else if (bad) found.emails = `${bad} isn’t an email address.`;
    if (departmentIds.length > 0 && !departmentIds.includes(primary)) {
      found.primary = 'Choose a primary department.';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setFailure(null);
    try {
      const answer = await invitationsControllerPreviewBatchV1({
        invitations: batch(all),
      });
      if (answer.data) {
        setStep({ kind: 'preview', preview: answer.data });
        setTooFew(answer.data.seatOverrun > 0);
      }
    } catch (error) {
      setFailure(refusalText(error));
    } finally {
      setBusy(false);
    }
  };

  const send = async (current: PreviewInvitationsResponseDto) => {
    const ready = current.rows.filter((row) => row.ok).map((row) => row.email);
    setBusy(true);
    setFailure(null);
    try {
      const answer = await invitationsControllerCreateV1({
        invitations: batch(ready),
      });
      const created = answer.data?.created ?? [];
      setStep({
        kind: 'result',
        sent: created.map((invitation) => invitation.email),
        notSent: [
          ...current.rows
            .filter((row) => !row.ok)
            .map((row) => ({ email: row.email, reason: row.reason ?? '' })),
          ...(answer.data?.failed ?? []),
        ],
      });
      void refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status === 402) setTooFew(true);
      else setFailure(refusalText(error));
    } finally {
      setBusy(false);
    }
  };

  const rolesLine = roleIds.map((id) => roleNames.get(id) ?? id).join(', ');
  const departmentsLine = [
    ...(primary ? [`${departments.get(primary) ?? primary} (primary)`] : []),
    ...departmentIds
      .filter((id) => id !== primary)
      .map((id) => departments.get(id) ?? id),
  ].join(', ');

  const seatsAlert =
    seatsLeft === null ? null : tooFew && step.kind === 'preview' ? (
      <Alert variant="destructive">
        <CircleAlertIcon aria-hidden />
        <AlertTitle>Not enough seats</AlertTitle>
        <AlertDescription>
          {(() => {
            const inviting = step.preview.rows.filter((row) => row.ok).length;
            const over = inviting - seatsLeft;
            return `You’re inviting ${inviting} people and ${seatsLeft} seats are left. Remove ${over} ${over === 1 ? 'address' : 'addresses'}, revoke a pending invitation, or change the plan.`;
          })()}{' '}
          {can('organization.update') ? (
            <Link
              href="/settings/billing"
              className="font-medium underline underline-offset-4"
            >
              Plans and billing
            </Link>
          ) : (
            'Ask an administrator to change the plan.'
          )}
        </AlertDescription>
      </Alert>
    ) : (
      <Alert variant="info" role="status">
        <UsersIcon aria-hidden />
        <AlertTitle>
          {seatsLeft === 1 ? '1 seat left' : `${seatsLeft} seats left`}
        </AlertTitle>
        <AlertDescription>
          Each invitation holds a seat until it’s accepted or revoked.
        </AlertDescription>
      </Alert>
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        {step.kind === 'compose' && (
          <>
            <DialogHeader>
              <DialogTitle>Invite people</DialogTitle>
              <DialogDescription>
                They get an email with a link to join {organization}.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-emails">Email addresses</Label>
              <div
                className={cn(
                  'flex min-h-16 flex-wrap content-start items-center gap-1.5 rounded-md border border-input px-2 py-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
                  errors.emails && 'border-destructive',
                )}
              >
                {emails.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1 rounded-md bg-secondary py-0.5 pr-0.5 pl-2 text-xs font-medium text-secondary-foreground"
                  >
                    {email}
                    <button
                      type="button"
                      aria-label={`Remove ${email}`}
                      className="rounded-sm p-0.5 outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() =>
                        setEmails(emails.filter((each) => each !== email))
                      }
                    >
                      <XIcon aria-hidden className="size-3" />
                    </button>
                  </span>
                ))}
                <input
                  id="invite-emails"
                  value={draft}
                  placeholder={emails.length ? '' : 'name@company.com'}
                  aria-describedby={`invite-emails-help${errors.emails ? ' invite-emails-error' : ''}`}
                  aria-invalid={errors.emails ? true : undefined}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={onKeyDown}
                  onPaste={onPaste}
                  onBlur={() => take(draft)}
                  className="min-w-40 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
              <p
                id="invite-emails-help"
                className="text-sm text-muted-foreground"
              >
                Type or paste several, separated by commas, spaces or new lines.
              </p>
              {errors.emails && (
                <p
                  id="invite-emails-error"
                  className="text-sm text-destructive"
                >
                  {errors.emails}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-roles">Roles</Label>
              <MultiSelect
                id="invite-roles"
                label="Roles"
                placeholder="Add a role"
                options={roles.map((role) => ({
                  value: role.id,
                  label: role.name,
                }))}
                value={roleIds}
                onChange={setRoleIds}
                max={50}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="invite-departments">Departments</Label>
                <MultiSelect
                  id="invite-departments"
                  label="Departments"
                  options={[...departments].map(([id, name]) => ({
                    value: id,
                    label: name,
                  }))}
                  value={departmentIds}
                  onChange={(next) => {
                    setDepartmentIds(next);
                    if (!next.includes(primary)) setPrimary(next[0] ?? '');
                  }}
                  max={50}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="invite-primary">Primary department</Label>
                <Select
                  value={primary}
                  onValueChange={setPrimary}
                  disabled={departmentIds.length === 0}
                >
                  <SelectTrigger
                    id="invite-primary"
                    className="w-full"
                    aria-invalid={errors.primary ? true : undefined}
                    aria-describedby={
                      errors.primary ? 'invite-primary-error' : undefined
                    }
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {departmentIds.map((id) => (
                      <SelectItem key={id} value={id}>
                        {departments.get(id) ?? id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.primary && (
                  <p
                    id="invite-primary-error"
                    className="text-sm text-destructive"
                  >
                    {errors.primary}
                  </p>
                )}
              </div>
            </div>
            {seatsAlert}
            {failure && <Failure text={failure} />}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button disabled={busy} onClick={() => void preview()}>
                Preview
                <ChevronRightIcon aria-hidden />
              </Button>
            </DialogFooter>
          </>
        )}
        {step.kind === 'preview' && (
          <>
            <DialogHeader>
              <DialogTitle>Check before sending</DialogTitle>
              <DialogDescription>
                {[rolesLine, departmentsLine].filter(Boolean).join(' · ')}
              </DialogDescription>
            </DialogHeader>
            <ul className="flex flex-col gap-2">
              {step.preview.rows.map((row) => {
                const unknown = [
                  ...row.unknownRoleIds.map(
                    (id) => `Unknown role: ${roleNames.get(id) ?? id}.`,
                  ),
                  ...row.unknownDepartmentIds.map(
                    (id) => `Unknown department: ${departments.get(id) ?? id}.`,
                  ),
                ];
                return (
                  <li
                    key={row.email}
                    className={cn(
                      'flex items-start gap-3 rounded-md border px-3 py-2 text-sm',
                      !row.ok && 'border-destructive-border',
                    )}
                  >
                    {row.ok ? (
                      <CircleCheckIcon
                        aria-hidden
                        className="mt-0.5 size-4 shrink-0 text-success"
                      />
                    ) : (
                      <CircleAlertIcon
                        aria-hidden
                        className="mt-0.5 size-4 shrink-0 text-destructive"
                      />
                    )}
                    <div className="flex min-w-0 flex-col">
                      <span className="break-all">{row.email}</span>
                      <span
                        className={
                          row.ok ? 'text-muted-foreground' : 'text-destructive'
                        }
                      >
                        {row.ok
                          ? unknown.length
                            ? unknown.join(' ')
                            : 'Ready to send'
                          : (PREVIEW_REASON[row.reason ?? ''] ??
                            asSentence(row.reason ?? ''))}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
            {seatsAlert}
            {failure && <Failure text={failure} />}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setStep({ kind: 'compose' })}
              >
                <ChevronLeftIcon aria-hidden />
                Back
              </Button>
              {(() => {
                const ready = step.preview.rows.filter((row) => row.ok).length;
                return (
                  <Button
                    disabled={busy || tooFew || ready === 0}
                    onClick={() => void send(step.preview)}
                  >
                    <SendIcon aria-hidden />
                    {ready === 1
                      ? 'Send 1 invitation'
                      : `Send ${ready} invitations`}
                  </Button>
                );
              })()}
            </DialogFooter>
          </>
        )}
        {step.kind === 'result' && (
          <>
            <DialogHeader>
              <DialogTitle>Invite people</DialogTitle>
            </DialogHeader>
            {step.sent.length > 0 && (
              <Alert variant="success">
                <CircleCheckIcon aria-hidden />
                <AlertTitle>
                  {step.sent.length === 1
                    ? '1 invitation sent'
                    : `${step.sent.length} invitations sent`}
                </AlertTitle>
                <AlertDescription>
                  They expire in 7 days. You can resend or revoke them from
                  Invitations.
                </AlertDescription>
              </Alert>
            )}
            <ul className="flex flex-col gap-3 text-sm">
              {step.sent.map((email) => (
                <li key={email} className="flex items-start gap-3">
                  <CircleCheckIcon
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-success"
                  />
                  <div className="flex flex-col">
                    <span className="break-all">{email}</span>
                    <span className="text-muted-foreground">Sent</span>
                  </div>
                </li>
              ))}
              {step.notSent.map(({ email, reason }) => (
                <li key={email} className="flex items-start gap-3">
                  <CircleXIcon
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-destructive"
                  />
                  <div className="flex flex-col">
                    <span className="break-all">{email}</span>
                    <span className="text-destructive">
                      {resultReason(reason)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <DialogClose asChild>
                <Button>Done</Button>
              </DialogClose>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Failure({ text }: { text: string }) {
  return (
    <Alert variant="destructive">
      <CircleAlertIcon aria-hidden />
      <AlertTitle>Couldn’t send the invitations</AlertTitle>
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  );
}
