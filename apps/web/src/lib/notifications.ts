import type {
  NotificationResponseDto,
  NotificationResponseDtoType,
} from '@synapsedesk/api-client';
import {
  ArrowLeftRightIcon,
  CircleDotIcon,
  CreditCardIcon,
  FlagIcon,
  GaugeIcon,
  MessageSquareIcon,
  ReceiptIcon,
  SparklesIcon,
  UserPlusIcon,
  WebhookIcon,
  type LucideIcon,
} from 'lucide-react';

export type NotificationType = NonNullable<NotificationResponseDtoType>;
export type NotificationGroup =
  'Tickets' | 'Usage and billing' | 'Integrations';

/** Each type as the screens show it: icon, label, group and description. */
export const NOTIFICATION_TYPES: Record<
  NotificationType,
  {
    icon: LucideIcon;
    label: string;
    group: NotificationGroup;
    description: string;
  }
> = {
  'ticket.assigned': {
    icon: UserPlusIcon,
    label: 'Assigned to you',
    group: 'Tickets',
    description: 'A ticket is assigned to you.',
  },
  'ticket.reassigned': {
    icon: ArrowLeftRightIcon,
    label: 'Reassigned',
    group: 'Tickets',
    description: 'A ticket of yours moves to someone else.',
  },
  'ticket.escalated': {
    icon: FlagIcon,
    label: 'Escalated',
    group: 'Tickets',
    description: 'A ticket you handle is escalated.',
  },
  'ticket.status_changed': {
    icon: CircleDotIcon,
    label: 'Status changed',
    group: 'Tickets',
    description: 'A ticket you handle or raised changes status.',
  },
  'ticket.message_created': {
    icon: MessageSquareIcon,
    label: 'New messages',
    group: 'Tickets',
    description: 'Someone replies on a ticket you follow.',
  },
  'quota.threshold': {
    icon: SparklesIcon,
    label: 'AI allowance',
    group: 'Usage and billing',
    description: 'The organization’s AI allowance reaches 80%, 95% or 100%.',
  },
  'limit.threshold': {
    icon: GaugeIcon,
    label: 'Plan limits',
    group: 'Usage and billing',
    description:
      'Agent seats, storage or documents reach 80%, 95% or 100% of the plan.',
  },
  'billing.payment_failed': {
    icon: CreditCardIcon,
    label: 'Payment failed',
    group: 'Usage and billing',
    description: 'A payment for the plan fails.',
  },
  'billing.plan_changed': {
    icon: ReceiptIcon,
    label: 'Plan changed',
    group: 'Usage and billing',
    description: 'The organization’s plan changes.',
  },
  'webhook.endpoint_disabled': {
    icon: WebhookIcon,
    label: 'Webhook turned off',
    group: 'Integrations',
    description: 'A webhook endpoint is turned off after repeated failures.',
  },
};

export const NOTIFICATION_GROUPS: NotificationGroup[] = [
  'Tickets',
  'Usage and billing',
  'Integrations',
];

/** The types a person may hear about: the administrator's groups need `organization.update`. */
export function typesFor(administrator: boolean): NotificationType[] {
  return (Object.keys(NOTIFICATION_TYPES) as NotificationType[]).filter(
    (type) => administrator || NOTIFICATION_TYPES[type].group === 'Tickets',
  );
}

/** The words a priority adds; none for `NORMAL` and `LOW`. */
export function priorityLabel(
  priority: NotificationResponseDto['priority'],
): string | null {
  if (priority === 'CRITICAL') return 'Critical';
  if (priority === 'HIGH') return 'High priority';
  return null;
}

/**
 * Where opening a notification goes: its `actionUrl` when that's a path on
 * this origin, else nowhere (`null`), so a stored value can never send a
 * person off-site. A ticket link carries `?from=notification`, so its
 * not-found page leads back here.
 *
 * @example notificationHref('/tickets/1042') // '/tickets/1042?from=notification'
 * @example notificationHref('//evil.example') // null
 * @example notificationHref('https://evil.example') // null
 */
export function notificationHref(actionUrl: string | null): string | null {
  if (!actionUrl?.startsWith('/') || /^\/[/\\]/.test(actionUrl)) return null;
  return /^\/tickets\/[^/?#]+$/.test(actionUrl)
    ? `${actionUrl}?from=notification`
    : actionUrl;
}

/**
 * The day heading a notification sits under: "Today", "Yesterday", then
 * "14 Oct".
 *
 * @example dayHeading('2026-10-16T08:00:00Z', new Date('2026-10-16T12:00:00Z'), 'UTC') // 'Today'
 */
export function dayHeading(
  at: string,
  now: Date = new Date(),
  timeZone?: string,
): string {
  const day = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (day(new Date(at)) === day(now)) return 'Today';
  if (day(new Date(at)) === day(yesterday)) return 'Yesterday';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(new Date(at));
}
