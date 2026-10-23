import type { Metadata } from 'next';
import { PeopleView } from '@/components/platform/people-view';

export const metadata: Metadata = { title: 'Platform · People · SynapseDesk' };

/** Everyone in every organization. */
export default function PlatformPeopleViewPage() {
  return <PeopleView />;
}
