import type { KnowledgeArticleResponseDto } from '@synapsedesk/api-client';
import { BookOpenIcon } from 'lucide-react';
import Link from 'next/link';
import { dayDate } from '@/lib/format';

/** An article in a list: its title, linking to the reader, and when it changed. */
export function ArticleRow({
  article,
}: {
  article: KnowledgeArticleResponseDto;
}) {
  return (
    <div className="relative flex items-center gap-3 px-4 py-3 hover:bg-accent/50">
      <BookOpenIcon
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground"
      />
      <div className="flex min-w-0 flex-col">
        <Link
          href={`/knowledge/articles/${article.id}`}
          className="truncate text-sm text-primary outline-none after:absolute after:inset-0 hover:underline focus-visible:after:ring-2 focus-visible:after:ring-ring"
        >
          {article.title}
        </Link>
        <span className="text-xs text-muted-foreground">
          Updated{' '}
          <time dateTime={article.updatedAt}>{dayDate(article.updatedAt)}</time>
        </span>
      </div>
    </div>
  );
}
