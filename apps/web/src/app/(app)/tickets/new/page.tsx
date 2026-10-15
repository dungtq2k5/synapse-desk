import type { Metadata } from 'next';
import { AppHeader } from '@/components/shell/app-header';
import { NewTicketForm } from '@/components/tickets/new-ticket-form';

export const metadata: Metadata = { title: 'New ticket · SynapseDesk' };

/** Raising a ticket: for yourself, or, for an agent, for someone else. */
export default function NewTicketPage() {
  return (
    <>
      <AppHeader
        crumbs={[
          { label: 'Tickets', href: '/tickets' },
          { label: 'New ticket' },
        ]}
      />
      <main id="main" tabIndex={-1} className="outline-none">
        <NewTicketForm />
      </main>
    </>
  );
}
