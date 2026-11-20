import { usersControllerGetCurrentUserV1 } from '@synapsedesk/api-client';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Landing } from '@/components/landing/landing';
import { RoleHome } from '@/components/shell/role-home';
import { home } from '@/lib/home';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/session-cookies';
import { isAgent } from '@/lib/tickets';
import { serverFetcher, Unauthenticated } from '@/server/server-fetcher';

export const metadata: Metadata = {
  title: {
    absolute: 'SynapseDesk: support that answers from your own documents',
  },
  description:
    'SynapseDesk’s AI answers your customers first, from your organization’s documents, and shows where each answer came from. When it can’t answer, a person on your team takes over.',
};

/**
 * The root: the landing page for a visitor, the app for anyone signed in.
 *
 * 1. **Neither session cookie:** the landing page at once, without asking the
 *    gateway anything.
 * 2. **Otherwise the gateway decides,** as before: a Super Admin's home is the
 *    platform console, an agent's is Tickets, anyone else's is Ask. A signed-in
 *    person never sees the landing page.
 * 3. **A 401 with a refresh cookie:** the browser refreshes first
 *    (`RoleHome`); if that fails it goes to `/login?next=%2F`. An expired
 *    session ends on the sign-in page, not here.
 * 4. **A 401 with only the access cookie:** nothing can renew it, so the
 *    landing page.
 *
 * Only whether each cookie is present is read, never its value; the proxy
 * still decides nothing about authentication.
 */
export default async function Home() {
  const jar = await cookies();
  const refreshable = jar.has(REFRESH_COOKIE);
  if (!jar.has(ACCESS_COOKIE) && !refreshable) return <Landing />;

  let me: Awaited<ReturnType<typeof usersControllerGetCurrentUserV1>>;
  try {
    me = await usersControllerGetCurrentUserV1({
      fetcher: await serverFetcher(),
    });
  } catch (error) {
    if (error instanceof Unauthenticated) {
      return refreshable ? <RoleHome /> : <Landing />;
    }
    throw error;
  }
  redirect(
    home(
      me.data?.isSuperAdmin ?? false,
      isAgent(me.data?.permissionCodes ?? []),
    ),
  );
}
