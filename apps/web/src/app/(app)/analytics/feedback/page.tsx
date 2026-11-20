import type { Metadata } from 'next';
import { FeedbackView } from '@/components/analytics/feedback-view';

export const metadata: Metadata = {
  title: 'Feedback · Analytics · SynapseDesk',
};

/** Analytics › Feedback. */
export default function FeedbackAnalyticsPage() {
  return <FeedbackView />;
}
