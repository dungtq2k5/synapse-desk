import type { Metadata } from 'next';
import { MembersView } from '@/components/settings/people/members-view';

export const metadata: Metadata = { title: 'People · SynapseDesk' };

/** Settings › People. */
export default function PeoplePage() {
  return <MembersView />;
}
