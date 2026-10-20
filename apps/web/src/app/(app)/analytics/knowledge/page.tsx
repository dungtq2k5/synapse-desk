import type { Metadata } from 'next';
import { KnowledgeView } from '@/components/analytics/knowledge-view';

export const metadata: Metadata = {
  title: 'Knowledge · Analytics · SynapseDesk',
};

/** Analytics › Knowledge. */
export default function KnowledgeAnalyticsPage() {
  return <KnowledgeView />;
}
