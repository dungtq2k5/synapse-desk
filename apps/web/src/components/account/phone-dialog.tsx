'use client';

import {
  otpControllerRequestPhoneVerificationV1,
  otpControllerVerifyPhoneV1,
} from '@synapsedesk/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/auth/field';
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
import { Input } from '@/components/ui/input';
import { CodeEntry, SentTo } from './code-entry';
import { useCodeChallenge } from './use-code-challenge';

/** A number with its country code: `+`, then 7 to 15 digits. */
const PHONE = /^\+[1-9]\d{6,14}$/;

/**
 * Add or change the phone number: the number, then the texted code, in one
 * dialog. The current number stays until a new one is verified.
 */
export function PhoneDialog({
  open,
  onOpenChange,
  current,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The verified number now, when changing it. */
  current: string | null;
}) {
  const [number, setNumber] = useState<string | null>(null);

  const close = (next: boolean) => {
    if (!next) setNumber(null);
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        {number ? (
          <CodeStep
            number={number}
            onChangeNumber={() => setNumber(null)}
            onVerified={() => close(false)}
          />
        ) : (
          <NumberStep current={current} onSend={setNumber} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function NumberStep({
  current,
  onSend,
}: {
  current: string | null;
  onSend: (number: string) => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const number = value.replaceAll(/[\s()-]/g, '');
    if (!PHONE.test(number)) {
      return setError('Enter the number with its country code, like +1.');
    }
    onSend(number);
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>
          {current ? 'Change phone number' : 'Add a phone number'}
        </DialogTitle>
        <DialogDescription>
          {current
            ? 'Your current number stays until the new one is verified.'
            : 'We’ll text a 6-digit code to confirm it.'}
        </DialogDescription>
      </DialogHeader>
      {current && (
        <p className="text-sm">
          <span className="text-muted-foreground">Current: </span>
          {current}
        </p>
      )}
      <Field
        id="phone-number"
        label={current ? 'New phone number' : 'Phone number'}
        description="Include the country code."
        error={error}
      >
        {(aria) => (
          <Input
            id="phone-number"
            type="tel"
            autoComplete="tel"
            placeholder="+1 555 010 0199"
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            {...aria}
          />
        )}
      </Field>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit">Send code</Button>
      </DialogFooter>
    </form>
  );
}

function CodeStep({
  number,
  onChangeNumber,
  onVerified,
}: {
  number: string;
  onChangeNumber: () => void;
  onVerified: () => void;
}) {
  const queryClient = useQueryClient();
  const request = useCallback(
    async () =>
      (await otpControllerRequestPhoneVerificationV1({ phoneNumber: number }))
        .data,
    [number],
  );
  const state = useCodeChallenge({
    status: null,
    request,
    verify: async (code) => (await otpControllerVerifyPhoneV1({ code })).data,
    onVerified: () => {
      void queryClient.invalidateQueries({ queryKey: ['/api/v1/users/me'] });
      toast.success('Phone number verified');
      onVerified();
    },
  });

  return (
    <div className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Enter the code</DialogTitle>
        <DialogDescription>
          {state.challenge ? (
            <SentTo challenge={state.challenge} digits={false} />
          ) : (
            'Sending…'
          )}
        </DialogDescription>
      </DialogHeader>
      <CodeEntry
        state={state}
        after={
          <Button
            variant="link"
            className="h-auto self-start p-0"
            onClick={onChangeNumber}
          >
            Change number
          </Button>
        }
      />
    </div>
  );
}
