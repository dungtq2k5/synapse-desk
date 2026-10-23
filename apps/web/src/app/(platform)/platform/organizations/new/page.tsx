import type { Metadata } from 'next';
import { OrganizationCreate } from '@/components/platform/organization-create';

export const metadata: Metadata = {
  title: 'Platform · New organization · SynapseDesk',
};

/** Create an organization and its first Org Admin. */
export default function NewOrganizationPage() {
  return <OrganizationCreate />;
}
