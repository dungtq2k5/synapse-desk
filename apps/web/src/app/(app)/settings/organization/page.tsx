import type { Metadata } from 'next';
import { OrganizationView } from '@/components/settings/organization-view';

export const metadata: Metadata = { title: 'Organization · SynapseDesk' };

/** Settings › Organization. */
export default function OrganizationPage() {
  return <OrganizationView />;
}
