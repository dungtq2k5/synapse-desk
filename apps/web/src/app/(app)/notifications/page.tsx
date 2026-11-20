import type { Metadata } from 'next';
import { NotificationFeed } from '@/components/notifications/feed';
import { AppHeader } from '@/components/shell/app-header';

export const metadata: Metadata = { title: 'Notifications · SynapseDesk' };

/** Every notification, with filters and bulk actions. */
export default function NotificationsPage() {
  return (
    <>
      <AppHeader crumbs={[{ label: 'Notifications' }]} />
      <main id="main" tabIndex={-1} className="outline-none">
        <NotificationFeed />
      </main>
    </>
  );
}
