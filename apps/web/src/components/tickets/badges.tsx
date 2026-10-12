import type {
  TicketResponseDtoPriority,
  TicketResponseDtoSource,
  TicketResponseDtoStatus,
} from '@synapsedesk/api-client';
import { CodeIcon, GlobeIcon, MailIcon, MessageCircleIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PRIORITY_LABEL, SOURCE_LABEL, STATUS_LABEL } from '@/lib/tickets';
import { cn } from '@/lib/utils';

// Whole class names, so Tailwind sees each one.
const STATUS_CLASS: Record<NonNullable<TicketResponseDtoStatus>, string> = {
  NEW: 'bg-status-ticket-new-bg text-status-ticket-new-fg',
  OPEN: 'bg-status-ticket-open-bg text-status-ticket-open-fg',
  PENDING_AGENT:
    'bg-status-ticket-pending_agent-bg text-status-ticket-pending_agent-fg',
  ESCALATED: 'bg-status-ticket-escalated-bg text-status-ticket-escalated-fg',
  RESOLVED: 'bg-status-ticket-resolved-bg text-status-ticket-resolved-fg',
  CLOSED: 'bg-status-ticket-closed-bg text-status-ticket-closed-fg',
};

const PRIORITY_CLASS: Record<NonNullable<TicketResponseDtoPriority>, string> = {
  LOW: 'bg-status-priority-low-bg text-status-priority-low-fg',
  MEDIUM: 'bg-status-priority-medium-bg text-status-priority-medium-fg',
  HIGH: 'bg-status-priority-high-bg text-status-priority-high-fg',
  // The only solid badge.
  URGENT: 'bg-status-priority-urgent-bg text-status-priority-urgent-fg',
};

/** A status, by its label: never colour alone. */
export function StatusBadge({ status }: { status: TicketResponseDtoStatus }) {
  if (!status) return null;
  return (
    <Badge className={cn('rounded-full', STATUS_CLASS[status])}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function PriorityBadge({
  priority,
}: {
  priority: TicketResponseDtoPriority;
}) {
  if (!priority) return null;
  return (
    <Badge className={cn('rounded-full', PRIORITY_CLASS[priority])}>
      {PRIORITY_LABEL[priority]}
    </Badge>
  );
}

const SOURCE_ICON = {
  WEB: GlobeIcon,
  CHAT: MessageCircleIcon,
  EMAIL: MailIcon,
  API: CodeIcon,
} as const;

/** Where a ticket came from: an icon and its name. */
export function SourceLabel({ source }: { source: TicketResponseDtoSource }) {
  if (!source) return <span className="text-muted-foreground">—</span>;
  const Icon = SOURCE_ICON[source];
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon aria-hidden className="size-4 text-muted-foreground" />
      {SOURCE_LABEL[source]}
    </span>
  );
}
