'use client';

import type {
  NotificationResponseDto,
  NotificationResponseDtoPriority,
} from '@synapsedesk/api-client';
import { CircleAlertIcon, EllipsisIcon, TriangleAlertIcon } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { UserAvatar } from '@/components/shell/user-avatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { relativeTime } from '@/lib/format';
import {
  NOTIFICATION_TYPES,
  notificationHref,
  priorityLabel,
} from '@/lib/notifications';
import { cn } from '@/lib/utils';

/**
 * Who it's from, with what happened on it: the actor's initials (a figure
 * when their name isn't known), or the system's mark; the type's icon on top.
 */
export function NotificationAvatar({
  type,
  actorName,
  system,
}: {
  type: NotificationResponseDto['type'];
  actorName: string | null;
  system: boolean;
}) {
  const Icon = type ? NOTIFICATION_TYPES[type].icon : null;
  return (
    <span aria-hidden className="relative shrink-0">
      {system ? (
        <>
          <Image
            src="/mark-light.svg"
            alt=""
            width={32}
            height={32}
            unoptimized
            className="size-8 rounded-md dark:hidden"
          />
          <Image
            src="/mark-dark.svg"
            alt=""
            width={32}
            height={32}
            unoptimized
            className="hidden size-8 rounded-md dark:block"
          />
        </>
      ) : (
        <UserAvatar name={actorName} className="size-8 text-xs" />
      )}
      {Icon && (
        <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-background text-foreground">
          <Icon className="size-3" />
        </span>
      )}
    </span>
  );
}

/** "High priority" or "Critical", in words with an icon; nothing otherwise. */
export function PriorityLabel({
  priority,
}: {
  priority: NotificationResponseDtoPriority;
}) {
  const label = priorityLabel(priority);
  if (!label) return null;
  const critical = priority === 'CRITICAL';
  const Icon = critical ? CircleAlertIcon : TriangleAlertIcon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        critical
          ? 'border-destructive-border bg-destructive-subtle text-destructive-subtle-foreground'
          : 'border-warning-border bg-warning-subtle text-warning-subtle-foreground',
      )}
    >
      <Icon aria-hidden className="size-3" />
      {label}
    </span>
  );
}

/** The words a notification's link is read as: its state, text, time, count and priority. */
function accessibleName(notification: NotificationResponseDto): string {
  return [
    notification.readAt ? null : 'Unread.',
    notification.title,
    notification.body,
    relativeTime(notification.createdAt),
    notification.groupCount > 1 ? `${notification.groupCount} updates` : null,
    priorityLabel(notification.priority),
    notification.archivedAt ? 'Archived' : null,
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * One notification: a link over the whole row (opening it marks it read and
 * follows its `actionUrl` when that's a path here), its actions menu, and,
 * on the feed, a checkbox to select it.
 */
export function NotificationItem({
  notification,
  actorName,
  onOpen,
  onMarkRead,
  onArchive,
  selected,
  selectDisabled,
  onSelect,
}: {
  notification: NotificationResponseDto;
  actorName: string | null;
  onOpen: () => void;
  onMarkRead: () => void;
  onArchive: () => void;
  selected?: boolean;
  /** The selection is full: this one can't join it. */
  selectDisabled?: boolean;
  onSelect?: (selected: boolean) => void;
}) {
  const unread = !notification.readAt;
  const critical = notification.priority === 'CRITICAL';
  const href = notificationHref(notification.actionUrl);
  const name = accessibleName(notification);
  const linkClass =
    'text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset';

  return (
    <div
      className={cn(
        'relative flex items-start gap-3 px-3 py-3 hover:bg-accent/50',
        critical &&
          'border-l-[3px] border-l-destructive-border bg-destructive-subtle hover:bg-destructive-subtle',
      )}
    >
      {onSelect && (
        <Checkbox
          aria-label={`Select ${notification.title}`}
          checked={selected}
          disabled={selectDisabled}
          onCheckedChange={(checked) => onSelect(checked === true)}
          className="relative z-10 mt-2"
        />
      )}
      <NotificationAvatar
        type={notification.type}
        actorName={actorName}
        system={!notification.actorId}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
        {href ? (
          <Link
            href={href}
            aria-label={name}
            onClick={onOpen}
            className={cn(linkClass, unread ? 'font-semibold' : 'font-medium')}
          >
            {notification.title}
          </Link>
        ) : (
          <button
            type="button"
            aria-label={name}
            onClick={onOpen}
            className={cn(linkClass, unread ? 'font-semibold' : 'font-medium')}
          >
            {notification.title}
          </button>
        )}
        {notification.body && (
          <p className="line-clamp-2 text-muted-foreground">
            {notification.body}
          </p>
        )}
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <time dateTime={notification.createdAt}>
            {relativeTime(notification.createdAt)}
          </time>
          {notification.groupCount > 1 && (
            <span className="rounded-full bg-secondary px-1.5 font-medium text-secondary-foreground">
              {notification.groupCount}
            </span>
          )}
          <PriorityLabel priority={notification.priority} />
          {notification.archivedAt && (
            <span className="rounded-full border px-1.5">Archived</span>
          )}
        </p>
      </div>
      <div className="relative z-10 flex flex-col items-end gap-2">
        {unread && (
          <span aria-hidden className="mt-1 size-2 rounded-full bg-primary" />
        )}
        {(unread || !notification.archivedAt) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Actions for ${notification.title}`}
              >
                <EllipsisIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {unread && (
                <DropdownMenuItem onSelect={onMarkRead}>
                  Mark as read
                </DropdownMenuItem>
              )}
              {!notification.archivedAt && (
                <DropdownMenuItem onSelect={onArchive}>
                  Archive
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
