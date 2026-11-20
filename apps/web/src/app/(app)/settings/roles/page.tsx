import type { Metadata } from 'next';
import { RolesView } from '@/components/settings/roles/roles-view';

export const metadata: Metadata = { title: 'Roles · SynapseDesk' };

/** Settings › Roles. */
export default function RolesPage() {
  return <RolesView />;
}
