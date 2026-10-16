'use client';

import {
  ApiError,
  documentsControllerDownloadV1,
  knowledgeControllerGetArticleV1,
  type KnowledgeArticleBlockResponseDto,
} from '@synapsedesk/api-client';
import { useInfiniteQuery } from '@tanstack/react-query';
import { CircleAlertIcon, DownloadIcon, TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { Fragment, useCallback, useRef, useState } from 'react';
import { AppHeader } from '@/components/shell/app-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { dayDate } from '@/lib/format';
import { toastError } from '@/lib/toast';

/** Blocks per page: the reader's paging, not the document's. */
const BLOCKS = 20;
/** The opening page: the one holding the passage, or the first. */
const OPENING = 0;

/**
 * One article, read in pages of blocks. Opened from a citation or a passage,
 * it starts at the page holding that passage, highlights it, scrolls to it
 * and moves focus there; "Show earlier passages" and "Show later passages"
 * load the pages around it.
 */
export function ArticleReader({
  articleId,
  passage,
}: {
  articleId: string;
  passage?: string;
}) {
  const article = useInfiniteQuery({
    queryKey: ['knowledge-article', articleId, passage ?? null],
    queryFn: async ({ pageParam, signal }) => {
      const answer = await knowledgeControllerGetArticleV1(
        articleId,
        pageParam === OPENING
          ? { limit: BLOCKS, passage }
          : { page: pageParam, limit: BLOCKS },
        { signal },
      );
      if (!answer.data) throw new Error('No article');
      return answer.data;
    },
    initialPageParam: OPENING,
    getNextPageParam: ({ meta }) =>
      meta.currentPage < meta.totalPages ? meta.currentPage + 1 : undefined,
    getPreviousPageParam: ({ meta }) =>
      meta.currentPage > 1 ? meta.currentPage - 1 : undefined,
    retry: false,
  });
  const [loaded, setLoaded] = useState('');

  // The cited block takes focus once, when it first appears.
  const focused = useRef(false);
  const cite = useCallback((node: HTMLDivElement | null) => {
    if (!node || focused.current) return;
    focused.current = true;
    node.scrollIntoView({ block: 'center' });
    node.focus({ preventScroll: true });
  }, []);

  const pages = article.data?.pages;
  const first = pages?.[0];
  const title = first?.article.title;

  const more = async (direction: 'earlier' | 'later') => {
    const result =
      direction === 'earlier'
        ? await article.fetchPreviousPage()
        : await article.fetchNextPage();
    const added = result.data?.pages.at(direction === 'earlier' ? 0 : -1);
    if (added) setLoaded(`${added.blocks.length} more passages loaded`);
  };

  if (article.isError) {
    const gone =
      article.error instanceof ApiError &&
      [400, 403, 404].includes(article.error.status);
    return (
      <>
        <AppHeader
          crumbs={[
            { label: 'Knowledge', href: '/knowledge' },
            { label: gone ? 'Not found' : 'Error' },
          ]}
        />
        <main id="main" tabIndex={-1} className="outline-none">
          <div className="mx-auto w-full max-w-188 px-4 py-8 md:py-12">
            {gone ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
                <h1 className="text-lg font-semibold">
                  This article isn’t available
                </h1>
                <p className="max-w-sm text-sm text-muted-foreground">
                  It may have been removed, or you may not have access to it.
                </p>
                <Link
                  href="/knowledge"
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  Back to Knowledge
                </Link>
              </div>
            ) : (
              <Alert variant="destructive">
                <CircleAlertIcon aria-hidden />
                <AlertTitle>
                  <h1>Couldn’t load the article</h1>
                </AlertTitle>
                <AlertDescription>
                  Something went wrong on our side. Try again in a moment.
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void article.refetch()}
                  >
                    Try again
                  </Button>
                </AlertDescription>
              </Alert>
            )}
          </div>
        </main>
      </>
    );
  }

  const opening = article.data?.pageParams.indexOf(OPENING) ?? -1;
  const citedIndex = pages?.[opening]?.passageIndex ?? null;

  return (
    <>
      <AppHeader
        crumbs={[
          { label: 'Knowledge', href: '/knowledge' },
          { label: title ?? '…' },
        ]}
      />
      <main id="main" tabIndex={-1} className="outline-none">
        {!pages || !first ? (
          <div
            aria-busy
            className="mx-auto flex w-full max-w-188 flex-col gap-4 px-4 py-8 md:py-12"
          >
            <span className="sr-only" role="status">
              Loading article
            </span>
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-4 h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : (
          <article className="mx-auto flex w-full max-w-188 flex-col gap-5 px-4 py-8 md:py-12">
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-1">
                <h1 className="text-3xl font-semibold tracking-tight wrap-break-word">
                  {first.article.title}
                </h1>
                <p className="text-sm text-muted-foreground">
                  Updated{' '}
                  <time dateTime={first.article.updatedAt}>
                    {dayDate(first.article.updatedAt)}
                  </time>
                </p>
              </div>
              <DownloadButton documentId={articleId} />
            </header>

            {first.hasUnindexedPages && (
              <Alert variant="warning">
                <TriangleAlertIcon aria-hidden />
                <AlertTitle>Some pages couldn’t be read</AlertTitle>
                <AlertDescription>
                  They aren’t shown here. The original has everything.
                  <DownloadButton documentId={articleId} link />
                </AlertDescription>
              </Alert>
            )}

            {article.hasPreviousPage && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={article.isFetchingPreviousPage}
                onClick={() => void more('earlier')}
              >
                Show earlier passages
              </Button>
            )}

            <div className="flex flex-col gap-4">
              {pages.map((page, pageIndex) =>
                page.blocks.map((block, index) => {
                  const before =
                    index > 0
                      ? page.blocks[index - 1]
                      : pages[pageIndex - 1]?.blocks.at(-1);
                  const cited = pageIndex === opening && index === citedIndex;
                  return (
                    <Fragment key={block.chunkIndex}>
                      {block.pageNumber !== null &&
                        block.pageNumber !== before?.pageNumber && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="shrink-0">
                              Page {block.pageNumber}
                            </span>
                            <Separator className="flex-1" />
                          </div>
                        )}
                      <Block block={block} cited={cited} citeRef={cite} />
                    </Fragment>
                  );
                }),
              )}
            </div>

            {article.hasNextPage && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={article.isFetchingNextPage}
                onClick={() => void more('later')}
              >
                Show later passages
              </Button>
            )}
            <p className="sr-only" aria-live="polite">
              {loaded}
            </p>
          </article>
        )}
      </main>
    </>
  );
}

