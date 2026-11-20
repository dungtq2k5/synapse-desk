import type { Metadata } from 'next';
import {
  NewTicketForm,
  NewTicketHeader,
} from '@/components/tickets/new-ticket-form';

export const metadata: Metadata = { title: 'New ticket · SynapseDesk' };

/** Raising a ticket: for yourself, or, for an agent, for someone else. */
export default function NewTicketPage() {
  return (
    <>
      <NewTicketHeader />
      <main id="main" tabIndex={-1} className="outline-none">
        <NewTicketForm />
      </main>
    </>
  );
}
