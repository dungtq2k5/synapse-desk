import type { Metadata } from 'next';
import { OrganizationView } from '@/components/platform/organization-view';

export const metadata: Metadata = {
  title: 'Platform · Organization · SynapseDesk',
};

/** One organization, as the platform sees it. */
export default async function PlatformOrganizationPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  return <OrganizationView organizationId={organizationId} />;
}
