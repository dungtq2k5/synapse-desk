import type { Metadata } from 'next';
import { PlatformAuditView } from '@/components/platform/audit-view';

export const metadata: Metadata = {
  title: 'Platform · Audit log · SynapseDesk',
};

/** The platform’s own trail. */
export default function PlatformPlatformAuditViewPage() {
  return <PlatformAuditView />;
}
