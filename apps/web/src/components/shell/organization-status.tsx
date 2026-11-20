'use client';

import {
  getUsersControllerGetCurrentUserV1QueryKey,
  ORGANIZATION_STATUS_EVENT,
  useOrganizationsControllerGetV1,
} from '@synapsedesk/api-client';
import { useQueryClient } from '@tanstack/react-query';
import {
  ExternalLinkIcon,
  LockIcon,
  LogOutIcon,
  LifeBuoyIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Lockup } from '@/components/brand/lockup';
import { Button, buttonVariants } from '@/components/ui/button';
import { useOpenPortal } from '@/components/billing/use-open-portal';
import { useViewer } from '@/hooks/use-viewer';
import { useSupportEmail } from '@/lib/support';
import { announce, quietScreenErrors } from '@/lib/toast';
import { useSignOut } from './user-menu';

/**
 * The organization's status, from `/users/me`, which answers in every status.
 * The past-due banner and the frozen page both read it, and nothing else.
 */
export function useOrganizationStatus(): string | null {
  const { query } = useViewer();
  return query.data?.data?.organizationStatus ?? null;
}

/**
 * The one rule for a refusal that names the organization's status. The
 * browser fetcher raises an event for any such answer; this says it in the
 * deck's words and re-reads `/users/me`, so the banner or the frozen page
 * follows. A screen never recognizes a read-only or frozen refusal itself.
 */
export function useOrganizationStatusRefusals(): void {
  const queryClient = useQueryClient();
  const organization = useOrganizationsControllerGetV1({
    query: { retry: false },
  });
  const { can } = useViewer();
  const { open } = useOpenPortal();
  const name = organization.data?.data?.name ?? 'Your organization';
  const admin = can('organization.update');
  // What the listener says, kept current without re-subscribing it.
  const latest = useRef({ name, admin, open });
  useEffect(() => {
    latest.current = { name, admin, open };
  });

  useEffect(() => {
    const onRefusal = (event: Event) => {
      const status = (event as CustomEvent<string>).detail;
      void queryClient.invalidateQueries({
        queryKey: getUsersControllerGetCurrentUserV1QueryKey(),
      });
      if (status !== 'SUSPENDED_PAST_DUE') return;
      quietScreenErrors();
      const { name, admin, open } = latest.current;
      const title = `${name} is read-only`;
      const description = `A payment failed, so nothing can be created or changed until it’s settled. ${
        admin
          ? 'Update the payment in Billing.'
          : 'Ask your admin to update the payment.'
      }`;
      toast.error(title, {
        id: 'organization-read-only',
        description,
        duration: Infinity,
        action: admin
          ? { label: 'Update payment', onClick: () => void open() }
          : undefined,
      });
      announce(`${title}. ${description}`, 'assertive');
    };
    globalThis.addEventListener(ORGANIZATION_STATUS_EVENT, onRefusal);
    return () =>
      globalThis.removeEventListener(ORGANIZATION_STATUS_EVENT, onRefusal);
  }, [queryClient]);
}

/** Session storage's record that the banner has been announced. */
const ANNOUNCED_KEY = 'synapsedesk:past-due-announced';

/**
 * True the first time it's asked in this session, then false: the banner is a
 * live region only where it first appears. Each page renders its own header,
 * so without this every navigation would announce it again. Without storage
 * (a private window), every page load announces once.
 */
function claimAnnouncement(): boolean {
  try {
    if (sessionStorage.getItem(ANNOUNCED_KEY)) return false;
    sessionStorage.setItem(ANNOUNCED_KEY, '1');
    return true;
  } catch {
    return true;
  }
}

/**
 * Under the header on every page while a payment is overdue: worded for the
 * people who can pay (with Update payment) and for everyone else. Announced
 * once a session, as a status; not dismissible.
 */
export function PastDueBanner() {
  const status = useOrganizationStatus();
  const { can, organizationName } = useViewer();
  const { busy, open } = useOpenPortal();
  // Claimed when the banner first shows on this mount, not at mount: the
  // status can arrive after it.
  const [announces, setAnnounces] = useState<boolean | null>(null);
  if (status !== 'SUSPENDED_PAST_DUE') return null;
  if (announces === null) setAnnounces(claimAnnouncement());

  const name = organizationName ?? 'Your organization';
  const admin = can('organization.update');
  return (
    <section
      role={announces ? 'status' : 'region'}
      aria-label="Payment overdue"
      className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning-border bg-warning-subtle px-4 py-2 text-sm text-warning-subtle-foreground"
    >
      <TriangleAlertIcon aria-hidden className="size-4 shrink-0" />
      <p className="min-w-0 flex-1">
        {`A payment failed. ${name} is read-only until it’s settled.`}
        {!admin && ' Ask your admin to update the payment.'}
      </p>
      {admin && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void open()}
        >
          Update payment
          <span className="sr-only"> (opens Stripe)</span>
          <ExternalLinkIcon aria-hidden />
        </Button>
      )}
    </section>
  );
}

/**
 * In place of the app while the organization is frozen: what it means, the
 * support address to write to, and Sign out. Focus goes to its heading.
 */
export function FrozenPage() {
  const { user, organizationName } = useViewer();
  const support = useSupportEmail();
  const signOut = useSignOut();
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => heading.current?.focus(), []);

  // From `/users/me`: the organization read refuses a frozen organization.
  const name = organizationName ?? 'Your organization';
  return (
    <main className="flex min-h-svh flex-col items-center gap-8 px-4 py-12 md:py-20">
      <Lockup />
      <section className="flex w-full max-w-sm flex-col gap-4 md:rounded-xl md:border md:bg-card md:p-6 md:text-card-foreground md:shadow-sm">
        <div
          aria-hidden
          className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
        >
          <LockIcon className="size-5" />
        </div>
        <h1
          ref={heading}
          tabIndex={-1}
          className="text-2xl font-semibold tracking-tight outline-none"
        >
          {`${name} is frozen`}
        </h1>
        <p className="text-sm text-muted-foreground">
          Nothing in this workspace can be opened until it’s restored. This
          happens when its subscription has ended, or when the SynapseDesk team
          has frozen it.
        </p>
        {support && (
          <>
            <p className="text-sm text-muted-foreground">
              Only support can restore it. Write to them at:
            </p>
            <a
              href={`mailto:${support}`}
              className="w-fit text-sm text-primary underline underline-offset-4"
            >
              {support}
            </a>
            <a
              href={`mailto:${support}`}
              className={buttonVariants({ className: 'w-full' })}
            >
              <LifeBuoyIcon aria-hidden />
              Contact support
            </a>
          </>
        )}
        <Button
          variant="outline"
          className="w-full"
          onClick={() => void signOut()}
        >
          <LogOutIcon aria-hidden />
          Sign out
        </Button>
        {user && (
          <p className="text-xs text-muted-foreground">
            Signed in as {user.email}
          </p>
        )}
      </section>
    </main>
  );
}
