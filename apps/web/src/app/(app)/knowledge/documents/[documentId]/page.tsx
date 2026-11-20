import type { Metadata } from 'next';
import { DocumentView } from '@/components/documents/document-view';

export const metadata: Metadata = { title: 'Document · SynapseDesk' };

/** One document: its processing, who can see it, and what the AI reads. */
export default async function DocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  return <DocumentView key={documentId} documentId={documentId} />;
}
