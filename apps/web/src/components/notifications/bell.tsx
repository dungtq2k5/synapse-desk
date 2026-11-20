'use client';

import {
  useNotificationsControllerListV1,
  type NotificationResponseDto,
} from '@synapsedesk/api-client';
import { BellIcon, CheckCheckIcon, SettingsIcon } from 'lucide-react';
import Link from 'next/link';
import { Popover } from 'radix-ui';
import { useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePeople } from '@/components/ticket/use-directory';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { NotificationItem } from './notification-item';
import { useNotificationActions, useUnreadCount } from './store';

/** The bell panel's list: the latest few; the rest are a click away. */
const LATEST = 10;

/**
 * Radix's open focus, aimed at the panel's heading rather than the first
 * control, so a reader starts above the tabs and the list.
 */
function focusHeading(event: Event) {
  event.preventDefault();
  (event.currentTarget as HTMLElement)
    .querySelector<HTMLElement>('[data-panel-heading]')
    ?.focus();
}

/**
 * The bell: the server's unread count on a badge ("99+" past 99, none at 0),
 * opening the latest notifications in a popover, or a full-height sheet on a
 * phone.
 */
export function NotificationBell() {
  const count = useUnreadCount() ?? 0;
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const bell = (
    <Button
      variant="ghost"
      size="icon"
      aria-haspopup="dialog"
      aria-label={
        count > 0 ? `Notifications, ${count} unread` : 'Notifications'
      }
      className="relative"
      onClick={mobile ? () => setOpen(true) : undefined}
    >
      <BellIcon aria-hidden />
      {count > 0 && (
        <span
          aria-hidden
          data-notification-count
          className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[0.625rem] leading-none font-semibold text-destructive-foreground ring-2 ring-background"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Button>
  );

  if (mobile) {
    return (
      <>
        {bell}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="right"
            aria-describedby={undefined}
            onOpenAutoFocus={focusHeading}
            className="w-full gap-0 p-0 sm:max-w-full"
          >
            <SheetTitle className="sr-only">Notifications</SheetTitle>
            <Panel sheet onClose={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{bell}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          aria-label="Notifications"
          onOpenAutoFocus={focusHeading}
          className="z-50 w-100 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md outline-none"
        >
          <Panel onClose={() => setOpen(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Panel({
  sheet = false,
  onClose,
}: {
  /** In the phone's full-height sheet, beside its Close button. */
  sheet?: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const list = useNotificationsControllerListV1(
    { limit: LATEST, unreadOnly: tab === 'unread' ? true : undefined },
    // Reopened (or swapped between popover and sheet), it shows what it has;
    // anything new arrives by socket, which refetches it.
    { query: { staleTime: 30_000 } },
  );
  const items = list.data?.data?.items;
  const unreadIds = (items ?? []).filter((n) => !n.readAt).map((n) => n.id);
  const actions = useNotificationActions();
  const { names } = usePeople();

  const body =
    list.isError && !items ? (
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm">
        <p className="font-medium">Couldn’t load notifications</p>
        <p className="text-muted-foreground">
          Something went wrong on our side.
        </p>
        <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
          Try again
        </Button>
      </div>
    ) : !items ? (
      <div aria-busy className="flex flex-col">
        <span className="sr-only" role="status">
          Loading notifications
        </span>
        {Array.from({ length: 4 }, (_, row) => (
          <div key={row} className="flex gap-3 border-b p-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        ))}
      </div>
    ) : items.length === 0 ? (
      <div className="flex flex-col items-center gap-1 px-6 py-10 text-center text-sm">
        {tab === 'unread' ? (
          <p className="text-muted-foreground">No unread notifications.</p>
        ) : (
          <>
            <p className="font-medium">You’re all caught up</p>
            <p className="text-muted-foreground">
              New notifications will appear here.
            </p>
          </>
        )}
      </div>
    ) : (
      <ul className="flex flex-col divide-y">
        {items.map((notification) => (
          <li key={notification.id}>
            <NotificationItem
              notification={notification}
              actorName={actorName(notification, names)}
              onOpen={() => {
                if (!notification.readAt) {
                  void actions.markRead(notification.id, true);
                }
                onClose();
              }}
              onMarkRead={() => void actions.markRead(notification.id)}
              onArchive={() => void actions.archive(notification.id)}
            />
          </li>
        ))}
      </ul>
    );

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as 'all' | 'unread')}
      className={cn(
        'flex flex-col gap-0',
        sheet ? 'h-full' : 'max-h-[min(40rem,calc(100dvh-5rem))]',
      )}
    >
      <div className="flex flex-col gap-3 border-b p-3">
        <div
          className={cn(
            'flex items-center justify-between gap-2',
            sheet && 'pr-8',
          )}
        >
          <h2
            tabIndex={-1}
            data-panel-heading
            className="font-semibold outline-none"
          >
            Notifications
          </h2>
          {unreadIds.length > 0 && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={() => void actions.markManyRead(unreadIds)}
            >
              <CheckCheckIcon aria-hidden />
              Mark all as read
            </Button>
          )}
        </div>
        <TabsList className="w-full">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="unread">Unread</TabsTrigger>
        </TabsList>
      </div>

      {/* Both panels exist, so each tab controls one; the inactive one is
          hidden and empty. */}
      {(['all', 'unread'] as const).map((value) => (
        <TabsContent
          key={value}
          value={value}
          forceMount
          hidden={tab !== value}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {tab === value && body}
        </TabsContent>
      ))}

      <div className="flex items-center justify-between gap-2 border-t p-3">
        <Link
          href="/notifications"
          onClick={onClose}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          See all notifications
        </Link>
        <Link
          href="/notifications/settings"
          onClick={onClose}
          aria-label="Notification settings"
          className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }))}
        >
          <SettingsIcon aria-hidden />
        </Link>
      </div>
    </Tabs>
  );
}

/** The actor's name when the page knows the people (`user.read`), else `null`. */
export function actorName(
  notification: NotificationResponseDto,
  names: Map<string, string>,
): string | null {
  return notification.actorId
    ? (names.get(notification.actorId) ?? null)
    : null;
}
