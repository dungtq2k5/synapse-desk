'use client';

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
import { VerifyEmailBanner } from './verify-email-banner';

/**
 * The bar above a page: the sidebar's trigger, then where the user is. The
 * last crumb is the current page; the others link back. The verify-email
 * banner sits above it, or under it on phones, where the bar comes first.
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

  return (
    <>
      {!isMobile && <VerifyEmailBanner />}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger
          aria-label={isMobile ? 'Open menu' : 'Toggle sidebar'}
        />
        <Separator orientation="vertical" className="mr-1 h-4!" />
        <Breadcrumb>
          <BreadcrumbList>
            {crumbs.map((crumb, index) => (
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
        {actions && <div className="ml-auto flex items-center">{actions}</div>}
      </header>
      {isMobile && <VerifyEmailBanner />}
    </>
  );
}
