import { extractEmailDomain } from '@synapsedesk/common';

export function generateUniqueOrganizationSlug(email: string): string {
  const domain = extractEmailDomain(email);
  if (!domain) throw new Error('Invalid email domain');

  return domain.replace(/\./g, '-');
}
