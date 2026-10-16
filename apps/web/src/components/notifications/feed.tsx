'use client';

import {
  notificationsControllerListV1,
  type NotificationResponseDto,
} from '@synapsedesk/api-client';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import {
  ArchiveIcon,
  BellOffIcon,
  CheckCheckIcon,
  CheckIcon,
  CircleAlertIcon,
  FilterIcon,
  SearchXIcon,
  SettingsIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Toggle } from '@/components/ui/toggle';
import { usePeople } from '@/components/ticket/use-directory';
import { useViewer } from '@/hooks/use-viewer';
import {
  dayHeading,
  NOTIFICATION_GROUPS,
  NOTIFICATION_TYPES,
  typesFor,
  type NotificationType,
} from '@/lib/notifications';
import { announce } from '@/lib/toast';
import { actorName } from './bell';
import { NotificationItem } from './notification-item';
import { NOTIFICATIONS, useNotificationActions, useUnreadCount } from './store';

const PAGE = 20;
const ALL = 'all';
/**
 * The most a selection holds. There's no bulk archive, so archiving a
 * selection is one request per item.
 */
// ponytail: 50 at a time; a bulk-archive route when people need more.
export const MAX_SELECTION = 50;

type Filters = {
  unreadOnly?: true;
  includeArchived?: true;
  type?: NotificationType;
};

/**
 * Every notification, newest first by cursor ("Load more"), under day
 * headings, with the filters and a selection for marking read or archiving
 * several at once.
 */
