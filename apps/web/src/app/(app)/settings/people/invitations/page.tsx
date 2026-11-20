import type { Metadata } from 'next';
import { InvitationsView } from '@/components/settings/people/invitations-view';

export const metadata: Metadata = { title: 'Invitations · SynapseDesk' };

/** Settings › People › Invitations. */
export default function InvitationsPage() {
  return <InvitationsView />;
}
