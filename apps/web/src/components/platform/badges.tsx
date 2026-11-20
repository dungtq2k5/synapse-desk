import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleOffIcon,
  CircleXIcon,
  ClockIcon,
  CornerDownRightIcon,
  HandshakeIcon,
  InfoIcon,
  ShoppingBagIcon,
  Trash2Icon,
} from 'lucide-react';
import { OrganizationStatus, Status } from '@/components/settings/badges';
import { HEALTH_WORDS, type ConsoleStatus, type Health } from '@/lib/platform';

/** An organization's status, offboarded included. */
export function ConsoleStatusBadge({ status }: { status: ConsoleStatus }) {
  if (status === 'OFFBOARDED') {
    return (
      <Status tone="muted" icon={Trash2Icon}>
        Offboarded
      </Status>
    );
  }
  return <OrganizationStatus status={status} />;
}

const HEALTH = {
  healthy: { tone: 'success', icon: CircleCheckIcon },
  stale: { tone: 'warning', icon: ClockIcon },
  failing: { tone: 'destructive', icon: CircleXIcon },
  'never-ran': { tone: 'muted', icon: CircleDashedIcon },
  step: { tone: 'muted', icon: CornerDownRightIcon },
  'not-reached': { tone: 'muted', icon: InfoIcon },
} as const;

/** A job's health, in words with its icon. */
export function HealthBadge({ health }: { health: Health }) {
  const { tone, icon } = HEALTH[health];
  return (
    <Status tone={tone} icon={icon}>
      {HEALTH_WORDS[health]}
    </Status>
  );
}

/**
 * A plan's kind: assigned (negotiated, no Stripe product) or sold, and
 * whether it's offered.
 */
export function PlanBadges({
  stripeProductId,
  isActive,
}: {
  stripeProductId: string | null | undefined;
  isActive: boolean;
}) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {stripeProductId ? null : (
        <Status tone="info" icon={HandshakeIcon}>
          Assigned
        </Status>
      )}
      {isActive ? (
        <Status tone="success" icon={ShoppingBagIcon}>
          Offered
        </Status>
      ) : (
        <Status tone="muted" icon={CircleOffIcon}>
          Not offered
        </Status>
      )}
    </span>
  );
}
