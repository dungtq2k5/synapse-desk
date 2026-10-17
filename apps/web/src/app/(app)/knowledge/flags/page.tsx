import type { Metadata } from 'next';
import { FlagsView } from '@/components/documents/flags-view';

export const metadata: Metadata = { title: 'Quality flags · SynapseDesk' };

/** Knowledge › Quality flags: findings about how documents are used. */
export default function FlagsPage() {
  return <FlagsView />;
}
