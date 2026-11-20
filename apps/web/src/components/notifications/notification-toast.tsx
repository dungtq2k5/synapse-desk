'use client';

import {
  NotificationPriority,
  type NotificationRealtimePayload,
} from '@synapsedesk/contracts';
import { XIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { notificationHref } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { NotificationAvatar, PriorityLabel } from './notification-item';

/**
 * A new notification, as a toast: the avatar with its type, title, body, the
 * priority's words, Open and dismiss. `HIGH` and `CRITICAL` carry a rule and
 * stay until dismissed (the caller sets the duration).
 */
export function NotificationToast({
  payload,
  onOpen,
  onDismiss,
}: {
  payload: NotificationRealtimePayload;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const router = useRouter();
  const href = notificationHref(payload.actionUrl);
  const high = payload.priority === NotificationPriority.HIGH;
  const critical = payload.priority === NotificationPriority.CRITICAL;
  return (
    <div
      className={cn(
        'flex w-[min(24rem,calc(100vw-2rem))] items-start gap-3 rounded-lg border bg-popover p-4 text-sm text-popover-foreground shadow-lg',
        (high || critical) && 'border-l-[3px]',
        high && 'border-l-warning-border',
        critical && 'border-l-destructive-border',
      )}
    >
      {/* The live payload names no actor: a person for a ticket's news, the
          system's mark for the rest. */}
      <NotificationAvatar
        type={payload.type}
        actorName={null}
        system={!payload.type.startsWith('ticket.')}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-medium">{payload.title}</p>
        {payload.body && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {payload.body}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <PriorityLabel priority={payload.priority} />
          {href && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                onOpen();
                router.push(href);
              }}
            >
              Open
            </Button>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        <XIcon aria-hidden />
      </Button>
    </div>
  );
}
