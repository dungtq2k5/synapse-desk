import type { Metadata } from 'next';
import { PlansView } from '@/components/platform/plans-view';

export const metadata: Metadata = { title: 'Platform · Plans · SynapseDesk' };

/** The catalog organizations subscribe to. */
export default function PlatformPlansPage() {
  return <PlansView />;
}
