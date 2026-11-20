import type { Metadata } from 'next';
import { AskView } from '@/components/ask/ask-view';
import { AppHeader } from '@/components/shell/app-header';

export const metadata: Metadata = { title: 'Ask · SynapseDesk' };

/** Asking a question: it becomes a conversation the AI answers first. */
export default function AskPage() {
  return (
    <>
      <AppHeader crumbs={[{ label: 'Ask a question' }]} />
      <main id="main" tabIndex={-1} className="outline-none">
        <AskView />
      </main>
    </>
  );
}
