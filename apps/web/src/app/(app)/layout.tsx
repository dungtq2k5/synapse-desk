import {
  getOrganizationsControllerGetV1QueryOptions,
  getUsersControllerGetCurrentUserV1QueryOptions,
} from '@synapsedesk/api-client';
import { HydrationBoundary } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { prefetch, renderClient } from '@/server/prefetch';
import { serverFetcher } from '@/server/server-fetcher';

/**
 * Every signed-in page: the shell, with the viewer and the organisation
 * already fetched. An expired access cookie renders the shell empty, and the
 * browser fills it after refreshing.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const { queryClient, state } = renderClient();
  const request = { fetcher: await serverFetcher() };

  await Promise.all([
    prefetch(
      queryClient,
      getUsersControllerGetCurrentUserV1QueryOptions({ request }),
    ),
    // The organisation's name is decoration: a failure leaves it blank.
    prefetch(
      queryClient,
      getOrganizationsControllerGetV1QueryOptions({ request }),
    ).catch(() => undefined),
  ]);

  return (
    <HydrationBoundary state={state()}>
      <AppShell>{children}</AppShell>
    </HydrationBoundary>
  );
}
