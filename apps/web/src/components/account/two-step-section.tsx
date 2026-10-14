'use client';

import {
  ApiError,
  getSessionsControllerListV1QueryKey,
  getTwoFactorAuthControllerGetBackupCodesStatusV1QueryKey,
  twoFactorAuthControllerDisableV1,
  twoFactorAuthControllerRegenerateBackupCodesV1,
  useTwoFactorAuthControllerGetBackupCodesStatusV1,
} from '@synapsedesk/api-client';
import { useQueryClient } from '@tanstack/react-query';
import {
  CircleAlertIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
} from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/auth/field';
import { PasswordInput } from '@/components/auth/password-input';
import { RetryAlert } from '@/components/auth/retry-alert';
import { CodeSlots } from '@/components/auth/two-step-code';
import {
  BackupCodeList,
  ScanAndConfirm,
  useSetupSecret,
} from '@/components/auth/two-step-setup';
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
import { Badge } from '@/components/ui/badge';
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
import { Separator } from '@/components/ui/separator';
import { calendarDate } from '@/lib/format';
import { SectionCard } from './section-card';

/** What the server's refusal says, for a dialog's alert. */
type Refusal =
  | { kind: 'throttled'; seconds: number | null }
  | { kind: 'other'; message: string };

const refusalOf = (failed: unknown): Refusal =>
  failed instanceof ApiError && failed.status === 429
    ? { kind: 'throttled', seconds: failed.retryAfterSeconds }
    : {
        kind: 'other',
        message:
          failed instanceof Error ? failed.message : 'Something went wrong.',
      };

/**
 * Two-step verification: on, with its backup codes (regenerate) and a way to
 * turn it off, unless the organization requires it; or off, with a way to
 * turn it on. Each change takes the password, and a code to turn it off.
 */
