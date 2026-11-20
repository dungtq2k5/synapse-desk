import {
  ApiError,
  getMessagesControllerListV1QueryOptions,
  getTicketsControllerGetV1QueryOptions,
  getTicketsControllerListStatusChangesV1QueryOptions,
  ticketsControllerGetByNumberV1,
} from '@synapsedesk/api-client';
import { HydrationBoundary } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { TicketNotFound, TicketView } from '@/components/ticket/ticket-view';
import { THREAD_PAGE } from '@/lib/tickets';
import { prefetch, renderClient } from '@/server/prefetch';
import { serverFetcher } from '@/server/server-fetcher';

export const metadata: Metadata = { title: 'Ticket · SynapseDesk' };

/**
 * One ticket, rendered here with its thread and history. A ticket the
 * gateway won't show (missing, or not the viewer's) is one answer: not found.
 *
 * The segment may be the ticket's number, as notifications link to it
 * (`/tickets/1042`): it's looked up and redirected to the id's URL.
 * `?from=notification` adds "Back to notifications" to the not-found page.
 */
export default async function TicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticketId: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { ticketId } = await params;
  const fromNotification = (await searchParams).from === 'notification';
  const { queryClient, state } = renderClient();
  const request = { fetcher: await serverFetcher() };

  if (/^\d+$/.test(ticketId)) {
    let id: string | undefined;
    try {
      id = (await ticketsControllerGetByNumberV1(Number(ticketId), request))
        .data?.id;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500) throw error;
    }
    if (!id) return <TicketNotFound fromNotification={fromNotification} />;
    redirect(`/tickets/${id}${fromNotification ? '?from=notification' : ''}`);
  }

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
      return <TicketNotFound fromNotification={fromNotification} />;
    }
    throw error;
  }

  return (
    <HydrationBoundary state={state()}>
      <TicketView ticketId={ticketId} fromNotification={fromNotification} />
    </HydrationBoundary>
  );
}
