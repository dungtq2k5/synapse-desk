import type { Metadata } from 'next';
import { OrganizationsView } from '@/components/platform/organizations-view';

export const metadata: Metadata = {
  title: 'Platform · Organizations · SynapseDesk',
};

/** Every organization on SynapseDesk. */
export default function PlatformOrganizationsPage() {
  return <OrganizationsView />;
}
