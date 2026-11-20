import {
  aiControllerClassifyV1,
  aiControllerGenerateSummaryV1,
  aiControllerGetSuggestionsV1,
  ApiError,
  getAiControllerGetSummaryV1QueryKey,
  useAiControllerGetSummaryV1,
  useTicketsControllerListSimilarV1,
  type TicketResponseDto,
} from '@synapsedesk/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpenIcon,
  CircleAlertIcon,
  RefreshCwIcon,
  SparklesIcon,
  UserPlusIcon,
  ZapOffIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Markdown } from '@/components/markdown';
import { PriorityBadge } from '@/components/tickets/badges';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { useViewer } from '@/hooks/use-viewer';
import { absoluteTime } from '@/lib/format';
import { announce } from '@/lib/toast';
import type { Suggestion } from './assign-dialog';
import { useDepartments } from './use-directory';

const percent = (score: number) => `${Math.round(score * 100)}%`;
const unpaid = (error: unknown) =>
  error instanceof ApiError && error.status === 402;
const missing = (error: unknown) =>
  error instanceof ApiError && error.status === 404;

/**
 * What the AI knows about a ticket: its summary, suggested next steps and
 * articles, a suggested department and priority, and similar resolved
 * tickets. Each section loads, fails and answers 402 on its own; nothing is
 * applied by itself. Suggestions and routing are metered, so they run only
 * when the agent asks. Without `ticket.ai.use`, the summary is read-only and
 * suggestions and routing are gone; similar tickets stay.
 */
export function AiPanel({
  ticket,
  onAssignTo,
}: {
  ticket: TicketResponseDto;
  onAssignTo?: (suggestion: Suggestion) => void;
}) {
  const { can } = useViewer();
  const ai = can('ticket.ai.use');
  const sections = [
    can('ticket.read.all') && <Summary key="s" ticketId={ticket.id} ai={ai} />,
    ai && <Suggestions key="g" ticketId={ticket.id} />,
    ai && <Routing key="r" ticketId={ticket.id} onAssignTo={onAssignTo} />,
    can('ticket.read.all') && <Similar key="m" ticketId={ticket.id} />,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-4">
      {sections.map((section, index) => (
        <div key={index} className="flex flex-col gap-4">
          {index > 0 && <Separator />}
          {section}
        </div>
      ))}
    </div>
  );
}

