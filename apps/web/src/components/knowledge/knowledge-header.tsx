'use client';

import { useDocumentsControllerListFlagsV1 } from '@synapsedesk/api-client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useViewer } from '@/hooks/use-viewer';
import { cn } from '@/lib/utils';

export type KnowledgeTab = 'search' | 'documents' | 'flags';

const TABS: { tab: KnowledgeTab; label: string; href: string }[] = [
  { tab: 'search', label: 'Search', href: '/knowledge' },
  { tab: 'documents', label: 'Documents', href: '/knowledge/documents' },
  { tab: 'flags', label: 'Quality flags', href: '/knowledge/flags' },
];

/** The open flags' count, for the tab; `null` until known. */
export function useOpenFlagCount(): number | null {
  const { can } = useViewer();
  const open = useDocumentsControllerListFlagsV1(
    { limit: 1 },
    { query: { enabled: can('document.read') } },
  );
  return open.data?.data?.meta.totalItems ?? null;
}

/**
 * Knowledge's heading: the title, a line under it, and, for people with
 * `document.read`, the three tabs. Each tab is its own route, so they are
 * links marked `aria-current`, not a tablist.
 *
 * @example <KnowledgeHeader tab="documents" description="…" actions={<UploadButton />} />
 */
export function KnowledgeHeader({
  tab,
  description,
  actions,
}: {
  tab: KnowledgeTab;
  description: string;
  actions?: ReactNode;
}) {
  const { can } = useViewer();
  const flags = useOpenFlagCount();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">Knowledge</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {actions}
      </div>
      {can('document.read') && (
        <nav aria-label="Knowledge">
          <ul className="inline-flex h-9 w-full max-w-120 items-center rounded-lg bg-muted p-0.75">
            {TABS.map((item) => (
              // As wide as its words on a phone, a third each from `sm`; and
              // never wider than the row allows, while a resize settles.
              <li key={item.tab} className="h-full min-w-0 flex-auto sm:flex-1">
                <Link
                  href={item.href}
                  aria-current={item.tab === tab ? 'page' : undefined}
                  className={cn(
                    'inline-flex h-full w-full items-center justify-center rounded-md border border-transparent px-1.5 text-sm sm:px-2 font-medium whitespace-nowrap overflow-hidden text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    item.tab === tab &&
                      'bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30',
                  )}
                >
                  {item.tab === 'flags' && flags
                    ? `${item.label} (${flags})`
                    : item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
