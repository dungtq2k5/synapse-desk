'use client';

import {
  getNotificationsControllerUnreadCountV1QueryKey,
  notificationsControllerArchiveV1,
  notificationsControllerMarkManyReadV1,
  notificationsControllerMarkReadV1,
  useNotificationsControllerUnreadCountV1,
  type ApiResponseMarkReadResponseDto,
  type ApiResponseUnreadCountResponseDto,
} from '@synapsedesk/api-client';
import {
  NotificationPriority,
  REALTIME_EVENTS,
  type NotificationReadPayload,
  type NotificationRealtimePayload,
} from '@synapsedesk/contracts';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
import { announce, toastError } from '@/lib/toast';
import { NotificationToast } from './notification-toast';

/** Every notifications query (the bell's list, the feed, the count) starts with this. */
export const NOTIFICATIONS = '/api/v1/notifications';

/** How long a `NORMAL` (or `LOW`) toast stays; `HIGH` and `CRITICAL` stay until dismissed. */
const TOAST_MS = 6_000;
/** How long the count must hold still before it's announced. */
const ANNOUNCE_AFTER_MS = 2_000;

/** The server's unread count, or `null` before it's known. Never counted here. */
export function useUnreadCount(): number | null {
  const query = useNotificationsControllerUnreadCountV1({
    query: { staleTime: Infinity },
  });
  return query.data?.data?.count ?? null;
}

/** Puts the server's count in the cache: from the socket, or a write's answer. */
function setCount(queryClient: QueryClient, count: number) {
  queryClient.setQueryData<ApiResponseUnreadCountResponseDto>(
    getNotificationsControllerUnreadCountV1QueryKey(),
    (old) => ({
      success: true,
      statusCode: 200,
      message: 'OK',
      warning: null,
      ...old,
      data: { count },
    }),
  );
}

/** The bell's list and the feed, fetched again; the count is left alone. */
function refetchLists(queryClient: QueryClient) {
  void queryClient.invalidateQueries({
    predicate: ({ queryKey }) => queryKey[0] === NOTIFICATIONS,
  });
}

/**
 * Reading and archiving. Each write's answer carries the server's unread
 * count, which the badge takes; the lists are fetched again.
 */
export function useNotificationActions() {
  const queryClient = useQueryClient();
  const settle = useCallback(
    (answer: ApiResponseMarkReadResponseDto) => {
      if (answer.data) setCount(queryClient, answer.data.unreadCount);
      refetchLists(queryClient);
    },
    [queryClient],
  );
  const failed = useCallback(() => {
    toastError('Couldn’t update those notifications', 'Try again in a moment.');
    refetchLists(queryClient);
  }, [queryClient]);

  return {
    markRead: useCallback(
      async (id: string, quiet = false) => {
        try {
          settle(await notificationsControllerMarkReadV1(id, {}));
          if (!quiet) announce('Marked as read');
        } catch {
          failed();
        }
      },
      [settle, failed],
    ),
    archive: useCallback(
      async (id: string) => {
        try {
          settle(await notificationsControllerArchiveV1(id, {}));
          announce('Archived');
        } catch {
          failed();
        }
      },
      [settle, failed],
    ),
    /** Several at once; there's no bulk archive, so `archiveMany` archives each. */
    markManyRead: useCallback(
      async (ids: string[]) => {
        if (ids.length === 0) return;
        try {
          settle(await notificationsControllerMarkManyReadV1({ ids }));
          announce('Marked as read');
        } catch {
          failed();
        }
      },
      [settle, failed],
    ),
    archiveMany: useCallback(
      async (ids: string[]) => {
        try {
          // ponytail: one request per item, there's no bulk archive route; the
          // selection is capped (MAX_SELECTION) so this stays a handful.
          const answers = await Promise.all(
            ids.map((id) => notificationsControllerArchiveV1(id, {})),
          );
          const last = answers.at(-1);
          if (last) settle(last);
          announce('Archived');
        } catch {
          failed();
        }
      },
      [settle, failed],
    ),
    /** Everything about a ticket, read: the ticket is open, so it's been seen. */
    markTicketRead: useCallback(
      (ticketId: string) => {
        void notificationsControllerMarkManyReadV1({
          resourceType: 'TICKET',
          resourceId: ticketId,
        })
          .then((answer) => {
            if (answer.data?.updated) settle(answer);
          })
          .catch(() => undefined);
      },
      [settle],
    ),
  };
}

