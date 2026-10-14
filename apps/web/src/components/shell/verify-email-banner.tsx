'use client';

import { MailIcon, XIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { useViewer } from '@/hooks/use-viewer';

/** Dismissed for this tab's session: it comes back on the next one. */
const DISMISSED = 'synapsedesk:verify-banner-dismissed';

/**
 * "Verify your email to invite people": a slim banner while the signed-in
 * email isn't verified, dismissable for the session. Inviting is the one thing
 * an unverified email can't do, so it says so and nothing more.
 */
export function VerifyEmailBanner() {
  const { user } = useViewer();
  const pathname = usePathname();
  // This tab's storage, which the server can't see: dismissed while rendering there.
  const stored = useSyncExternalStore(
    noChanges,
    () => sessionStorage.getItem(DISMISSED) !== null,
    () => true,
  );
  const [dismissed, setDismissed] = useState(false);

  if (!user || user.isEmailVerified || stored || dismissed) return null;

  const dismiss = () => {
    sessionStorage.setItem(DISMISSED, '1');
    setDismissed(true);
  };

  return (
    <section
      aria-label="Email verification"
      className="flex min-h-12 items-center gap-3 border-b border-info-border bg-info-subtle px-4 text-sm text-info-subtle-foreground"
    >
      <MailIcon aria-hidden className="size-4 shrink-0" />
      <p className="flex-1 py-2">
        <span className="md:hidden">Verify your email to invite people.</span>
        <span className="hidden md:inline">
          Verify your email to invite people to your organization. Everything
          else works as usual.
        </span>
      </p>
      <Link
        href={`/verify-email?next=${encodeURIComponent(pathname)}`}
        className="font-medium whitespace-nowrap underline-offset-4 hover:underline"
      >
        Verify now
      </Link>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Dismiss for now"
        onClick={dismiss}
      >
        <XIcon />
      </Button>
    </section>
  );
}

/** Nothing else writes the flag, so there's nothing to subscribe to. */
function noChanges(): () => void {
  return () => undefined;
}
