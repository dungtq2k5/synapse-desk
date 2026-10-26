import {
  CircleCheckIcon,
  CircleXIcon,
  ClockIcon,
  LoaderCircleIcon,
  LockIcon,
  PowerIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  StarIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type Tone = 'success' | 'info' | 'warning' | 'destructive' | 'muted';

const TONE: Record<Tone, string> = {
  success: '',
  info: '',
  warning: '',
  destructive:
    'border-destructive-border bg-destructive-subtle text-destructive-subtle-foreground',
  muted: 'bg-muted text-muted-foreground',
};

/** A status in words with its icon, never color alone. */
export function Status({
  tone,
  icon: Icon,
  children,
}: {
  tone: Tone;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <Badge
      variant={
        tone === 'success' || tone === 'info' || tone === 'warning'
          ? tone
          : 'outline'
      }
      className={cn(TONE[tone])}
    >
      <Icon aria-hidden />
      {children}
    </Badge>
  );
}

/** The organization's lifecycle status. */
export function OrganizationStatus({ status }: { status: string | null }) {
  switch (status) {
    case 'ACTIVE':
      return (
        <Status tone="success" icon={CircleCheckIcon}>
          Active
        </Status>
      );
    case 'PENDING_ONBOARDING':
      return (
        <Status tone="info" icon={ClockIcon}>
          Setting up
        </Status>
      );
    case 'SUSPENDED_PAST_DUE':
      return (
        <Status tone="warning" icon={TriangleAlertIcon}>
          Past due
        </Status>
      );
    case 'FROZEN':
      return (
        <Status tone="destructive" icon={LockIcon}>
          Frozen
        </Status>
      );
    default:
      return null;
  }
}

/** A person: deleted, locked (until a date, or until unlocked), or active. */
export function PersonStatus({
  deleted,
  locked,
  lockedUntil,
}: {
  deleted: boolean;
  locked: boolean;
  /** "21 Oct", when the lock ends on its own. */
  lockedUntil: string | null;
}) {
  if (deleted) {
    return (
      <Status tone="muted" icon={Trash2Icon}>
        Deleted
      </Status>
    );
  }
  if (locked && lockedUntil) {
    return (
      <Status tone="warning" icon={ClockIcon}>
        Locked until {lockedUntil}
      </Status>
    );
  }
  if (locked) {
    return (
      <Status tone="destructive" icon={LockIcon}>
        Locked
      </Status>
    );
  }
  return (
    <Status tone="success" icon={CircleCheckIcon}>
      Active
    </Status>
  );
}

/** Whether two-step verification is on. */
export function TwoStep({ on }: { on: boolean }) {
  return on ? (
    <Status tone="success" icon={ShieldCheckIcon}>
      On
    </Status>
  ) : (
    <Status tone="muted" icon={ShieldOffIcon}>
      Off
    </Status>
  );
}

/** A person's primary department. */
export function PrimaryBadge() {
  return (
    <Status tone="muted" icon={StarIcon}>
      Primary
    </Status>
  );
}

/** One of the four roles every organization shares. */
export function SystemBadge() {
  return (
    <Status tone="muted" icon={LockIcon}>
      System
    </Status>
  );
}

/** An invitation's status. */
export function InvitationStatus({ status }: { status: string | null }) {
  switch (status) {
    case 'ACCEPTED':
      return (
        <Status tone="success" icon={CircleCheckIcon}>
          Accepted
        </Status>
      );
    case 'EXPIRED':
      return (
        <Status tone="muted" icon={ClockIcon}>
          Expired
        </Status>
      );
    case 'REVOKED':
      return (
        <Status tone="muted" icon={XIcon}>
          Revoked
        </Status>
      );
    case 'PENDING':
      return (
        <Status tone="info" icon={ClockIcon}>
          Pending
        </Status>
      );
    default:
      return null;
  }
}

/** A webhook endpoint: on, turned off by the system (a `disabledCode`), or turned off. */
export function EndpointStatus({
  isActive,
  disabledCode,
}: {
  isActive: boolean;
  disabledCode: string | null;
}) {
  if (isActive) {
    return (
      <Status tone="success" icon={CircleCheckIcon}>
        Active
      </Status>
    );
  }
  return disabledCode ? (
    <Status tone="warning" icon={TriangleAlertIcon}>
      Turned off by SynapseDesk
    </Status>
  ) : (
    <Status tone="muted" icon={PowerIcon}>
      Turned off
    </Status>
  );
}

/** A webhook delivery's status. */
export function DeliveryStatus({ status }: { status: string | null }) {
  switch (status) {
    case 'DELIVERED':
      return (
        <Status tone="success" icon={CircleCheckIcon}>
          Delivered
        </Status>
      );
    case 'FAILED':
      return (
        <Status tone="destructive" icon={CircleXIcon}>
          Failed
        </Status>
      );
    case 'PENDING':
      return (
        <Status tone="info" icon={ClockIcon}>
          Pending
        </Status>
      );
    default:
      return null;
  }
}

/** An export's status. */
export function ExportStatus({ status }: { status: string | null }) {
  switch (status) {
    case 'READY':
      return (
        <Status tone="success" icon={CircleCheckIcon}>
          Ready
        </Status>
      );
    case 'FAILED':
      return (
        <Status tone="destructive" icon={CircleXIcon}>
          Failed
        </Status>
      );
    case 'PENDING':
      return (
        <Status tone="info" icon={LoaderCircleIcon}>
          Preparing
        </Status>
      );
    default:
      return null;
  }
}
