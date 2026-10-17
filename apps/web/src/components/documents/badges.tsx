import type {
  DocumentFlagResponseDtoSeverity,
  DocumentResponseDto,
  DocumentResponseDtoStatus,
  IngestionJobResponseDtoStatus,
} from '@synapsedesk/api-client';
import {
  Building2Icon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  ClockIcon,
  FlagIcon,
  InfoIcon,
  LoaderCircleIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UsersIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DOCUMENT_STATUS_LABEL, type DocumentStatus } from '@/lib/documents';
import { cn } from '@/lib/utils';

// Whole class names, so Tailwind sees each one.
const STATUS_CLASS: Record<DocumentStatus, string> = {
  PENDING: 'bg-status-document-pending-bg text-status-document-pending-fg',
  PROCESSING:
    'bg-status-document-processing-bg text-status-document-processing-fg',
  INDEXED: 'bg-status-document-indexed-bg text-status-document-indexed-fg',
  FAILED: 'bg-status-document-failed-bg text-status-document-failed-fg',
};

const STATUS_ICON = {
  PENDING: ClockIcon,
  PROCESSING: LoaderCircleIcon,
  INDEXED: CircleCheckIcon,
  FAILED: CircleXIcon,
} as const;

/** A document's status: an icon and the word, never color alone. */
export function DocumentStatusBadge({
  status,
}: {
  status: DocumentResponseDtoStatus;
}) {
  if (!status) return null;
  const Icon = STATUS_ICON[status];
  return (
    <Badge className={cn('rounded-full', STATUS_CLASS[status])}>
      <Icon aria-hidden />
      {DOCUMENT_STATUS_LABEL[status]}
    </Badge>
  );
}

/** "Deleted", beside the status of a deleted document. */
export function DeletedBadge() {
  return (
    <Badge variant="outline" className="bg-muted text-muted-foreground">
      <Trash2Icon aria-hidden />
      Deleted
    </Badge>
  );
}

/** Who can see a document: an icon and the words. */
export function Visibility({
  document,
  label,
  className,
}: {
  document: Pick<DocumentResponseDto, 'isOrganizationWide'>;
  label: string;
  className?: string;
}) {
  const Icon = document.isOrganizationWide ? Building2Icon : UsersIcon;
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      {label}
    </span>
  );
}

/** A document's open flags, or "—" with none. */
export function FlagCount({ count }: { count: number }) {
  if (count === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge variant="warning" aria-label={`${count} open flags`}>
      <FlagIcon aria-hidden />
      {count}
    </Badge>
  );
}

const SEVERITY = {
  INFO: { label: 'Info', variant: 'info', Icon: InfoIcon },
  WARNING: { label: 'Warning', variant: 'warning', Icon: TriangleAlertIcon },
  CRITICAL: { label: 'Critical', variant: 'outline', Icon: CircleAlertIcon },
} as const;

/** A flag's severity: an icon and the word. */
export function SeverityBadge({
  severity,
}: {
  severity: DocumentFlagResponseDtoSeverity;
}) {
  if (!severity) return null;
  const { label, variant, Icon } = SEVERITY[severity];
  return (
    <Badge
      variant={variant}
      className={cn(
        severity === 'CRITICAL' &&
          'border-destructive-border bg-destructive-subtle text-destructive-subtle-foreground',
      )}
    >
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}

/** An attempt's outcome in the history table. */
export function JobResult({
  status,
}: {
  status: IngestionJobResponseDtoStatus;
}) {
  switch (status) {
    case 'COMPLETED':
      return (
        <Badge variant="success">
          <CircleCheckIcon aria-hidden />
          Completed
        </Badge>
      );
    case 'FAILED':
      return (
        <Badge
          variant="outline"
          className="border-destructive-border bg-destructive-subtle text-destructive-subtle-foreground"
        >
          <CircleXIcon aria-hidden />
          Failed
        </Badge>
      );
    case 'CANCELLED':
      return (
        <Badge variant="outline" className="bg-muted text-muted-foreground">
          Canceled
        </Badge>
      );
    default:
      return (
        <Badge variant="info">
          <LoaderCircleIcon aria-hidden />
          In progress
        </Badge>
      );
  }
}
