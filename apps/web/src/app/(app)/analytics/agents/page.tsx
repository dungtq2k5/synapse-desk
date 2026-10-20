import type { Metadata } from 'next';
import { AgentsView } from '@/components/analytics/agents-view';

export const metadata: Metadata = { title: 'Agents · Analytics · SynapseDesk' };

/** Analytics › Agents. */
export default function AgentsAnalyticsPage() {
  return <AgentsView />;
}
