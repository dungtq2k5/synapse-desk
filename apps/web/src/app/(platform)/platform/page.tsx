import type { Metadata } from 'next';
import { OverviewView } from '@/components/platform/overview-view';

export const metadata: Metadata = {
  title: 'Platform · Overview · SynapseDesk',
};

/** The platform at a glance. */
export default function PlatformOverviewPage() {
  return <OverviewView />;
}
