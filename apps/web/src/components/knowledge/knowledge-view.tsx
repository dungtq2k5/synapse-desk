'use client';

import {
  ApiError,
  knowledgeControllerAskV1,
  knowledgeControllerSearchV1,
  useKnowledgeControllerListArticlesV1,
  useOrganizationsControllerGetV1,
  type KnowledgeAskResponseDto,
  type RetrievedChunkResponseDto,
} from '@synapsedesk/api-client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  BotIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  FileTextIcon,
  FilterIcon,
  InfoIcon,
  LoaderCircleIcon,
  MessageCircleIcon,
  SearchIcon,
  SearchXIcon,
  XIcon,
  ZapOffIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { handOffQuestion, ListCard } from '@/components/ask/ask-view';
import { Markdown } from '@/components/markdown';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useViewer } from '@/hooks/use-viewer';
import { cn } from '@/lib/utils';
import { ArticleRow } from './article-row';
import { Citations, passageHref } from './citations';
import { highlight } from './highlight';
import { KnowledgeHeader } from './knowledge-header';

const ARTICLES_PAGE = 8;

/**
 * Knowledge: a search of the organization's documents, with the AI's answer
 * on top and the passages below, both sent once typing pauses. Before a
 * search, the articles. A stale request is canceled when the query changes,
 * and a slow answer never holds back the passages.
 */
export function KnowledgeView() {
  const organization =
    useOrganizationsControllerGetV1({ query: { retry: false } }).data?.data
      ?.name ?? 'your organization';
  const [typed, setTyped] = useState('');
  const settled = useDebounced(typed.trim(), 400);
  // Cleared at once, rather than once the pause has passed.
  const query = typed.trim() ? settled : '';
  const input = useRef<HTMLInputElement>(null);
  const manager = useViewer().can('document.read');

  const clear = () => {
    setTyped('');
    input.current?.focus();
  };

  return (
    <div
      className={cn(
        'flex w-full max-w-188 flex-col gap-5 px-4 py-8 md:py-12',
        // With the tabs, Search lines up with Documents and Quality flags.
        manager ? 'md:px-6 md:py-6' : 'mx-auto',
      )}
    >
      <KnowledgeHeader
        tab="search"
        description={`Search ${organization}’s documents. An AI answer appears on top, with the passages it came from below.`}
      />

      <div className="relative">
        <SearchIcon
          aria-hidden
          className="absolute top-3.5 left-3.5 size-4 text-muted-foreground"
        />
        <Input
          ref={input}
          type="search"
          aria-label="Search the knowledge base"
          placeholder="Search the knowledge base"
          maxLength={1000}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setTyped('');
          }}
          className="h-11 pr-11 pl-10 text-base [&::-webkit-search-cancel-button]:hidden"
        />
        {typed && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Clear search"
            className="absolute top-1.5 right-1.5"
            onClick={clear}
          >
            <XIcon aria-hidden />
          </Button>
        )}
      </div>

      {query ? (
        <Results
          key={query}
          query={query}
          organization={organization}
          onBrowse={clear}
        />
      ) : (
        <Articles organization={organization} />
      )}
    </div>
  );
}

