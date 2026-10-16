import { usersControllerGetCurrentUserV1 } from '@synapsedesk/api-client';
import { redirect } from 'next/navigation';
import { RoleHome } from '@/components/shell/role-home';
import { isAgent } from '@/lib/tickets';
import { serverFetcher, Unauthenticated } from '@/server/server-fetcher';

/**
 * The root: an agent's home is Tickets, anyone else's is Ask. An expired
 * access cookie leaves the choice to the browser, which refreshes first.
 */
export default async function Home() {
  let codes: readonly string[];
  try {
    const me = await usersControllerGetCurrentUserV1({
      fetcher: await serverFetcher(),
    });
    codes = me.data?.permissionCodes ?? [];
  } catch (error) {
    if (error instanceof Unauthenticated) return <RoleHome />;
    throw error;
  }
  redirect(isAgent(codes) ? '/tickets' : '/ask');
}
