import type { Metadata } from 'next';
import { AiUsageView } from '@/components/analytics/ai-usage-view';

export const metadata: Metadata = {
  title: 'AI usage · Analytics · SynapseDesk',
};

/** Analytics › AI usage. */
export default function AiUsagePage() {
  return <AiUsageView />;
}