function Results({
  query,
  organization,
  onBrowse,
}: {
  query: string;
  organization: string;
  onBrowse: () => void;
}) {
  const search = useQuery({
    queryKey: ['knowledge-search', query],
    queryFn: async ({ signal }) =>
      (await knowledgeControllerSearchV1({ query }, { signal })).data,
    retry: false,
    staleTime: 60_000,
  });
  const answer = useQuery({
    queryKey: ['knowledge-ask', query],
    queryFn: async ({ signal }) =>
      (await knowledgeControllerAskV1({ message: query }, { signal })).data,
    retry: false,
    staleTime: Infinity,
  });

  const chunks = search.data?.chunks;
  return (
    <>
      <AnswerCard
        query={query}
        organization={organization}
        state={answer}
        onRetry={() => void answer.refetch()}
      />
      {search.isError ? (
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden />
          <AlertTitle>Couldn’t search the knowledge base</AlertTitle>
          <AlertDescription>
            Something went wrong on our side. Try again in a moment.
            <Button
              variant="outline"
              size="sm"
              onClick={() => void search.refetch()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : !chunks ? (
        <div aria-busy className="flex flex-col gap-6">
          {Array.from({ length: 3 }, (_, row) => (
            <div key={row} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      ) : chunks.length === 0 ? (
        <Empty
          icon={<SearchXIcon />}
          title={`No passages match “${query}”`}
          description="Try other words, or browse the articles."
          action={
            <Button variant="outline" size="sm" onClick={onBrowse}>
              Browse articles
            </Button>
          }
        />
      ) : (
        <section aria-label="Passages" className="flex flex-col gap-4">
          {search.data?.degraded === 'LEXICAL_ONLY' && (
            <Alert variant="info">
              <InfoIcon aria-hidden />
              <AlertDescription>
                Search was limited, so these may be less relevant.
              </AlertDescription>
            </Alert>
          )}
          <p className="text-sm text-muted-foreground">
            {chunks.length === 1 ? '1 passage' : `${chunks.length} passages`}
          </p>
          <ul className="flex flex-col">
            {chunks.map((chunk) => (
              <Passage key={chunk.chunkId} chunk={chunk} query={query} />
            ))}
          </ul>
        </section>
      )}
      <p className="sr-only" aria-live="polite">
        {chunks && chunks.length > 0 && `${chunks.length} passages found`}
      </p>
    </>
  );
}

function Passage({
  chunk,
  query,
}: {
  chunk: RetrievedChunkResponseDto;
  query: string;
}) {
  return (
    <li className="relative flex flex-col gap-1.5 border-b py-4 first:pt-0">
      <span className="flex items-center gap-2 text-sm">
        <FileTextIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
        <Link
          href={passageHref(chunk.documentId, chunk.chunkId)}
          className="truncate text-primary outline-none after:absolute after:inset-0 hover:underline focus-visible:after:ring-2 focus-visible:after:ring-ring"
        >
          {chunk.documentTitle}
        </Link>
        {chunk.pageNumber !== null && (
          <span className="shrink-0 text-xs text-muted-foreground">
            p. {chunk.pageNumber}
          </span>
        )}
      </span>
      <p className="line-clamp-4 text-sm">
        {highlight(chunk.contentText, query)}
      </p>
    </li>
  );
}

type AnswerState = {
  data: KnowledgeAskResponseDto | undefined;
  error: unknown;
  isPending: boolean;
  isError: boolean;
};

/**
 * The AI's answer to the search, on 02's AI surface. A greeting gets no card,
 * and with the allowance used up (402, or `AT_CAP`) the card steps aside for
 * one muted line. Nothing here blocks the passages.
 */
function AnswerCard({
  query,
  organization,
  state,
  onRetry,
}: {
  query: string;
  organization: string;
  state: AnswerState;
  onRetry: () => void;
}) {
  const router = useRouter();
  const answer = state.data;
  const status = answer?.status;
  const atCap =
    status === 'AT_CAP' ||
    (state.error instanceof ApiError && state.error.status === 402);

  if (status === 'GREETING') return null;
  if (atCap) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <ZapOffIcon aria-hidden className="size-4 shrink-0" />
        AI answers aren’t available on your plan right now. The passages below
        still match your search.
      </p>
    );
  }
  if (state.isError) {
    return (
      <Alert variant="destructive">
        <CircleAlertIcon aria-hidden />
        <AlertDescription>
          Couldn’t get an answer. The passages below still match your search.
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const conversation = (
    <Button
      variant="outline"
      size="sm"
      className="self-start bg-background"
      onClick={() => {
        handOffQuestion(query);
        router.push('/ask');
      }}
    >
      <MessageCircleIcon aria-hidden />
      Ask as a conversation
    </Button>
  );
  const sources = answer?.citations.length ?? 0;
  const answered = status === 'DOC_ANSWER';

  return (
    <section
      aria-label="AI answer"
      aria-busy={state.isPending || undefined}
      className="flex flex-col gap-3 rounded-lg border border-l-4 border-author-ai-border bg-author-ai-bg p-4 text-sm text-author-ai-fg"
    >
      <header className="flex flex-wrap items-center gap-2 text-xs">
        <Badge>
          <BotIcon aria-hidden />
          {answered ? 'AI answer' : 'AI'}
        </Badge>
        <span className="font-medium">
          {answered
            ? `From ${sources} ${sources === 1 ? 'source' : 'sources'} in ${organization}’s documents`
            : 'SynapseDesk AI'}
        </span>
      </header>
      {state.isPending ? (
        <>
          <p className="flex items-center gap-2">
            <LoaderCircleIcon
              aria-hidden
              className="size-4 motion-safe:animate-spin"
            />
            Writing an answer… This takes a few seconds.
          </p>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-2.5 w-full bg-author-ai-border/20" />
            <Skeleton className="h-2.5 w-full bg-author-ai-border/20" />
            <Skeleton className="h-2.5 w-1/2 bg-author-ai-border/20" />
          </div>
        </>
      ) : status === 'DOC_MISSING' ? (
        <>
          <p>{`I couldn’t find this in ${organization}’s documents.`}</p>
          <Footer icon={<SearchXIcon aria-hidden />}>
            Ask it as a conversation, and a person from the support team can
            take over.
          </Footer>
          {conversation}
        </>
      ) : status === 'REFUSED' ? (
        <>
          <p>I can’t answer that here.</p>
          <Footer icon={<CircleAlertIcon aria-hidden />}>
            Rephrase your search, or ask it as a conversation so a person can
            help.
          </Footer>
          {conversation}
        </>
      ) : (
        <>
          <Markdown>{answer?.content ?? ''}</Markdown>
          {sources > 0 && <Citations citations={answer?.citations ?? []} />}
        </>
      )}
      <p className="sr-only" aria-live="polite">
        {answer && 'AI answer ready'}
      </p>
    </section>
  );
}

function Footer({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-xs [&_svg]:mt-0.5 [&_svg]:size-3.5 [&_svg]:shrink-0">
      {icon}
      <span>{children}</span>
    </p>
  );
}

/**
 * The articles, newest change first, filtered by title and paged. With none at
 * all, the organization has no documents yet, and the page says so.
 */
function Articles({ organization }: { organization: string }) {
  const [typed, setTyped] = useState('');
  const searchTerm = useDebounced(typed.trim(), 300) || undefined;
  // A new filter starts again from page 1.
  const [paging, setPaging] = useState({ searchTerm, page: 1 });
  const page = paging.searchTerm === searchTerm ? paging.page : 1;
  const setPage = (next: number) => setPaging({ searchTerm, page: next });
  const list = useKnowledgeControllerListArticlesV1(
    {
      page,
      limit: ARTICLES_PAGE,
      sortBy: 'updatedAt',
      sortOrder: 'DESC',
      searchTerm,
    },
    { query: { placeholderData: keepPreviousData } },
  );
  const data = list.data?.data;
  const meta = data?.meta;

  if (data && meta?.totalItems === 0 && !searchTerm) {
    return (
      <Alert variant="info">
        <InfoIcon aria-hidden />
        <AlertTitle>No documents yet</AlertTitle>
        <AlertDescription>
          {`${organization} hasn’t added documents yet, so searches won’t find anything. You can still ask a question, and a person will reply.`}
          <Link
            href="/ask"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Ask a question
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  const from = meta ? (meta.currentPage - 1) * meta.itemsPerPage + 1 : 0;
  const to = meta ? from + meta.itemCount - 1 : 0;
  return (
    <ListCard
      title="Articles"
      action={
        <div className="relative w-44 sm:w-56">
          <FilterIcon
            aria-hidden
            className="absolute top-2.5 left-3 size-4 text-muted-foreground"
          />
          <Input
            aria-label="Filter by title"
            placeholder="Filter by title"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            className="h-9 pl-9"
          />
        </div>
      }
    >
      {list.isError && !data ? (
        <div className="p-4">
          <Alert variant="destructive">
            <CircleAlertIcon aria-hidden />
            <AlertDescription>
              Something went wrong on our side. Try again in a moment.
              <Button
                variant="outline"
                size="sm"
                onClick={() => void list.refetch()}
              >
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      ) : !data ? (
        Array.from({ length: 4 }, (_, row) => (
          <div key={row} className="flex flex-col gap-2 px-4 py-3">
            <Skeleton className="h-3.5 w-48" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))
      ) : data.items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          No articles yet.
        </p>
      ) : (
        <>
          {data.items.map((article) => (
            <ArticleRow key={article.id} article={article} />
          ))}
          {meta && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <p className="text-muted-foreground">
                Showing {from}–{to} of {meta.totalItems}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={meta.currentPage <= 1}
                  onClick={() => setPage(meta.currentPage - 1)}
                >
                  <ChevronLeftIcon aria-hidden />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={meta.currentPage >= meta.totalPages}
                  onClick={() => setPage(meta.currentPage + 1)}
                >
                  Next
                  <ChevronRightIcon aria-hidden />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </ListCard>
  );
}

function Empty({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
      <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-5">
        {icon}
      </div>
      <h2 className="font-medium">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}

/** `value`, once it has stopped changing for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = globalThis.setTimeout(() => setSettled(value), ms);
    return () => globalThis.clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
