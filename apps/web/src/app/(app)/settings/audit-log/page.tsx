import type { Metadata } from 'next';
import { AuditView } from '@/components/settings/audit/audit-view';

export const metadata: Metadata = { title: 'Audit log · SynapseDesk' };

/** Settings › Audit log. */
export default function AuditLogPage() {
  return <AuditView />;
}
