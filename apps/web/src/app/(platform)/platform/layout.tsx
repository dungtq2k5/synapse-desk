import { getUsersControllerGetCurrentUserV1QueryOptions } from '@synapsedesk/api-client';
import { HydrationBoundary } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ConsoleGate } from '@/components/platform/console-gate';
import { prefetch, renderClient } from '@/server/prefetch';
import { serverFetcher } from '@/server/server-fetcher';

/**
 * Every console page: the viewer, already fetched, decides the frame. A
 * Super Admin has no organization, so none is asked for.
 */
export default async function PlatformLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { queryClient, state } = renderClient();
  await prefetch(
    queryClient,
    getUsersControllerGetCurrentUserV1QueryOptions({
      request: { fetcher: await serverFetcher() },
    }),
  );

  return (
    <HydrationBoundary state={state()}>
      <ConsoleGate supportEmail={process.env.SUPPORT_EMAIL ?? ''}>
        {children}
      </ConsoleGate>
    </HydrationBoundary>
  );
}
