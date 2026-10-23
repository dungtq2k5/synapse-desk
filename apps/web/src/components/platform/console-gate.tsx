'use client';

import type { ReactNode } from 'react';
import { AppHeader } from '@/components/shell/app-header';
import { AppShell } from '@/components/shell/app-shell';
import { PageUnavailable } from '@/components/shell/page-unavailable';
import { useViewer } from '@/hooks/use-viewer';
import { ConsoleShell } from './console-shell';

/**
 * The console for a Super Admin. Anyone else gets "This page isn't
 * available" in their own shell, and the console's pages never render, so
 * none of its reads are made. Nothing while the viewer is on its way (an
 * expired cookie, refreshing).
 */
export function ConsoleGate({
  supportEmail,
  children,
}: {
  supportEmail: string;
  children: ReactNode;
}) {
  const { query, isSuperAdmin } = useViewer();
  if (!query.data) return null;
  if (isSuperAdmin) return <ConsoleShell>{children}</ConsoleShell>;
  return (
    <AppShell supportEmail={supportEmail}>
      <AppHeader crumbs={[{ label: 'Platform' }]} />
      <main id="main" tabIndex={-1} className="p-4 outline-none md:p-6">
        <PageUnavailable back={{ href: '/tickets', label: 'Tickets' }} />
      </main>
    </AppShell>
  );
}
