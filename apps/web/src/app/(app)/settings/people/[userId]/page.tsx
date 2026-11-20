import type { Metadata } from 'next';
import { PersonView } from '@/components/settings/people/person-view';

export const metadata: Metadata = { title: 'Person · SynapseDesk' };

/** Settings › People › one person. */
export default async function PersonPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  return <PersonView userId={userId} />;
}
