import {
  ApiError,
  getMessagesControllerListV1QueryOptions,
  getTicketsControllerGetV1QueryOptions,
  getTicketsControllerListStatusChangesV1QueryOptions,
} from '@synapsedesk/api-client';
import { HydrationBoundary } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { TicketNotFound, TicketView } from '@/components/ticket/ticket-view';
import { THREAD_PAGE } from '@/lib/tickets';
import { prefetch, renderClient } from '@/server/prefetch';
import { serverFetcher } from '@/server/server-fetcher';

export const metadata: Metadata = { title: 'Ticket · SynapseDesk' };

/**
 * One ticket, rendered here with its thread and history. A ticket the
 * gateway won't show (missing, or not the viewer's) is one answer: not found.
 */
export default async function TicketPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const { ticketId } = await params;
  const { queryClient, state } = renderClient();
  const request = { fetcher: await serverFetcher() };

  try {
    await Promise.all([
      prefetch(
        queryClient,
        getTicketsControllerGetV1QueryOptions(ticketId, { request }),
      ),
      prefetch(
        queryClient,
        getMessagesControllerListV1QueryOptions(ticketId, THREAD_PAGE, {
          request,
        }),
      ),
      prefetch(
        queryClient,
        getTicketsControllerListStatusChangesV1QueryOptions(ticketId, {
          request,
        }),
      ),
    ]);
  } catch (error) {
    if (error instanceof ApiError && [400, 403, 404].includes(error.status)) {
      return <TicketNotFound />;
    }
    throw error;
  }

  return (
    <HydrationBoundary state={state()}>
      <TicketView ticketId={ticketId} />
    </HydrationBoundary>
  );
}
