import type { Metadata } from 'next';
import { GlobalRolesView } from '@/components/platform/roles-view';

export const metadata: Metadata = {
  title: 'Platform · Global roles · SynapseDesk',
};

/** The roles every organization has. */
export default function PlatformGlobalRolesViewPage() {
  return <GlobalRolesView />;
}
