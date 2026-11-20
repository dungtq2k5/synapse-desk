import type { Metadata } from 'next';
import { NotificationPreferences } from '@/components/notifications/preferences';
import { AppHeader } from '@/components/shell/app-header';

export const metadata: Metadata = {
  title: 'Notification settings · SynapseDesk',
};

/** How the person hears about each kind of notification, per channel. */
export default function NotificationSettingsPage() {
  return (
    <>
      <AppHeader
        crumbs={[
          { label: 'Account', href: '/profile' },
          { label: 'Notification settings' },
        ]}
      />
      <main id="main" tabIndex={-1} className="outline-none">
        <NotificationPreferences />
      </main>
    </>
  );
}