function Section({
  title,
  action,
  busy,
  children,
}: {
  title: string;
  action?: ReactNode;
  busy?: boolean;
  children: ReactNode;
}) {
  const id = `ai-${title.toLowerCase().replaceAll(' ', '-')}`;
  return (
    <section
      aria-labelledby={id}
      aria-busy={busy || undefined}
      className="flex flex-col gap-3 text-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id={id} className="font-semibold">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Waiting({ children }: { children: string }) {
  return <p className="text-muted-foreground">{children}</p>;
}

function Failed({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <CircleAlertIcon aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        Something went wrong on our side.
        <Button variant="outline" size="xs" onClick={onRetry}>
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function Unpaid({ children }: { children: string }) {
  return (
    <Alert variant="warning" role="alert">
      <ZapOffIcon aria-hidden />
      <AlertTitle>AI isn’t available on your plan right now</AlertTitle>
      <AlertDescription>
        {children} You can keep working on this ticket as usual.
      </AlertDescription>
    </Alert>
  );
}

function Confidence({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground">Confidence</span>
      <Progress aria-hidden value={score * 100} className="w-20" />
      <span>{percent(score)}</span>
    </div>
  );
}

/**
 * A metered AI call that runs only when the agent asks, then keeps its answer
 * for the page's life: asked once, the answer shows again when the panel
 * mounts anew (the sheet, another tab).
 */
function useOnRequest<T>(
  queryKey: readonly unknown[],
  queryFn: () => Promise<T>,
) {
  const [requested, setRequested] = useState(false);
  const query = useQuery({
    queryKey,
    queryFn,
    enabled: requested,
    staleTime: Infinity,
    retry: false,
  });
  return {
    query,
    asked:
      requested ||
      query.isFetching ||
      query.data !== undefined ||
      query.isError,
    ask: () => setRequested(true),
  };
}

/** A metered section before it's run: what it does, and the button that runs it. */
function NotRunYet({
  what,
  action,
  onRun,
}: {
  what: string;
  action: string;
  onRun: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-muted-foreground">{what}</p>
      <Button variant="outline" size="sm" onClick={onRun}>
        <SparklesIcon aria-hidden />
        {action}
      </Button>
    </div>
  );
}

function Summary({ ticketId, ai }: { ticketId: string; ai: boolean }) {
  const queryClient = useQueryClient();
  const stored = useAiControllerGetSummaryV1(ticketId, {
    query: { retry: false },
  });
  const [writing, setWriting] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const generate = async () => {
    setWriting(true);
    setFailure(null);
    try {
      queryClient.setQueryData(
        getAiControllerGetSummaryV1QueryKey(ticketId),
        await aiControllerGenerateSummaryV1(ticketId),
      );
      announce('Summary ready');
    } catch (error) {
      setFailure(error);
    } finally {
      setWriting(false);
    }
  };

  const summary = stored.data?.data;
  const none = missing(stored.error);
  const loadFailed = stored.isError && !none;

  return (
    <Section
      title="Summary"
      busy={stored.isPending || writing}
      action={
        ai &&
        summary &&
        !writing && (
          <Button variant="ghost" size="xs" onClick={() => void generate()}>
            <RefreshCwIcon aria-hidden />
            Regenerate
          </Button>
        )
      }
    >
      {writing ? (
        <Waiting>Writing a summary…</Waiting>
      ) : unpaid(failure) ? (
        <Unpaid>The summary can’t be generated.</Unpaid>
      ) : failure ? (
        <Failed
          title="Couldn’t generate a summary"
          onRetry={() => void generate()}
        />
      ) : loadFailed ? (
        <Failed
          title="Couldn’t load the summary"
          onRetry={() => void stored.refetch()}
        />
      ) : stored.isPending ? null : summary ? (
        <>
          <Markdown>{summary.summaryText}</Markdown>
          <div className="flex flex-col gap-1 rounded-md bg-muted p-3">
            <span className="text-xs text-muted-foreground">
              Suggested action
            </span>
            <span>{summary.suggestedAction}</span>
          </div>
          <Confidence score={summary.confidenceScore} />
          <p className="text-muted-foreground">
            Updated{' '}
            <time dateTime={summary.updatedAt}>
              {absoluteTime(summary.updatedAt)}
            </time>
          </p>
        </>
      ) : ai ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-muted-foreground">
            No summary yet. Generate one to catch up on this ticket.
          </p>
          <Button variant="outline" size="sm" onClick={() => void generate()}>
            Generate
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground">No summary yet.</p>
      )}
    </Section>
  );
}

function Suggestions({ ticketId }: { ticketId: string }) {
  const { query, asked, ask } = useOnRequest(['ai-suggestions', ticketId], () =>
    aiControllerGetSuggestionsV1(ticketId),
  );
  const answer = query.data?.data;
  const refresh = async () => {
    await query.refetch();
    announce('Suggestions updated');
  };

  return (
    <Section
      title="Suggestions"
      busy={query.isFetching}
      action={
        answer &&
        !query.isFetching && (
          <Button variant="ghost" size="xs" onClick={() => void refresh()}>
            <RefreshCwIcon aria-hidden />
            Refresh
          </Button>
        )
      }
    >
      {!asked ? (
        <NotRunYet
          what="Finds next steps and related articles for this ticket. Uses the AI allowance."
          action="Get suggestions"
          onRun={ask}
        />
      ) : query.isFetching ? (
        <Waiting>Finding suggestions…</Waiting>
      ) : query.isError ? (
        <Failed
          title="Couldn’t load suggestions"
          onRetry={() => void query.refetch()}
        />
      ) : answer ? (
        <>
          {answer.degraded === 'LEXICAL_ONLY' && (
            <p className="text-muted-foreground">
              Search was limited, so these may be less relevant.
            </p>
          )}
          {answer.nextSteps.length === 0 && answer.articles.length === 0 ? (
            <p className="text-muted-foreground">
              No suggestions for this ticket.
            </p>
          ) : null}
          {answer.nextSteps.length > 0 && (
            <div className="flex flex-col gap-2">
              <h4 className="text-xs text-muted-foreground">Next steps</h4>
              <ol className="flex flex-col gap-3">
                {answer.nextSteps.map((step, index) => (
                  <li key={step.title} className="flex flex-col gap-1">
                    <span className="flex items-baseline gap-2">
                      <span className="font-medium">
                        {index + 1}. {step.title}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {percent(step.confidenceScore)}
                      </span>
                    </span>
                    <Markdown>{step.body}</Markdown>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {answer.articles.length > 0 && (
            <div className="flex flex-col gap-2">
              <h4 className="text-xs text-muted-foreground">Articles</h4>
              <ul className="flex flex-col gap-2">
                {answer.articles.map((article) => (
                  <li
                    key={`${article.documentId}-${article.pageNumber}`}
                    className="flex items-center gap-2"
                  >
                    <BookOpenIcon
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    {/* No passage on a suggestion: it opens at the article's start. */}
                    <Link
                      href={`/knowledge/articles/${article.documentId}`}
                      className="flex-1 text-primary underline-offset-4 hover:underline"
                    >
                      {article.documentTitle}
                    </Link>
                    {article.pageNumber !== null && (
                      <span className="text-xs text-muted-foreground">
                        p. {article.pageNumber}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : null}
    </Section>
  );
}

function Routing({
  ticketId,
  onAssignTo,
}: {
  ticketId: string;
  onAssignTo?: (suggestion: Suggestion) => void;
}) {
  const departments = useDepartments();
  const { query, asked, ask } = useOnRequest(['ai-classify', ticketId], () =>
    aiControllerClassifyV1(ticketId),
  );
  const answer = query.data?.data;
  const department = answer?.suggestedDepartmentId
    ? (departments.names.get(answer.suggestedDepartmentId) ??
      'Unknown department')
    : null;

  return (
    <Section
      title="Suggested routing"
      busy={query.isFetching}
      action={
        answer &&
        !query.isFetching && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void query.refetch()}
          >
            <RefreshCwIcon aria-hidden />
            Refresh
          </Button>
        )
      }
    >
      {!asked ? (
        <NotRunYet
          what="Suggests a department and a priority. Uses the AI allowance."
          action="Suggest routing"
          onRun={ask}
        />
      ) : query.isFetching ? (
        <Waiting>Classifying…</Waiting>
      ) : unpaid(query.error) ? (
        <Unpaid>Routing can’t be suggested.</Unpaid>
      ) : query.isError ? (
        <Failed
          title="Couldn’t classify this ticket"
          onRetry={() => void query.refetch()}
        />
      ) : answer && department ? (
        <>
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Suggested:</span>
            <span className="font-medium">{department}</span>
            <PriorityBadge priority={answer.suggestedPriority} />
            <span>{percent(answer.confidenceScore)}</span>
          </p>
          {onAssignTo && (
            <Button
              variant="outline"
              size="sm"
              aria-haspopup="dialog"
              onClick={() =>
                onAssignTo({
                  departmentId: answer.suggestedDepartmentId,
                  priority: answer.suggestedPriority,
                  confidence: answer.confidenceScore,
                })
              }
            >
              <UserPlusIcon aria-hidden />
              Assign to {department}
            </Button>
          )}
        </>
      ) : answer ? (
        <p className="text-muted-foreground">No suggestion for this ticket.</p>
      ) : null}
    </Section>
  );
}

function Similar({ ticketId }: { ticketId: string }) {
  const query = useTicketsControllerListSimilarV1(ticketId, {
    query: { retry: false },
  });
  const items = query.data?.data ?? [];

  return (
    <Section title="Similar resolved tickets" busy={query.isPending}>
      {query.isPending ? null : query.isError ? (
        <Failed
          title="Couldn’t load similar tickets"
          onRetry={() => void query.refetch()}
        />
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">No similar resolved tickets.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.ticketId} className="flex items-baseline gap-2">
              <span className="font-mono text-xs text-muted-foreground">
                #{item.ticketNumber}
              </span>
              <Link
                href={`/tickets/${item.ticketId}`}
                className="flex-1 text-primary hover:underline"
              >
                {item.title}
              </Link>
              <span className="text-xs text-muted-foreground">
                {percent(item.similarityScore)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
