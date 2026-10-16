import type { DraftCitationResponseDto } from '@synapsedesk/api-client';
import { BookOpenIcon } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/** Where a passage opens: the reader, at the page of blocks holding it. */
export function passageHref(documentId: string, chunkId: string): string {
  return `/knowledge/articles/${documentId}?passage=${chunkId}`;
}

/**
 * One source of an answer, as a link to the reader at its passage:
 * "[1] Remote Work Policy.pdf, p. 4". Its edge follows the surface it sits on.
 */
export function CitationChip({
  number,
  citation,
  surface,
}: {
  number: number;
  citation: DraftCitationResponseDto;
  surface: 'ai' | 'neutral';
}) {
  const page = citation.pageNumber;
  return (
    <Link
      href={passageHref(citation.documentId, citation.chunkId)}
      aria-label={`${citation.documentTitle}${page !== null ? `, page ${page}` : ''}, source ${number}`}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-xs outline-none hover:bg-accent hover:text-accent-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 visited:text-muted-foreground',
        surface === 'ai' ? 'border-author-ai-border' : 'border-input',
      )}
    >
      [{number}]
      <BookOpenIcon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">
        {citation.documentTitle}
        {page !== null && `, p. ${page}`}
      </span>
    </Link>
  );
}

/** An answer's sources, numbered as its text cites them. */
export function Citations({
  citations,
  surface = 'ai',
}: {
  citations: DraftCitationResponseDto[];
  surface?: 'ai' | 'neutral';
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium">Sources</span>
      <ul className="flex flex-wrap gap-2">
        {citations.map((citation, index) => (
          <li key={citation.chunkId} className="max-w-full">
            <CitationChip
              number={index + 1}
              citation={citation}
              surface={surface}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
