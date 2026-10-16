import {
  ApiError,
  twoFactorAuthControllerAuthenticateV1,
} from '@synapsedesk/api-client';
import { CircleCheckIcon } from 'lucide-react';
import { useRef, useState, type SubmitEvent } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import { deviceName } from '@/lib/sign-in';
import { AuthCard } from './auth-card';
import { Field } from './field';
import { RetryAlert } from './retry-alert';

/**
 * The slots for a numeric code, split in two halves (6 is 3 + 3): an
 * authenticator app's code, or a code sent by email or text, whose length the
 * server says. `disabled` once the code can't be used any more.
 */
export function CodeSlots({
  value,
  onChange,
  onComplete,
  invalid,
  inputRef,
  describedBy,
  length = 6,
  disabled,
  spaced = false,
  autoFocus = true,
  id,
  label = 'Verification code',
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  invalid?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  describedBy?: string;
  length?: number;
  disabled?: boolean;
  /** Each digit its own box, as an emailed or texted code is shown. */
  spaced?: boolean;
  /** False where another field comes first, as a password does. */
  autoFocus?: boolean;
  /** For a visible `Label`'s `htmlFor`; `label` is then its text. */
  id?: string;
  label?: string;
}) {
  const half = Math.ceil(length / 2);
  const slots = (from: number, to: number) =>
    Array.from({ length: to - from }, (_, offset) => (
      <InputOTPSlot
        key={from + offset}
        index={from + offset}
        aria-invalid={invalid || undefined}
        className={
          spaced
            ? 'h-12 w-11 rounded-md border text-xl font-medium first:rounded-md last:rounded-md @max-[20rem]:w-9'
            : undefined
        }
      />
    ));
  const field = (
    <InputOTP
      ref={inputRef}
      maxLength={length}
      inputMode="numeric"
      pattern="^[0-9]*$"
      autoComplete="one-time-code"
      // The default ('increase-width') widens the hidden input past the slots
      // for a password manager's badge, and after a resize it pushes the page
      // 24px wider than a 390px phone.
      pushPasswordManagerStrategy="none"
      autoFocus={autoFocus}
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      disabled={disabled}
      id={id}
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
    >
      <InputOTPGroup className={spaced ? 'gap-2' : undefined}>
        {slots(0, half)}
      </InputOTPGroup>
      <InputOTPSeparator />
      <InputOTPGroup className={spaced ? 'gap-2' : undefined}>
        {slots(half, length)}
      </InputOTPGroup>
    </InputOTP>
  );
  // Spaced boxes need about 21rem (6 × 44px, the gaps, the dash). In a dialog
  // on a phone (under 20rem) they narrow rather than push it wider; the
  // container's width is what's measured, not the viewport's.
  return spaced ? <div className="@container w-full">{field}</div> : field;
}

/**
 * The two-step leg: a code from the app, or a backup code, and "remember this
 * device". A success may carry a `warning` (few backup codes left), which the
 * app shows; it is never dropped.
 */
export function TwoStepCode({
  justEnrolled,
  onSignedIn,
  onBack,
}: {
  /** Two-step setup just finished: say it's on. */
  justEnrolled: boolean;
  onSignedIn: (warning: string | null) => void;
  onBack: () => void;
}) {
  const [mode, setMode] = useState<'code' | 'backup'>('code');
  const [code, setCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [throttled, setThrottled] = useState<{ seconds: number | null } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);

  const verify = async (value: { code?: string; backupCode?: string }) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setThrottled(null);
    try {
      const answer = await twoFactorAuthControllerAuthenticateV1({
        ...value,
        rememberDevice: remember,
        deviceName: deviceName(navigator.userAgent),
      });
      onSignedIn(answer.data?.warning ?? null);
    } catch (failure) {
      setBusy(false);
      if (failure instanceof ApiError && failure.status === 429) {
        setThrottled({ seconds: failure.retryAfterSeconds });
        return;
      }
      setError(
        mode === 'code'
          ? 'That code is wrong or has expired. Enter the current code from your app.'
          : 'That backup code is wrong or has already been used.',
      );
      if (mode === 'code') {
        setCode('');
        codeRef.current?.focus();
      } else {
        backupRef.current?.focus();
      }
    }
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === 'code' && code.length === 6) void verify({ code });
    if (mode === 'backup' && backupCode.trim()) {
      void verify({ backupCode: backupCode.trim() });
    }
  };

  const switchMode = () => {
    setMode(mode === 'code' ? 'backup' : 'code');
    setError(null);
  };

  return (
    <AuthCard
      title="Two-step verification"
      lead={
        mode === 'code'
          ? 'Enter the 6-digit code from your authenticator app.'
          : 'Enter one of the backup codes you saved when you set up two-step verification.'
      }
    >
      {justEnrolled && (
        <Alert variant="success">
          <CircleCheckIcon />
          <AlertTitle>Two-step verification is on</AlertTitle>
          <AlertDescription>
            You’ll enter a code from your authenticator app when you sign in.
          </AlertDescription>
        </Alert>
      )}
      {throttled && (
        <RetryAlert
          title="Too many attempts"
          what="verification is paused"
          seconds={throttled.seconds}
          onOver={() => setThrottled(null)}
        />
      )}

      <form noValidate onSubmit={submit} className="flex flex-col gap-5">
        {mode === 'code' ? (
          <div className="flex flex-col gap-2">
            <CodeSlots
              inputRef={codeRef}
              value={code}
              onChange={setCode}
              onComplete={(value) => void verify({ code: value })}
              invalid={Boolean(error)}
              describedBy={error ? 'code-error' : undefined}
            />
            {error && (
              <p
                id="code-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {error}
              </p>
            )}
          </div>
        ) : (
          <Field
            announce
            id="backup-code"
            label="Backup code"
            description="Each code works once. Capitals and the dash are optional."
            error={error}
          >
            {(aria) => (
              <Input
                ref={backupRef}
                id="backup-code"
                autoComplete="one-time-code"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="XXXXX-XXXXX"
                className="font-mono"
                autoFocus
                value={backupCode}
                onChange={(event) => setBackupCode(event.target.value)}
                {...aria}
              />
            )}
          </Field>
        )}

        <div className="flex items-center gap-2">
          <Checkbox
            id="remember-device"
            checked={remember}
            onCheckedChange={(checked) => setRemember(checked === true)}
          />
          <Label htmlFor="remember-device">Remember this device</Label>
        </div>

        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Verifying…' : 'Verify'}
        </Button>
      </form>

      <div className="flex flex-col items-start gap-2 text-sm">
        <Button variant="link" className="h-auto p-0" onClick={switchMode}>
          {mode === 'code'
            ? 'Use a backup code instead'
            : 'Use your authenticator app instead'}
        </Button>
        <Button variant="link" className="h-auto p-0" onClick={onBack}>
          Back to sign in
        </Button>
      </div>
    </AuthCard>
  );
}
