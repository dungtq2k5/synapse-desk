import { getTicketsControllerListV1QueryOptions } from '@synapsedesk/api-client';
import { HydrationBoundary } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { AppHeader } from '@/components/shell/app-header';
import { TicketList } from '@/components/tickets/ticket-list';
import { FIRST_PAGE } from '@/lib/tickets';
import { prefetch, renderClient } from '@/server/prefetch';
import { serverFetcher } from '@/server/server-fetcher';

export const metadata: Metadata = { title: 'My requests · SynapseDesk' };

/**
 * An end user's requests: every ticket they raised, however it started. The
 * first page renders here, the rest in the browser.
 */
export default async function RequestsPage() {
  const { queryClient, state } = renderClient();
  await prefetch(
    queryClient,
    getTicketsControllerListV1QueryOptions(FIRST_PAGE, {
      request: { fetcher: await serverFetcher() },
    }),
  );

  return (
    <HydrationBoundary state={state()}>
      <AppHeader crumbs={[{ label: 'My requests' }]} />
      <main id="main" tabIndex={-1} className="outline-none">
        <TicketList />
      </main>
    </HydrationBoundary>
  );
}
