'use client';

import {
  REALTIME_EVENTS,
  type DocumentIndexedEvent,
  type DocumentIngestionFailedEvent,
} from '@synapsedesk/contracts';
import { useCallback, useState } from 'react';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
import { announce } from '@/lib/toast';
import { useDocumentCache } from './document-actions';

/** How long a document that just changed stays tinted. */
const FRESH_MS = 3000;

/**
 * A document indexed or failed while the page is open: every document view
 * refetches, the change is said (politely when indexed, assertively when it
 * failed), and the document is tinted for a few seconds. Focus never moves.
 *
 * @returns the ids tinted now
 */
export function useDocumentLive(): ReadonlySet<string> {
  const refresh = useDocumentCache();
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());

  const tint = useCallback((documentId: string) => {
    setFresh((ids) => new Set(ids).add(documentId));
    globalThis.setTimeout(
      () =>
        setFresh((ids) => {
          const next = new Set(ids);
          next.delete(documentId);
          return next;
        }),
      FRESH_MS,
    );
  }, []);

  useRealtimeEvent(
    REALTIME_EVENTS.documentIndexed,
    useCallback(
      (event: DocumentIndexedEvent) => {
        void refresh();
        tint(event.documentId);
        announce(`${event.title} is indexed and searchable now.`);
      },
      [refresh, tint],
    ),
  );

  useRealtimeEvent(
    REALTIME_EVENTS.documentFailed,
    useCallback(
      (event: DocumentIngestionFailedEvent) => {
        void refresh();
        tint(event.documentId);
        announce(`${event.title} couldn’t be processed.`, 'assertive');
      },
      [refresh, tint],
    ),
  );

  return fresh;
}
