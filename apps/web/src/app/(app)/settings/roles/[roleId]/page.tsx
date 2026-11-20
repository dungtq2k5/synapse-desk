import type { Metadata } from 'next';
import { RoleView } from '@/components/settings/roles/role-view';

export const metadata: Metadata = { title: 'Role · SynapseDesk' };

/** Settings › Roles › one role. */
export default async function RolePage({
  params,
}: {
  params: Promise<{ roleId: string }>;
}) {
  const { roleId } = await params;
  return <RoleView roleId={roleId} />;
}
