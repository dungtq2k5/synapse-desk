import {
  ApiError,
  twoFactorAuthControllerActivateV1,
  twoFactorAuthControllerGenerateV1,
  type GenerateTwoFactorResponseDto,
} from '@synapsedesk/api-client';
import {
  CheckIcon,
  CircleAlertIcon,
  CopyIcon,
  DownloadIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { deviceName } from '@/lib/sign-in';
import { announce } from '@/lib/toast';
import { AuthCard } from './auth-card';
import { CodeSlots } from './two-step-code';

/**
 * The secret in an `otpauth://` URI, in groups of four for typing.
 *
 * @example manualKey('otpauth://totp/SynapseDesk:a?secret=JBSWY3DPEHPK3PXP') // 'JBSW Y3DP EHPK 3PXP'
 */
export function manualKey(otpauthUri: string): string {
  const secret = new URL(otpauthUri).searchParams.get('secret') ?? '';
  return secret.match(/.{1,4}/g)?.join(' ') ?? '';
}

/**
 * The secret to enrol, asked for once: a second one would replace the secret
 * the QR code shows.
 */
export function useSetupSecret() {
  const [secret, setSecret] = useState<GenerateTwoFactorResponseDto | null>(
    null,
  );
  const [failed, setFailed] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    twoFactorAuthControllerGenerateV1()
      .then((answer) => setSecret(answer.data ?? null))
      .catch((error: unknown) =>
        setFailed(error instanceof Error ? error.message : String(error)),
      );
  }, []);

  return { secret, failed };
}

/**
 * Two-step setup, for an organization that requires it (or a Super Admin,
 * who always must): scan the QR code
 * (or type the key), confirm with a code, then the backup codes, shown once.
 * Both calls are allowed on the sign-in challenge alone, which is what lets a
 * member with no second factor yet enrol. Confirming through the challenge
 * also signs the member in, so `onEnrolled` says whether a code is still due.
 */
