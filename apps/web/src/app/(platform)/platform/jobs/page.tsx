import type { Metadata } from 'next';
import { JobsView } from '@/components/platform/jobs-view';

export const metadata: Metadata = { title: 'Platform · Jobs · SynapseDesk' };

/** The scheduled work and its health. */
export default function PlatformJobsViewPage() {
  return <JobsView />;
}
