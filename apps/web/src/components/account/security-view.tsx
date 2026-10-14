'use client';

import { useOrganizationsControllerGetV1 } from '@synapsedesk/api-client';
import { useViewer } from '@/hooks/use-viewer';
import { PasswordSection } from './password-section';
import { SessionsSection } from './sessions-section';
import { TwoStepSection } from './two-step-section';

/**
 * The security page's sections, once the signed-in user is known: the
 * password, two-step verification (which the organization may require), and
 * where they're signed in.
 */
export function SecurityView() {
  const { user, hasPassword } = useViewer();
  // The shell asks for the organization too; this is the same cached query.
  const organization = useOrganizationsControllerGetV1({
    query: { retry: false },
  }).data?.data;
  if (!user) return null;

  return (
    <>
      <PasswordSection email={user.email} hasPassword={hasPassword} />
      <TwoStepSection
        enabled={user.isTwoFactorEnabled}
        required={organization?.enforceTwoFactor ?? false}
        organizationName={organization?.name ?? 'Your organization'}
        hasPassword={hasPassword}
      />
      <SessionsSection />
    </>
  );
}
