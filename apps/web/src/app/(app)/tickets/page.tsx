import { getTicketsControllerListV1QueryOptions } from '@synapsedesk/api-client';
import { HydrationBoundary } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { AppHeader } from '@/components/shell/app-header';
import { OnboardingPanel } from '@/components/shell/onboarding-panel';
import { TicketList } from '@/components/tickets/ticket-list';
import { FIRST_PAGE } from '@/lib/tickets';
import { prefetch, renderClient } from '@/server/prefetch';
import { serverFetcher } from '@/server/server-fetcher';

export const metadata: Metadata = { title: 'Tickets · SynapseDesk' };

/**
 * The ticket list: the first page rendered here, the rest in the browser.
 * Above it, while the organization is being set up, the founder's checklist.
 */
export default async function TicketsPage() {
  const { queryClient, state } = renderClient();
  await prefetch(
    queryClient,
    getTicketsControllerListV1QueryOptions(FIRST_PAGE, {
      request: { fetcher: await serverFetcher() },
    }),
  );

  return (
    <HydrationBoundary state={state()}>
      <AppHeader crumbs={[{ label: 'Tickets' }]} />
      <main id="main" tabIndex={-1} className="outline-none">
        <OnboardingPanel />
        <TicketList />
      </main>
    </HydrationBoundary>
  );
}
