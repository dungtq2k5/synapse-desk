import type { Metadata } from 'next';
import { ProfileView } from '@/components/account/profile-view';
import { AppHeader } from '@/components/shell/app-header';

export const metadata: Metadata = { title: 'Profile · SynapseDesk' };

/** How you appear to your team. The viewer is fetched by the layout. */
export default function ProfilePage() {
  return (
    <>
      <AppHeader crumbs={[{ label: 'Profile' }]} />
      <main
        id="main"
        tabIndex={-1}
        className="flex flex-col gap-6 p-4 outline-none md:p-6"
      >
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
          <p className="text-sm text-muted-foreground">
            How you appear to your team.
          </p>
        </header>
        <ProfileView />
      </main>
    </>
  );
}
