import type { Metadata } from 'next';
import { SecurityView } from '@/components/account/security-view';
import { AppHeader } from '@/components/shell/app-header';

export const metadata: Metadata = { title: 'Security · SynapseDesk' };

/** Your password, two-step verification and where you're signed in. */
export default function SecurityPage() {
  return (
    <>
      <AppHeader crumbs={[{ label: 'Security' }]} />
      <main
        id="main"
        tabIndex={-1}
        className="flex flex-col gap-6 p-4 outline-none md:p-6"
      >
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
          <p className="text-sm text-muted-foreground">
            Your password, two-step verification and where you’re signed in.
          </p>
        </header>
        <SecurityView />
      </main>
    </>
  );
}
