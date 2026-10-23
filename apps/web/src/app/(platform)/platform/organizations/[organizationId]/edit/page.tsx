import type { Metadata } from 'next';
import { OrganizationEdit } from '@/components/platform/organization-edit';

export const metadata: Metadata = {
  title: 'Platform · Edit organization · SynapseDesk',
};

/** An organization's profile, and its limits as an override. */
export default async function EditOrganizationPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  return <OrganizationEdit organizationId={organizationId} />;
}
