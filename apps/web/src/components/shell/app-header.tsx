'use client';

import Link from 'next/link';
import { Fragment } from 'react';
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

/**
 * The bar above a page: the sidebar's trigger, then where the user is. The
 * last crumb is the current page; the others link back.
 *
 * @example <AppHeader crumbs={[{ label: 'Tickets', href: '/tickets' }, { label: '#1042' }]} />
 */
export function AppHeader({
  crumbs,
}: {
  crumbs: { label: string; href?: string }[];
}) {
  const { isMobile } = useSidebar();

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger aria-label={isMobile ? 'Open menu' : 'Toggle sidebar'} />
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
    </header>
  );
}
