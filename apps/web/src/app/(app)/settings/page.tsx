import { usersControllerGetCurrentUserV1 } from '@synapsedesk/api-client';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SettingsHome } from '@/components/settings/settings-home';
import { settingsSections } from '@/lib/settings-sections';
import { serverFetcher, Unauthenticated } from '@/server/server-fetcher';

export const metadata: Metadata = { title: 'Settings · SynapseDesk' };

/**
 * `/settings`: the first section the viewer can see, chosen on the server, so
 * the browser never draws this page on the way. Someone with no section sees
 * that the area isn't theirs. An expired access cookie leaves the choice to
 * the browser, which refreshes first.
 */
export default async function SettingsPage() {
  let me: Awaited<ReturnType<typeof usersControllerGetCurrentUserV1>>;
  try {
    me = await usersControllerGetCurrentUserV1({
      fetcher: await serverFetcher(),
    });
  } catch (error) {
    if (error instanceof Unauthenticated) return <SettingsHome />;
    throw error;
  }
  const [first] = settingsSections(me.data?.permissionCodes ?? []);
  if (first) redirect(first.href);
  return <SettingsHome />;
}