function Block({
  block,
  cited,
  citeRef,
}: {
  block: KnowledgeArticleBlockResponseDto;
  cited: boolean;
  citeRef: (node: HTMLDivElement | null) => void;
}) {
  if (!cited) {
    return (
      <p className="text-base whitespace-pre-wrap wrap-break-word">
        {block.contentText}
      </p>
    );
  }
  return (
    <div
      ref={citeRef}
      tabIndex={-1}
      aria-label="Cited passage"
      role="region"
      className="flex flex-col gap-1 rounded-r-md border-l-3 border-primary bg-accent px-4 py-3 text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="text-xs font-medium">Cited passage</span>
      <p className="text-base whitespace-pre-wrap wrap-break-word">
        {block.contentText}
      </p>
    </div>
  );
}

/**
 * Opens the original through a short-lived link. The tab opens on the click,
 * so no popup blocker stops it, and is pointed at the link once known.
 */
function DownloadButton({
  documentId,
  link,
}: {
  documentId: string;
  link?: boolean;
}) {
  const download = async () => {
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      const answer = await documentsControllerDownloadV1(documentId);
      if (!answer.data) throw new Error('No download link');
      if (tab) tab.location.href = answer.data.downloadUrl;
    } catch {
      tab?.close();
      toastError('Couldn’t download the original', 'Try again in a moment.');
    }
  };
  return link ? (
    <Button
      variant="link"
      size="sm"
      className="h-auto self-start p-0"
      onClick={() => void download()}
    >
      Download original
    </Button>
  ) : (
    <Button variant="outline" size="sm" onClick={() => void download()}>
      <DownloadIcon aria-hidden />
      Download original
    </Button>
  );
}