/** The ticket this page shows, by id, or `null` on any other page. */
function openTicketId(pathname: string): string | null {
  return /^\/tickets\/([0-9a-f-]{36})$/.exec(pathname)?.[1] ?? null;
}

/**
 * The live half, mounted once in the shell:
 *
 * - `notification:unread-count` is the badge, as sent;
 * - `notification:new` and `notification:updated` fetch the count and the
 *   lists again (neither carries the count), and toast it, one toast per
 *   group, updated in place; none for the ticket on screen;
 * - `notification:read` (read or archived elsewhere) refetches the lists,
 *   silently.
 *
 * The count is announced politely once it has held still for 2 seconds, so a
 * burst is read once.
 */
export function useNotificationsLive(): void {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const onScreen = useRef<string | null>(null);
  const onList = useRef(false);
  useEffect(() => {
    onScreen.current = openTicketId(pathname);
    onList.current = pathname === '/tickets';
  }, [pathname]);
  const { markRead } = useNotificationActions();

  const arrived = useCallback(
    (payload: NotificationRealtimePayload, grown: boolean) => {
      void queryClient.invalidateQueries({
        queryKey: getNotificationsControllerUnreadCountV1QueryKey(),
      });
      refetchLists(queryClient);

      const ticketId = payload.data.ticketId;
      if (typeof ticketId === 'string' && ticketId === onScreen.current) {
        return;
      }
      // The queue toasts a reassignment itself, saying who has it now.
      if (payload.type === 'ticket.reassigned' && onList.current) return;
      const id = payload.groupKey ?? payload.notificationId;
      // A group that grew updates its toast if it's still showing; it never
      // stacks a second one.
      if (grown && !toast.getToasts().some((shown) => shown.id === id)) {
        return;
      }
      const lasting =
        payload.priority === NotificationPriority.HIGH ||
        payload.priority === NotificationPriority.CRITICAL;
      toast.custom(
        (toastId) => (
          <NotificationToast
            payload={payload}
            onDismiss={() => toast.dismiss(toastId)}
            onOpen={() => {
              toast.dismiss(toastId);
              void markRead(payload.notificationId, true);
            }}
          />
        ),
        { id, duration: lasting ? Infinity : TOAST_MS },
      );
    },
    [queryClient, markRead],
  );

  useRealtimeEvent(
    REALTIME_EVENTS.notificationNew,
    useCallback(
      (payload: NotificationRealtimePayload) => arrived(payload, false),
      [arrived],
    ),
  );
  useRealtimeEvent(
    REALTIME_EVENTS.notificationUpdated,
    useCallback(
      (payload: NotificationRealtimePayload) => arrived(payload, true),
      [arrived],
    ),
  );
  useRealtimeEvent(
    REALTIME_EVENTS.notificationRead,
    useCallback(
      (payload: NotificationReadPayload) => {
        setCount(queryClient, payload.unreadCount);
        refetchLists(queryClient);
      },
      [queryClient],
    ),
  );
  useRealtimeEvent(
    REALTIME_EVENTS.notificationUnreadCount,
    useCallback(
      (payload: { count: number }) => setCount(queryClient, payload.count),
      [queryClient],
    ),
  );

  useAnnouncedCount(useUnreadCount());
}

/** The live half, as a component: rendered inside the realtime provider. */
export function NotificationsLive(): null {
  useNotificationsLive();
  return null;
}

/**
 * Says "{n} unread notifications" once a rise has held for 2 seconds. A fall
 * (read here or elsewhere) changes the bell's name and says nothing.
 */
function useAnnouncedCount(count: number | null) {
  const said = useRef<number | null>(null);
  useEffect(() => {
    if (count === null || said.current === null || count <= said.current) {
      // The first count is the page's, not news; a fall isn't news either.
      said.current = count;
      return;
    }
    const timer = globalThis.setTimeout(() => {
      said.current = count;
      announce(`${count} unread notifications`);
    }, ANNOUNCE_AFTER_MS);
    return () => globalThis.clearTimeout(timer);
  }, [count]);
}
