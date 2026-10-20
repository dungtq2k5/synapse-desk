import type { Metadata } from 'next';
import { OverviewView } from '@/components/analytics/overview-view';

export const metadata: Metadata = { title: 'Analytics · SynapseDesk' };

/** Analytics › Overview. */
export default function AnalyticsPage() {
  return <OverviewView />;
}
