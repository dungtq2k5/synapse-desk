'use client';

import {
  useFeedbackControllerListV1,
  type FeedbackResponseDto,
} from '@synapsedesk/api-client';
import {
  ChevronRightIcon,
  CircleCheckIcon,
  CircleXIcon,
  MessageSquareIcon,
  MinusIcon,
  SearchIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { Empty, Pagination } from '@/components/documents/parts';
import { LoadError } from '@/components/settings/settings-frame';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { clockTime, dayDate } from '@/lib/format';
import { AnalyticsFrame, DataThrough, useAnalyticsFilters } from './frame';

const PAGE_SIZE = 20;

const RATINGS = { all: 'All ratings', '1': 'Helpful', '-1': 'Not helpful' };
const CITATIONS = {
  any: 'Any citations',
  true: 'Accurate',
  false: 'Inaccurate',
};

/** The start of a calendar day and the end of another, on the reader's clock. */
const startOf = (day: string) => new Date(`${day}T00:00:00`).toISOString();
const endOf = (day: string) => new Date(`${day}T23:59:59.999`).toISOString();

/**
 * Analytics › Feedback: what people said about AI answers, newest first, read
 * live. Each row opens the rated answer's ticket.
 */
export function FeedbackView() {
  const filters = useAnalyticsFilters();
  const { from, to } = filters.filters;
  const [search, setSearch] = useState('');
  const [rating, setRating] = useState<keyof typeof RATINGS>('all');
  const [citations, setCitations] = useState<keyof typeof CITATIONS>('any');
  const [page, setPage] = useState(1);
  const term = useDeferredValue(search.trim());
  const filtered = term !== '' || rating !== 'all' || citations !== 'any';
  const list = useFeedbackControllerListV1(
    {
      page,
      limit: PAGE_SIZE,
      sortBy: 'createdAt',
      sortOrder: 'DESC',
      from: startOf(from),
      to: endOf(to),
      ...(term ? { searchTerm: term } : {}),
      ...(rating !== 'all' ? { rating: Number(rating) as 1 | -1 } : {}),
      ...(citations !== 'any'
        ? { citationAccurate: citations === 'true' }
        : {}),
    },
    { query: { enabled: filters.ready, refetchInterval: 30_000 } },
  );
  const data = list.data?.data;
  const clear = () => {
    setSearch('');
    setRating('all');
    setCitations('any');
    setPage(1);
  };

  let results;
  if (list.isError) {
    results = (
      <LoadError what="the feedback" onRetry={() => void list.refetch()} />
    );
  } else if (!data) {
    results = (
      <div aria-busy>
        <span className="sr-only" role="status">
          Loading analytics
        </span>
        <Skeleton aria-hidden className="h-80 w-full rounded-xl" />
      </div>
    );
  } else if (data.items.length === 0) {
    results = filtered ? (
      <Empty
        icon={<SearchIcon aria-hidden />}
        title="No feedback matches"
        description="Try other words, or clear the filters."
        action={
          <Button variant="outline" size="sm" onClick={clear}>
            Clear filters
          </Button>
        }
      />
    ) : (
      <Empty
        icon={<MessageSquareIcon aria-hidden />}
        title="No feedback yet"
        description="When people rate AI answers with thumbs up or down, their ratings and comments appear here."
      />
    );
  } else {
    results = (
      <>
        <div className="hidden overflow-hidden rounded-md border md:block">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Rating</TableHead>
                <TableHead>Comment</TableHead>
                <TableHead>Citations</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Answer</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Rating item={item} />
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <Comment item={item} />
                  </TableCell>
                  <TableCell>
                    <Citations item={item} />
                  </TableCell>
                  <TableCell className="tabular-nums">{when(item)}</TableCell>
                  <TableCell>
                    <Answer item={item} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <ul className="flex flex-col gap-3 md:hidden">
          {data.items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-2 rounded-lg border p-3 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <Rating item={item} />
                <Citations item={item} />
              </div>
              <Comment item={item} />
              <div className="flex items-center justify-between gap-2 text-muted-foreground">
                <span className="tabular-nums">{when(item)}</span>
                <Answer item={item} />
              </div>
            </li>
          ))}
        </ul>
        <Pagination meta={data.meta} onPage={setPage} noun="feedback" />
      </>
    );
  }

  return (
    <AnalyticsFrame
      section="feedback"
      filters={filters}
      departments={false}
      granularity={false}
      status={<DataThrough live />}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row">
          <div className="relative md:w-70">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              aria-label="Search comments"
              placeholder="Search comments"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>
          <Select
            value={rating}
            onValueChange={(value) => {
              setRating(value as keyof typeof RATINGS);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Rating" className="w-full md:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(RATINGS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={citations}
            onValueChange={(value) => {
              setCitations(value as keyof typeof CITATIONS);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Citations" className="w-full md:w-42">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CITATIONS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {results}
      </div>
    </AnalyticsFrame>
  );
}

const when = (item: FeedbackResponseDto) =>
  `${dayDate(item.createdAt)}, ${clockTime(item.createdAt)}`;

function Rating({ item }: { item: FeedbackResponseDto }) {
  const helpful = item.rating === 1;
  const Icon = helpful ? ThumbsUpIcon : ThumbsDownIcon;
  return (
    <span className="inline-flex items-center gap-2">
      <Icon aria-hidden className="size-4" />
      {helpful ? 'Helpful' : 'Not helpful'}
    </span>
  );
}

function Comment({ item }: { item: FeedbackResponseDto }) {
  return item.feedbackText ? (
    <span>{item.feedbackText}</span>
  ) : (
    <span className="text-muted-foreground">No comment</span>
  );
}

function Citations({ item }: { item: FeedbackResponseDto }) {
  if (item.citationAccurate === true) {
    return (
      <Badge variant="success" className="rounded-full">
        <CircleCheckIcon aria-hidden />
        Accurate
      </Badge>
    );
  }
  if (item.citationAccurate === false) {
    return (
      <Badge
        variant="outline"
        className="rounded-full border-destructive-border bg-destructive-subtle text-destructive-subtle-foreground"
      >
        <CircleXIcon aria-hidden />
        Inaccurate
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="rounded-full bg-muted text-muted-foreground"
    >
      <MinusIcon aria-hidden />
      Not rated
    </Badge>
  );
}

function Answer({ item }: { item: FeedbackResponseDto }) {
  if (!item.ticketId || item.ticketNumber === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <Link
      href={`/tickets/${item.ticketId}`}
      className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
    >
      {`Ticket #${item.ticketNumber}`}
      <ChevronRightIcon aria-hidden className="size-4" />
    </Link>
  );
}
