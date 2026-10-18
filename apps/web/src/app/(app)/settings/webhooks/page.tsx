import type { Metadata } from 'next';
import { WebhooksView } from '@/components/settings/webhooks/webhooks-view';

export const metadata: Metadata = { title: 'Webhooks · SynapseDesk' };

/** Settings › Webhooks. */
export default function WebhooksPage() {
  return <WebhooksView />;
}
