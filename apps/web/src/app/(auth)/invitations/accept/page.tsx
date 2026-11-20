import type { Metadata } from 'next';
import { SignInFlow } from '@/components/auth/sign-in-flow';
import { HOME } from '@/lib/sign-in';

export const metadata: Metadata = { title: 'Join · SynapseDesk' };

/**
 * Where an invitation's email links (`WEB_ROUTES.acceptInvitation`), with its
 * token. Joining signs in, so the sign-in legs continue on this page.
 */
export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await searchParams;
  return (
    <SignInFlow
      start="invitation"
      invitationToken={(Array.isArray(token) ? token[0] : token) ?? ''}
      next={HOME}
      notice={null}
    />
  );
}
