import type { Metadata } from 'next';
import { KnowledgeView } from '@/components/knowledge/knowledge-view';
import { AppHeader } from '@/components/shell/app-header';

export const metadata: Metadata = { title: 'Knowledge · SynapseDesk' };

/** Searching the organization's documents, and browsing its articles. */
export default function KnowledgePage() {
  return (
    <>
      <AppHeader crumbs={[{ label: 'Knowledge' }]} />
      <main id="main" tabIndex={-1} className="outline-none">
        <KnowledgeView />
      </main>
    </>
  );
}
