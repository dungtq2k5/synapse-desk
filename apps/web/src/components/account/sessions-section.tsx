'use client';

import {
  authControllerLogoutAllV1,
  getSessionsControllerListV1QueryKey,
  sessionsControllerRevokeAllTrustV1,
  sessionsControllerRevokeTrustV1,
  sessionsControllerRevokeV1,
  useSessionsControllerListV1,
  type SessionResponseDto,
} from '@synapsedesk/api-client';
import { useQueryClient } from '@tanstack/react-query';
import {
  LaptopIcon,
  LogOutIcon,
  MonitorIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
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
import { Skeleton } from '@/components/ui/skeleton';
import { calendarDate, calendarTime } from '@/lib/format';
import { deviceName } from '@/lib/sign-in';
import { toastError } from '@/lib/toast';
import { SectionCard } from './section-card';

/** The name a session goes by: the one given at sign-in, or its browser's. */
export const sessionName = (session: SessionResponseDto): string =>
  session.deviceName ?? deviceName(session.userAgent);

/** A session's device, by its browser's user agent. */
export function DeviceIcon({ userAgent }: { userAgent: string }) {
  const Icon = /iPhone|iPad|Android/.test(userAgent)
    ? SmartphoneIcon
    : /Mac OS X|Macintosh/.test(userAgent)
      ? LaptopIcon
      : MonitorIcon;
  return <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />;
}

/**
 * Where you're signed in: each session, this one marked, with its trust and
 * expiry. Another session can be signed out and any can lose its trust; this
 * one is left by signing out. Signing out everywhere asks first.
 */
export function SessionsSection() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const sessions = useSessionsControllerListV1();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const list = sessions.data?.data ?? [];

  const act = async (
    key: string,
    call: () => Promise<unknown>,
    done: string,
    failed: string,
  ) => {
    setBusy(key);
    try {
      await call();
      toast.success(done);
      await queryClient.invalidateQueries({
        queryKey: getSessionsControllerListV1QueryKey(),
      });
    } catch {
      toastError(failed, 'Check your connection and try again.');
    }
    setBusy(null);
  };

  const signOutEverywhere = async () => {
    setBusy('everywhere');
    try {
      const answer = await authControllerLogoutAllV1();
      queryClient.clear();
      router.push(
        `/login?signed-out-everywhere=${answer.data?.revokedSessionCount ?? 1}`,
      );
    } catch {
      setBusy(null);
      setConfirming(false);
      toastError(
        'Couldn’t sign out everywhere',
        'Check your connection and try again.',
      );
    }
  };

  return (
    <SectionCard title="Sessions" lead="Where you’re signed in.">
      {sessions.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <ul className="flex flex-col rounded-lg border">
          {list.map((session) => {
            const name = sessionName(session);
            const nameId = `session-${session.id}`;
            return (
              <li
                key={session.id}
                aria-labelledby={nameId}
                className="flex flex-wrap items-center gap-3 border-b p-4 last:border-b-0"
              >
                <DeviceIcon userAgent={session.userAgent} />
                <div className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span id={nameId} className="font-medium">
                      {name}
                    </span>
                    {session.current && (
                      <Badge variant="secondary">This device</Badge>
                    )}
                    {session.isTrusted && session.trustedUntil && (
                      <Badge className="bg-accent text-accent-foreground">
                        <ShieldCheckIcon aria-hidden />
                        Trusted until {calendarDate(session.trustedUntil)}
                      </Badge>
                    )}
                  </div>
                  <span className="text-muted-foreground">
                    {session.ipAddress} · Signed in{' '}
                    {calendarTime(session.createdAt)} · Expires{' '}
                    {calendarDate(session.expiresAt)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {session.isTrusted && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove trust from ${name}`}
                      disabled={busy !== null}
                      onClick={() =>
                        void act(
                          `trust-${session.id}`,
                          () => sessionsControllerRevokeTrustV1(session.id),
                          `${name} is no longer trusted`,
                          'Couldn’t remove trust',
                        )
                      }
                    >
                      Remove trust
                    </Button>
                  )}
                  {!session.current && (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Sign out of ${name}`}
                      disabled={busy !== null}
                      onClick={() =>
                        void act(
                          `revoke-${session.id}`,
                          () => sessionsControllerRevokeV1(session.id),
                          `Signed out of ${name}`,
                          'Couldn’t sign out that session',
                        )
                      }
                    >
                      <LogOutIcon />
                      Sign out
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {list.some((session) => session.isTrusted) && (
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() =>
              void act(
                'trust-all',
                () => sessionsControllerRevokeAllTrustV1(),
                'Trusted devices removed',
                'Couldn’t remove trusted devices',
              )
            }
          >
            Remove all trusted devices
          </Button>
        )}
        <Button
          variant="destructive-outline"
          disabled={busy !== null}
          onClick={() => setConfirming(true)}
        >
          <LogOutIcon />
          Sign out everywhere
        </Button>
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out everywhere?</AlertDialogTitle>
            <AlertDialogDescription>
              This ends every session, including this one. You’ll need to sign
              in again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={busy === 'everywhere'}
              aria-busy={busy === 'everywhere' || undefined}
              onClick={() => void signOutEverywhere()}
            >
              <LogOutIcon />
              Sign out everywhere
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
}