export function TwoStepSetup({
  superAdmin = false,
  onEnrolled,
  onBack,
}: {
  /** A Super Admin, who must use it with no organization requiring it. */
  superAdmin?: boolean;
  onEnrolled: (signedIn: boolean) => void;
  onBack: () => void;
}) {
  const { secret, failed } = useSetupSecret();
  const [enabled, setEnabled] = useState<Enabled | null>(null);
  const [saved, setSaved] = useState(false);

  if (failed) {
    return (
      <AuthCard title="Set up two-step verification">
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Couldn’t start setup</AlertTitle>
          <AlertDescription>{failed}</AlertDescription>
        </Alert>
        <Button
          variant="link"
          className="h-auto self-start p-0"
          onClick={onBack}
        >
          Back to sign in
        </Button>
      </AuthCard>
    );
  }

  if (enabled) {
    return (
      <AuthCard
        above="Step 2 of 2"
        title="Save your backup codes"
        lead="If you lose your phone, each of these codes lets you sign in once."
      >
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertTitle>You won’t see these codes again</AlertTitle>
          <AlertDescription>
            Copy or download them now and keep them somewhere safe.
          </AlertDescription>
        </Alert>
        <BackupCodeList
          codes={enabled.codes}
          saved={saved}
          onSavedChange={setSaved}
          label="I’ve saved my backup codes somewhere safe"
        />
        <Button
          aria-disabled={!saved}
          className="aria-disabled:opacity-50"
          onClick={() => saved && onEnrolled(enabled.signedIn)}
        >
          Continue
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      above="Step 1 of 2"
      title="Set up two-step verification"
      lead={
        superAdmin
          ? 'Super Admins must use a second step when they sign in. Scan this QR code with an authenticator app.'
          : 'Your organization requires a second step when you sign in. Scan this QR code with an authenticator app.'
      }
      busy={!secret}
    >
      <ScanAndConfirm
        secret={secret}
        onEnabled={setEnabled}
        actions={(busy) => (
          <Button
            type="submit"
            disabled={busy || !secret}
            aria-busy={busy || undefined}
          >
            Verify and continue
          </Button>
        )}
      />
      <Button variant="link" className="h-auto self-start p-0" onClick={onBack}>
        Back to sign in
      </Button>
    </AuthCard>
  );
}

type Enabled = { codes: string[]; signedIn: boolean };

/**
 * The QR code, the key to type instead, and the code that confirms it: the
 * first step of setup, in the sign-in card or in a dialog. `actions` are the
 * form's buttons, given whether the code is being checked.
 */
export function ScanAndConfirm({
  secret,
  onEnabled,
  actions,
  spaced,
}: {
  secret: GenerateTwoFactorResponseDto | null;
  onEnabled: (enabled: Enabled) => void;
  actions: (busy: boolean) => React.ReactNode;
  spaced?: boolean;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const key = secret ? manualKey(secret.otpauthUri) : '';

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await twoFactorAuthControllerActivateV1({
        code,
        deviceName: deviceName(navigator.userAgent),
      });
      onEnabled({
        codes: answer.data?.backupCodes ?? [],
        signedIn: answer.data?.user != null,
      });
    } catch (failure) {
      setBusy(false);
      setError(
        failure instanceof ApiError && failure.status < 500
          ? 'That code didn’t match. Check the time on your phone is set automatically, then try the current code.'
          : failure instanceof Error
            ? failure.message
            : 'Something went wrong.',
      );
      setCode('');
      codeRef.current?.focus();
    }
  };

  const copyKey = async () => {
    await navigator.clipboard.writeText(key.replaceAll(' ', ''));
    setCopied(true);
    announce('Key copied');
  };

  return (
    <>
      <div className="flex justify-center">
        {secret ? (
          // Black on white in both themes, so a phone can scan it.
          <Image
            src={secret.qrCodeDataUrl}
            alt="QR code for setting up two-step verification"
            width={176}
            height={176}
            unoptimized
            className="rounded-md"
          />
        ) : (
          <Skeleton className="size-44" />
        )}
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <p className="text-muted-foreground">
          Can’t scan it? Enter this key in your app instead:
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-md bg-muted px-3 py-2 font-mono text-sm break-all select-all">
            {key}
          </code>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={copied ? 'Key copied' : 'Copy key'}
            disabled={!secret}
            onClick={() => void copyKey()}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        </div>
      </div>

      <form
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-5"
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="setup-code">
            Enter the 6-digit code from the app
          </Label>
          <CodeSlots
            id="setup-code"
            label="Enter the 6-digit code from the app"
            inputRef={codeRef}
            value={code}
            onChange={setCode}
            invalid={Boolean(error)}
            describedBy={error ? 'setup-code-error' : undefined}
            spaced={spaced}
          />
          {error && (
            <p
              id="setup-code-error"
              role="alert"
              className="text-sm text-destructive"
            >
              {error}
            </p>
          )}
        </div>
        {actions(busy)}
      </form>
    </>
  );
}

/**
 * Backup codes, shown once: the list, copy and download, and the box that
 * says they're saved. Whoever shows them decides what saving unlocks.
 */
export function BackupCodeList({
  codes,
  saved,
  onSavedChange,
  label,
}: {
  codes: string[];
  saved: boolean;
  onSavedChange: (saved: boolean) => void;
  label: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(codes.join('\n'));
    setCopied(true);
    toast.success('Backup codes copied', {
      description: 'Keep them somewhere safe, away from your phone.',
    });
  };

  const download = () => {
    const url = URL.createObjectURL(
      new Blob([`${codes.join('\n')}\n`], { type: 'text/plain' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'synapsedesk-backup-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <ul className="grid grid-cols-2 gap-2 rounded-md bg-muted p-4 font-mono text-sm">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>

      <div className="flex gap-2">
        <Button variant="outline" onClick={() => void copy()}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? 'Copied' : 'Copy codes'}
        </Button>
        <Button variant="outline" onClick={download}>
          <DownloadIcon />
          Download
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="codes-saved"
          checked={saved}
          onCheckedChange={(checked) => onSavedChange(checked === true)}
        />
        <Label htmlFor="codes-saved">{label}</Label>
      </div>
    </>
  );
}
