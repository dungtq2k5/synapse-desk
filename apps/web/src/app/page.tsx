import { usersControllerGetCurrentUserV1 } from '@synapsedesk/api-client';
import { redirect } from 'next/navigation';
import { RoleHome } from '@/components/shell/role-home';
import { home } from '@/lib/home';
import { isAgent } from '@/lib/tickets';
import { serverFetcher, Unauthenticated } from '@/server/server-fetcher';

/**
 * The root: a Super Admin's home is the platform console, an agent's is
 * Tickets, anyone else's is Ask. An expired access cookie leaves the choice
 * to the browser, which refreshes first.
 */
export default async function Home() {
  let me: Awaited<ReturnType<typeof usersControllerGetCurrentUserV1>>;
  try {
    me = await usersControllerGetCurrentUserV1({
      fetcher: await serverFetcher(),
    });
  } catch (error) {
    if (error instanceof Unauthenticated) return <RoleHome />;
    throw error;
  }
  redirect(
    home(
      me.data?.isSuperAdmin ?? false,
      isAgent(me.data?.permissionCodes ?? []),
    ),
  );
}
