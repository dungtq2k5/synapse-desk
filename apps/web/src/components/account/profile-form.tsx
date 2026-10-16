'use client';

import {
  usersControllerUpdateOwnProfileV1,
  UpdateOwnProfileDtoGender,
  type UserResponseDto,
} from '@synapsedesk/api-client';
import { useQueryClient } from '@tanstack/react-query';
import {
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  LockIcon,
  PlusIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRef, useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/auth/field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { isoDate, usDate } from '@/lib/format';
import { PhoneDialog } from './phone-dialog';
import { ProfilePhoto } from './profile-photo';
import { useLeaveGuard } from './use-leave-guard';

const GENDERS = [
  [UpdateOwnProfileDtoGender.FEMALE, 'Female'],
  [UpdateOwnProfileDtoGender.MALE, 'Male'],
  [UpdateOwnProfileDtoGender.OTHER, 'Other'],
  [UpdateOwnProfileDtoGender.UNSPECIFIED, 'Prefer not to say'],
] as const;

type Draft = { fullName: string; dob: string; gender: string };

const draftOf = (user: UserResponseDto): Draft => ({
  fullName: user.fullName,
  dob: user.dob ? usDate(user.dob) : '',
  gender: user.gender ?? '',
});

/**
 * How you appear to your team: the photo, your name, the email (fixed), the
 * phone number (through its own dialog), date of birth and gender. Saving says
 * where it is (Unsaved changes, Saving…, Saved), and leaving with unsaved
 * changes asks first.
 */
export function ProfileForm({ user }: { user: UserResponseDto }) {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState<Draft>(() => draftOf(user));
  const [draft, setDraft] = useState<Draft>(saved);
  const [errors, setErrors] = useState<{ fullName?: string; dob?: string }>({});
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [failed, setFailed] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const dobRef = useRef<HTMLInputElement>(null);

  const dirty =
    draft.fullName !== saved.fullName ||
    draft.dob !== saved.dob ||
    draft.gender !== saved.gender;
  const guard = useLeaveGuard(dirty);
  const edit = (change: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...change }));
    setStatus('idle');
  };

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dirty) return;
    const dob = draft.dob.trim() ? isoDate(draft.dob) : null;
    const found = {
      fullName:
        draft.fullName.trim().length >= 2
          ? undefined
          : 'Enter your full name (at least 2 characters).',
      dob:
        draft.dob.trim() && !dob ? 'Enter a date like 03/14/1990.' : undefined,
    };
    setErrors(found);
    if (found.fullName) return nameRef.current?.focus();
    if (found.dob) return dobRef.current?.focus();

    setStatus('saving');
    setFailed(false);
    try {
      const answer = await usersControllerUpdateOwnProfileV1({
        fullName: draft.fullName.trim(),
        dob,
        gender: draft.gender
          ? (draft.gender as UpdateOwnProfileDtoGender)
          : null,
      });
      const next = answer.data ? draftOf(answer.data) : draft;
      setSaved(next);
      setDraft(next);
      setStatus('saved');
      toast.success('Profile saved');
      void queryClient.invalidateQueries({ queryKey: ['/api/v1/users/me'] });
    } catch {
      setStatus('idle');
      setFailed(true);
    }
  };

  return (
    <>
      <Card className="max-w-2xl">
        <CardContent>
          <ProfilePhoto user={user} />
          <Separator className="my-6" />
          <form
            noValidate
            onSubmit={(event) => void submit(event)}
            className="flex flex-col gap-6"
          >
            {failed && (
              <Alert variant="destructive" role="alert">
                <CircleAlertIcon />
                <AlertTitle>Couldn’t save your profile</AlertTitle>
                <AlertDescription>
                  Your changes are still here. Try again.
                </AlertDescription>
              </Alert>
            )}
            <div className="max-w-md">
              <Field id="full-name" label="Full name" error={errors.fullName}>
                {(aria) => (
                  <Input
                    ref={nameRef}
                    id="full-name"
                    autoComplete="name"
                    value={draft.fullName}
                    onChange={(event) => edit({ fullName: event.target.value })}
                    {...aria}
                  />
                )}
              </Field>
            </div>
            <EmailField user={user} />
            <PhoneField user={user} onEdit={() => setPhoneOpen(true)} />
            <div className="max-w-60">
              <Field id="dob" label="Date of birth" error={errors.dob}>
                {(aria) => (
                  <Input
                    ref={dobRef}
                    id="dob"
                    inputMode="numeric"
                    placeholder="MM/DD/YYYY"
                    value={draft.dob}
                    onChange={(event) => edit({ dob: event.target.value })}
                    {...aria}
                  />
                )}
              </Field>
            </div>
            <div className="flex max-w-60 flex-col gap-2">
              <Label htmlFor="gender">Gender</Label>
              <Select
                value={draft.gender}
                onValueChange={(gender) => edit({ gender })}
              >
                <SelectTrigger id="gender" className="w-full">
                  <SelectValue placeholder="Choose one" />
                </SelectTrigger>
                <SelectContent>
                  {GENDERS.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-end gap-3">
              <p
                aria-live="polite"
                className="flex items-center gap-1.5 text-sm text-muted-foreground"
              >
                {status === 'saving' && 'Saving…'}
                {status === 'saved' && (
                  <>
                    <CheckIcon aria-hidden className="size-4" />
                    Saved
                  </>
                )}
                {status === 'idle' && dirty && 'Unsaved changes'}
              </p>
              <Button
                type="submit"
                disabled={!dirty || status === 'saving'}
                aria-busy={status === 'saving' || undefined}
              >
                Save changes
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <PhoneDialog
        open={phoneOpen}
        onOpenChange={setPhoneOpen}
        current={user.isPhoneVerified ? user.phoneNumber : null}
      />
      <AlertDialog
        open={guard.pending !== null}
        onOpenChange={(open) => !open && guard.stay()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You’ve changed your profile but haven’t saved it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={guard.leave}>
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Verified or not, as a word and an icon, never color alone. */
function VerifiedBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <Badge variant="success">
      <CircleCheckIcon aria-hidden />
      Verified
    </Badge>
  ) : (
    <Badge variant="warning">
      <TriangleAlertIcon aria-hidden />
      Not verified
    </Badge>
  );
}

function EmailField({ user }: { user: UserResponseDto }) {
  return (
    <div className="flex max-w-md flex-col gap-2">
      <div className="flex items-center gap-2">
        <Label htmlFor="email">Email</Label>
        <VerifiedBadge verified={user.isEmailVerified} />
      </div>
      <div className="relative">
        <Input
          id="email"
          type="email"
          readOnly
          value={user.email}
          aria-describedby="email-help"
          className="bg-muted pr-9 text-muted-foreground"
        />
        <LockIcon
          aria-hidden
          className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
      </div>
      <p id="email-help" className="text-sm text-muted-foreground">
        {user.isEmailVerified ? (
          'Your email can’t be changed.'
        ) : (
          <>
            Not verified yet. Verify it to invite people. Your email can’t be
            changed.{' '}
            <Link
              href="/verify-email?next=%2Fprofile"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Verify email
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

function PhoneField({
  user,
  onEdit,
}: {
  user: UserResponseDto;
  onEdit: () => void;
}) {
  const number = user.isPhoneVerified ? user.phoneNumber : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm leading-none font-medium">Phone number</span>
        {number && <VerifiedBadge verified />}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {number ? (
          <>
            <span>{number}</span>
            <Button type="button" variant="outline" size="sm" onClick={onEdit}>
              Change
            </Button>
          </>
        ) : (
          <>
            <span className="text-muted-foreground">
              No phone number added.
            </span>
            <Button type="button" variant="outline" size="sm" onClick={onEdit}>
              <PlusIcon />
              Add phone number
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