export function TwoStepSection({
  enabled,
  required,
  organizationName,
}: {
  enabled: boolean;
  required: boolean;
  organizationName: string;
}) {
  const queryClient = useQueryClient();
  const [turningOn, setTurningOn] = useState(false);
  const changed = () => {
    void queryClient.invalidateQueries({ queryKey: ['/api/v1/users/me'] });
    void queryClient.invalidateQueries({
      queryKey: getTwoFactorAuthControllerGetBackupCodesStatusV1QueryKey(),
    });
    void queryClient.invalidateQueries({
      queryKey: getSessionsControllerListV1QueryKey(),
    });
  };

  if (!enabled) {
    return (
      <SectionCard
        title="Two-step verification"
        badge={<Badge variant="secondary">Off</Badge>}
        lead="Add a second step when you sign in, so a stolen password isn’t enough."
      >
        <Button className="self-start" onClick={() => setTurningOn(true)}>
          <ShieldCheckIcon />
          Turn on
        </Button>
        <TurnOnDialog
          open={turningOn}
          onOpenChange={setTurningOn}
          onEnabled={changed}
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Two-step verification"
      badge={
        <Badge variant="success">
          <ShieldCheckIcon aria-hidden />
          On
        </Badge>
      }
    >
      <BackupCodesRow onRegenerated={changed} />
      <Separator />
      <TurnOffRow
        required={required}
        organizationName={organizationName}
        onDisabled={changed}
      />
    </SectionCard>
  );
}

function Row({
  title,
  detail,
  detailId,
  children,
}: {
  title: string;
  detail: React.ReactNode;
  detailId?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{title}</span>
        <span id={detailId} className="text-muted-foreground">
          {detail}
        </span>
      </div>
      {children}
    </div>
  );
}

function BackupCodesRow({ onRegenerated }: { onRegenerated: () => void }) {
  const status = useTwoFactorAuthControllerGetBackupCodesStatusV1();
  const [confirming, setConfirming] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const counts = status.data?.data;

  return (
    <Row
      title="Backup codes"
      detail={
        counts
          ? `${counts.remaining} of ${counts.remaining + counts.used} left${
              counts.expiresAt
                ? ` · They expire on ${calendarDate(counts.expiresAt)}.`
                : '.'
            }`
          : '…'
      }
    >
      <Button variant="outline" onClick={() => setConfirming(true)}>
        <RefreshCwIcon />
        Regenerate codes
      </Button>
      <RegenerateDialog
        open={confirming}
        onOpenChange={setConfirming}
        onRegenerated={(fresh) => {
          setConfirming(false);
          setCodes(fresh);
          onRegenerated();
        }}
      />
      <NewCodesDialog codes={codes} onDone={() => setCodes(null)} />
    </Row>
  );
}

/** Asks for the password before the current codes stop working. */
function RegenerateDialog({
  open,
  onOpenChange,
  onRegenerated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRegenerated: (codes: string[]) => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  const close = (next: boolean) => {
    if (!next) {
      setPassword('');
      setError(null);
      setRefusal(null);
    }
    onOpenChange(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password) {
      setError('Enter your password.');
      return passwordRef.current?.focus();
    }
    setBusy(true);
    setError(null);
    setRefusal(null);
    try {
      const answer = await twoFactorAuthControllerRegenerateBackupCodesV1({
        password,
      });
      setPassword('');
      onRegenerated(answer.data?.backupCodes ?? []);
    } catch (failed) {
      if (failed instanceof ApiError && failed.status === 401) {
        setError('That’s not your current password.');
        passwordRef.current?.focus();
      } else {
        setRefusal(refusalOf(failed));
      }
    }
    setBusy(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent>
        <form
          noValidate
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-4"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate backup codes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your current codes stop working right away. Enter your password to
              continue.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <RefusalAlert refusal={refusal} onOver={() => setRefusal(null)} />
          <Field id="regenerate-password" label="Password" error={error}>
            {(aria) => (
              <PasswordInput
                ref={passwordRef}
                id="regenerate-password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                {...aria}
              />
            )}
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <Button
              type="submit"
              variant="destructive"
              disabled={busy}
              aria-busy={busy || undefined}
            >
              <RefreshCwIcon />
              Regenerate codes
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The new codes, shown once. Nothing dismisses it until the codes are saved:
 * not Escape, not a click outside, and Done waits for the box.
 */
function NewCodesDialog({
  codes,
  onDone,
}: {
  codes: string[] | null;
  onDone: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const hold = (event: Event) => {
    if (!saved) event.preventDefault();
  };

  return (
    <Dialog
      open={codes !== null}
      onOpenChange={(open) => {
        if (!open && saved) {
          setSaved(false);
          onDone();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={hold}
        onInteractOutside={hold}
      >
        <DialogHeader>
          <DialogTitle>Your new backup codes</DialogTitle>
          <DialogDescription>
            Each code works once. This is the only time you’ll see them.
          </DialogDescription>
        </DialogHeader>
        <BackupCodeList
          codes={codes ?? []}
          saved={saved}
          onSavedChange={setSaved}
          label="I’ve saved my new backup codes"
        />
        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={!saved}>Done</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TurnOffRow({
  required,
  organizationName,
  onDisabled,
}: {
  required: boolean;
  organizationName: string;
  onDisabled: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Row
      title="Turn off two-step verification"
      detailId="turn-off-detail"
      detail={
        required
          ? `${organizationName} requires two-step verification, so you can’t turn it off.`
          : 'You’ll need your password and a code from your app.'
      }
    >
      <Button
        variant="destructive-outline"
        disabled={required}
        aria-describedby={required ? 'turn-off-detail' : undefined}
        onClick={() => setOpen(true)}
      >
        <ShieldOffIcon />
        Turn off
      </Button>
      <TurnOffDialog
        open={open}
        onOpenChange={setOpen}
        organizationName={organizationName}
        onDisabled={() => {
          setOpen(false);
          toast.success('Two-step verification is off');
          onDisabled();
        }}
      />
    </Row>
  );
}

/**
 * Turning two-step off takes the password and a code from the app. An
 * organization that requires two-step refuses (a 400), and the dialog then
 * only closes.
 */
function TurnOffDialog({
  open,
  onOpenChange,
  organizationName,
  onDisabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationName: string;
  onDisabled: () => void;
}) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<{ password?: string; code?: string }>({});
  const [refusal, setRefusal] = useState<Refusal | 'required' | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const close = (next: boolean) => {
    if (!next) {
      setPassword('');
      setCode('');
      setError({});
      setRefusal(null);
    }
    onOpenChange(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = {
      password: password ? undefined : 'Enter your password.',
      code: code.length === 6 ? undefined : 'Enter the 6-digit code.',
    };
    setError(found);
    if (found.password) return passwordRef.current?.focus();
    if (found.code) return codeRef.current?.focus();

    setBusy(true);
    setRefusal(null);
    try {
      await twoFactorAuthControllerDisableV1({ password, code });
      close(false);
      onDisabled();
    } catch (failed) {
      if (failed instanceof ApiError && failed.status === 401) {
        // The server doesn't say which of the two was wrong.
        setError({ code: 'Check your password and the code, then try again.' });
        setCode('');
        codeRef.current?.focus();
      } else if (failed instanceof ApiError && failed.status === 400) {
        setRefusal('required');
      } else {
        setRefusal(refusalOf(failed));
      }
    }
    setBusy(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent>
        <form
          noValidate
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-4"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off two-step verification?</AlertDialogTitle>
            <AlertDialogDescription>
              Signing in will need only your password. Enter your password and a
              code from your app to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {refusal === 'required' ? (
            <Alert variant="destructive" role="alert">
              <CircleAlertIcon />
              <AlertTitle>
                {organizationName} requires two-step verification
              </AlertTitle>
              <AlertDescription>
                You can’t turn it off while your organization requires it.
              </AlertDescription>
            </Alert>
          ) : (
            <RefusalAlert refusal={refusal} onOver={() => setRefusal(null)} />
          )}
          <Field id="turn-off-password" label="Password" error={error.password}>
            {(aria) => (
              <PasswordInput
                ref={passwordRef}
                id="turn-off-password"
                autoComplete="current-password"
                autoFocus
                disabled={refusal === 'required'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                {...aria}
              />
            )}
          </Field>
          <div className="flex flex-col gap-2">
            <Label htmlFor="turn-off-code">Code from your app</Label>
            <CodeSlots
              id="turn-off-code"
              label="Code from your app"
              inputRef={codeRef}
              value={code}
              onChange={setCode}
              invalid={Boolean(error.code)}
              describedBy={error.code ? 'turn-off-code-error' : undefined}
              disabled={refusal === 'required'}
              autoFocus={false}
              spaced
            />
            {error.code && (
              <p
                id="turn-off-code-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {error.code}
              </p>
            )}
          </div>
          <AlertDialogFooter>
            {refusal === 'required' ? (
              <AlertDialogCancel type="button" autoFocus>
                Close
              </AlertDialogCancel>
            ) : (
              <>
                <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={busy}
                  aria-busy={busy || undefined}
                >
                  <ShieldOffIcon />
                  Turn off
                </Button>
              </>
            )}
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Turning two-step on, signed in: sign-in's setup steps in one dialog. Once
 * the codes are shown, nothing dismisses it until they're saved.
 */
function TurnOnDialog({
  open,
  onOpenChange,
  onEnabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEnabled: () => void;
}) {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const hold = (event: Event) => {
    if (codes && !saved) event.preventDefault();
  };

  const close = (next: boolean) => {
    if (next) return onOpenChange(true);
    if (codes && !saved) return;
    if (codes) onEnabled();
    setCodes(null);
    setSaved(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        showCloseButton={!codes}
        onEscapeKeyDown={hold}
        onInteractOutside={hold}
      >
        {codes ? (
          <>
            <DialogHeader>
              <p className="text-xs text-muted-foreground">Step 2 of 2</p>
              <DialogTitle>Save your backup codes</DialogTitle>
              <DialogDescription>
                If you lose your phone, each code lets you sign in once. This is
                the only time you’ll see them.
              </DialogDescription>
            </DialogHeader>
            <BackupCodeList
              codes={codes}
              saved={saved}
              onSavedChange={setSaved}
              label="I’ve saved my backup codes somewhere safe"
            />
            <DialogFooter>
              <Button disabled={!saved} onClick={() => close(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          open && <ScanStep onEnabled={setCodes} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ScanStep({ onEnabled }: { onEnabled: (codes: string[]) => void }) {
  const { secret, failed } = useSetupSecret();

  return (
    <>
      <DialogHeader>
        <p className="text-xs text-muted-foreground">Step 1 of 2</p>
        <DialogTitle>Turn on two-step verification</DialogTitle>
        <DialogDescription>
          Scan this QR code with an authenticator app.
        </DialogDescription>
      </DialogHeader>
      {failed ? (
        <Alert variant="destructive" role="alert">
          <CircleAlertIcon />
          <AlertTitle>Couldn’t start setup</AlertTitle>
          <AlertDescription>{failed}</AlertDescription>
        </Alert>
      ) : (
        <ScanAndConfirm
          secret={secret}
          spaced
          onEnabled={(enabled) => onEnabled(enabled.codes)}
          actions={(busy) => (
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="submit"
                disabled={busy || !secret}
                aria-busy={busy || undefined}
              >
                Verify and continue
              </Button>
            </DialogFooter>
          )}
        />
      )}
    </>
  );
}

function RefusalAlert({
  refusal,
  onOver,
}: {
  refusal: Refusal | null;
  onOver: () => void;
}) {
  if (refusal?.kind === 'throttled') {
    return (
      <RetryAlert
        title="Too many attempts"
        what="this is paused"
        seconds={refusal.seconds}
        onOver={onOver}
      />
    );
  }
  if (refusal?.kind === 'other') {
    return (
      <Alert variant="destructive" role="alert">
        <CircleAlertIcon />
        <AlertTitle>Something went wrong</AlertTitle>
        <AlertDescription>{refusal.message}</AlertDescription>
      </Alert>
    );
  }
  return null;
}
