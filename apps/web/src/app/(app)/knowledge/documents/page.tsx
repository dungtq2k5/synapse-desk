import type { Metadata } from 'next';
import { DocumentsView } from '@/components/documents/documents-view';

export const metadata: Metadata = { title: 'Documents · SynapseDesk' };

/** Knowledge › Documents: managing what the AI answers from. */
export default function DocumentsPage() {
  return <DocumentsView />;
}