export function NotificationFeed() {
  const { can } = useViewer();
  const unread = useUnreadCount();
  const actions = useNotificationActions();
  const { names } = usePeople();
  const [filters, setFilters] = useState<Filters>({});
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const feed = useInfiniteQuery({
    queryKey: [NOTIFICATIONS, 'feed', filters],
    queryFn: async ({ pageParam, signal }) => {
      const answer = await notificationsControllerListV1(
        {
          limit: PAGE,
          ...filters,
          type: filters.type,
          cursor: pageParam,
        },
        { signal },
      );
      if (!answer.data) throw new Error('No notifications');
      return answer.data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.hasMore ? (last.nextCursor ?? undefined) : undefined,
    placeholderData: keepPreviousData,
  });
  const items = feed.data?.pages.flatMap((page) => page.items);
  const filtered = Object.keys(filters).length > 0;
  const unreadIds = (items ?? []).filter((n) => !n.readAt).map((n) => n.id);

  const change = (next: Filters) => {
    setFilters(next);
    setSelected(new Set());
  };
  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div className="mx-auto flex w-full max-w-198 flex-col gap-4 px-4 py-6 md:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">
            Notifications
          </h1>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {unread !== null && `${unread} unread`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unreadIds.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void actions.markManyRead(unreadIds)}
            >
              <CheckCheckIcon aria-hidden />
              Mark all as read
            </Button>
          )}
          <Link
            href="/notifications/settings"
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            <SettingsIcon aria-hidden />
            Settings
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Toggle
          variant="outline"
          size="sm"
          pressed={Boolean(filters.unreadOnly)}
          onPressedChange={(pressed) =>
            change({ ...filters, unreadOnly: pressed || undefined })
          }
          className="data-[state=on]:border-primary"
        >
          {filters.unreadOnly ? <CheckIcon /> : <FilterIcon />}
          Unread only
        </Toggle>
        <Select
          value={filters.type ?? ALL}
          onValueChange={(value) =>
            change({
              ...filters,
              type: value === ALL ? undefined : (value as NotificationType),
            })
          }
        >
          <SelectTrigger size="sm" aria-label="Type" className="w-auto gap-2">
            <span className="text-muted-foreground">Type:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="shadow-md">
            <SelectItem value={ALL}>All types</SelectItem>
            {NOTIFICATION_GROUPS.map((group) => {
              const types = typesFor(can('organization.update')).filter(
                (type) => NOTIFICATION_TYPES[type].group === group,
              );
              if (types.length === 0) return null;
              return (
                <SelectGroup key={group}>
                  <SelectLabel>{group}</SelectLabel>
                  {types.map((type) => (
                    <SelectItem key={type} value={type}>
                      {NOTIFICATION_TYPES[type].label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              );
            })}
          </SelectContent>
        </Select>
        <Toggle
          variant="outline"
          size="sm"
          pressed={Boolean(filters.includeArchived)}
          onPressedChange={(pressed) =>
            change({ ...filters, includeArchived: pressed || undefined })
          }
          className="data-[state=on]:border-primary"
        >
          {filters.includeArchived ? <CheckIcon /> : <ArchiveIcon />}
          Show archived
        </Toggle>
      </div>

      {selected.size > 0 && (
        <div
          role="toolbar"
          aria-label="Selected notifications"
          className="flex flex-wrap items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground"
        >
          <span aria-live="polite" className="mr-auto font-medium">
            {selected.size} selected
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void actions
                .markManyRead([...selected])
                .then(() => setSelected(new Set()))
            }
          >
            <CheckCheckIcon aria-hidden />
            Mark as read
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void actions
                .archiveMany([...selected])
                .then(() => setSelected(new Set()))
            }
          >
            <ArchiveIcon aria-hidden />
            Archive
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
        </div>
      )}

      {feed.isError && !items ? (
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden />
          <AlertTitle>
            <h2>Couldn’t load notifications</h2>
          </AlertTitle>
          <AlertDescription>
            Something went wrong on our side. Try again in a moment.
            <Button
              variant="outline"
              size="sm"
              onClick={() => void feed.refetch()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : !items ? (
        <div
          aria-busy
          className="flex flex-col overflow-hidden rounded-lg border"
        >
          <span className="sr-only" role="status">
            Loading notifications
          </span>
          {Array.from({ length: 5 }, (_, row) => (
            <div key={row} className="flex gap-3 border-b p-3 last:border-0">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3.5 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        filtered ? (
          <Empty
            icon={<SearchXIcon />}
            title="No notifications match"
            description="Try other filters, or clear them."
            action={
              <Button variant="outline" size="sm" onClick={() => change({})}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <Empty
            icon={<BellOffIcon />}
            title="No notifications yet"
            description="When something needs you, like a ticket assigned to you, it shows up here."
          />
        )
      ) : (
        <>
          <div
            aria-busy={feed.isFetching || undefined}
            className="overflow-hidden rounded-lg border bg-card"
          >
            {byDay(items).map(([day, group]) => (
              <section key={day} aria-label={day}>
                <h2 className="border-b bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  {day}
                </h2>
                <ul className="flex flex-col divide-y border-b last:border-b-0">
                  {group.map((notification) => (
                    <li key={notification.id}>
                      <NotificationItem
                        notification={notification}
                        actorName={actorName(notification, names)}
                        selected={selected.has(notification.id)}
                        selectDisabled={
                          selected.size >= MAX_SELECTION &&
                          !selected.has(notification.id)
                        }
                        onSelect={(on) => toggle(notification.id, on)}
                        onOpen={() => {
                          if (!notification.readAt) {
                            void actions.markRead(notification.id, true);
                          }
                        }}
                        onMarkRead={() =>
                          void actions.markRead(notification.id)
                        }
                        onArchive={() => void actions.archive(notification.id)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {feed.hasNextPage ? (
            <Button
              variant="outline"
              size="sm"
              className="self-center"
              disabled={feed.isFetchingNextPage}
              onClick={() =>
                void feed.fetchNextPage().then((result) => {
                  const added = result.data?.pages.at(-1)?.items.length ?? 0;
                  announce(`${added} more loaded`);
                })
              }
            >
              Load more
            </Button>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              That’s everything.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** The notifications under their day headings, in the order they came. */
function byDay(
  items: NotificationResponseDto[],
): [string, NotificationResponseDto[]][] {
  const days = new Map<string, NotificationResponseDto[]>();
  for (const item of items) {
    const day = dayHeading(item.createdAt);
    days.set(day, [...(days.get(day) ?? []), item]);
  }
  return [...days];
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
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
      <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-5">
        {icon}
      </div>
      <h2 className="font-medium">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}
