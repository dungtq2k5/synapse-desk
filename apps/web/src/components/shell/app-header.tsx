'use client';

import { LogOutIcon } from 'lucide-react';
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { useViewer } from '@/hooks/use-viewer';
import { NotificationBell } from '@/components/notifications/bell';
import { useInConsole } from '@/components/platform/console-context';
import { ConsoleBar } from '@/components/platform/console-bar';
import { Button } from '@/components/ui/button';
import { PastDueBanner } from './organization-status';
import { useSignOut } from './user-menu';
import { VerifyEmailBanner } from './verify-email-banner';

/**
 * The bar above a page: the sidebar's trigger, then where the user is. The
 * last crumb is the current page; the others link back. The verify-email
 * banner sits above it, or under it on phones, where the bar comes first.
 * In the platform console the crumbs start at "Platform", the console's bar
 * takes the banner's place and Sign out the bell's.
 *
 * @example <AppHeader crumbs={[{ label: 'Tickets', href: '/tickets' }, { label: '#1042' }]} />
 */
export function AppHeader({
  crumbs,
  actions,
}: {
  crumbs: { label: string; href?: string }[];
  /** At the bar's end: a page's own buttons. */
  actions?: ReactNode;
}) {
  const { isMobile } = useSidebar();
  const inConsole = useInConsole();
  const signOut = useSignOut();
  const trail = inConsole
    ? [{ label: 'Platform', href: '/platform' }, ...crumbs]
    : crumbs;
  const banner = inConsole ? <ConsoleBar /> : <VerifyEmailBanner />;

  return (
    <>
      {!isMobile && banner}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger
          aria-label={isMobile ? 'Open menu' : 'Toggle sidebar'}
        />
        <Separator orientation="vertical" className="mr-1 h-4!" />
        <Breadcrumb>
          <BreadcrumbList>
            {trail.map((crumb, index) => (
              <Fragment key={crumb.label}>
                {index > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem>
                  {crumb.href ? (
                    <BreadcrumbLink asChild>
                      <Link href={crumb.href}>{crumb.label}</Link>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
        <div className="ml-auto flex items-center gap-1">
          {actions}
          {inConsole ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              onClick={() => void signOut()}
            >
              <LogOutIcon aria-hidden />
            </Button>
          ) : (
            <NotificationBell />
          )}
        </div>
      </header>
      {!inConsole && <PastDueBanner />}
      {isMobile && banner}
    </>
  );
}

/** The crumb a ticket's pages hang from: the queue, or an end user's requests. */
export function useTicketsCrumb(): { label: string; href: string } {
  return useViewer().isAgent
    ? { label: 'Tickets', href: '/tickets' }
    : { label: 'My requests', href: '/requests' };
}
