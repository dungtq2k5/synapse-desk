import { Injectable } from '@nestjs/common';
import {
  DeliverySkipReason,
  DigestMode,
  NotificationChannel,
  NotificationPriority,
  PREFERENCE_WILDCARD_TYPE,
  PreferenceSource,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { isWithinQuietHours } from './quiet-hours';

/** What the resolver was asked, and about whom. */
export type ResolveInput = {
  userId: string;
  organizationId: string;
  type: string;
  channel: NotificationChannel;
  priority: NotificationPriority;
  /** From the recipient read. Absent = no quiet hours configured. */
  quietHours?: {
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
    timezone: string | null;
  };
  /** Injectable so the midnight-crossing case is testable at any hour. */
  now?: Date;
};

/** Allowed, or refused with a reason that can be written to a delivery row. */
export type ResolveDecision =
  | { allowed: true; digest: DigestMode }
  | { allowed: false; reason: DeliverySkipReason };

/**
 * The resolved value plus WHERE it came from — for `GET /notifications/preferences`.
 *
 * `source` exists so the UI can show *"inherited"* rather than pretending every
 * value was chosen. A settings screen that displays a default as though the
 * user picked it is one they cannot reason about: turning something "off" that
 * was never on reads as a no-op.
 */
export type ResolvedPreference = {
  type: string;
  channel: NotificationChannel;
  isEnabled: boolean;
  digest: DigestMode;
  source: PreferenceSource;
};

/**
 * **A missing row is not an opt-out** — the hard-coded floor of the resolution
 * chain, and it is permissive on purpose. A user who has never opened the
 * settings screen must receive everything; the opposite default would make the
 * feature look broken to every new account.
 */
const DEFAULT_PREFERENCE = {
  isEnabled: true,
  digest: DigestMode.IMMEDIATE,
} as const;

/**
 * Preferences and quiet hours.
 *
 * **Ships WITH the producers, not after them.** The producers turn on the volume and this
 * is the only thing that lets a user survive it: `ticket.message_created` fires
 * on every message, and shipping that with no quiet hours means emailing an
 * agent at 2am in week one. You get one chance at a user's notification
 * settings, and the default after a bad week is off.
 *
 * Resolution order (RDM Table 25), three levels and no more:
 *
 *   1. exact `(type, channel)`
 *   2. `('*', channel)`
 *   3. the hard-coded permissive default
 */
@Injectable()
export class PreferenceResolver {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * May this notification go out on this channel?
   *
   * `CRITICAL` bypasses both quiet hours and digesting (RDM §1.14) — the 100%
   * budget alert is the canonical case, and it is `CRITICAL` precisely so a
   * tenant does not discover the cap from the queue at 9am. It does NOT bypass
   * an explicit opt-out: a user who turned a channel off chose that, and
   * overriding it would make the setting a suggestion.
   */
  async resolve(input: ResolveInput): Promise<ResolveDecision> {
    const preference = await this.resolveOne(
      input.userId,
      input.type,
      input.channel,
    );

    if (!preference.isEnabled) {
      return { allowed: false, reason: DeliverySkipReason.USER_PREFERENCE };
    }

    if (preference.digest === DigestMode.OFF) {
      return { allowed: false, reason: DeliverySkipReason.USER_PREFERENCE };
    }

    const isCritical = input.priority === NotificationPriority.CRITICAL;

    if (
      !isCritical &&
      input.quietHours &&
      isWithinQuietHours(input.now ?? new Date(), input.quietHours)
    ) {
      return { allowed: false, reason: DeliverySkipReason.QUIET_HOURS };
    }

    return { allowed: true, digest: preference.digest };
  }

  /** One (type, channel) pair, walked down the three levels. */
  async resolveOne(
    userId: string,
    type: string,
    channel: NotificationChannel,
  ): Promise<ResolvedPreference> {
    // Both candidate rows in ONE query. Two round trips per channel per
    // recipient would put a handful of queries on every fan-out, and the
    // wildcard is needed often enough that fetching it lazily saves nothing.
    const rows = await this.prisma.notificationPreference.findMany({
      where: {
        userId,
        channel,
        type: { in: [type, PREFERENCE_WILDCARD_TYPE] },
      },
    });

    const exact = rows.find((row) => row.type === type);
    if (exact) {
      return {
        type,
        channel,
        isEnabled: exact.isEnabled,
        digest: exact.digest as DigestMode,
        source: PreferenceSource.EXPLICIT,
      };
    }

    const wildcard = rows.find((row) => row.type === PREFERENCE_WILDCARD_TYPE);
    if (wildcard) {
      return {
        type,
        channel,
        isEnabled: wildcard.isEnabled,
        digest: wildcard.digest as DigestMode,
        source: PreferenceSource.WILDCARD,
      };
    }

    return {
      type,
      channel,
      ...DEFAULT_PREFERENCE,
      source: PreferenceSource.DEFAULT,
    };
  }
}
