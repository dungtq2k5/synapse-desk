import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import Redis from 'ioredis';
import {
  CreateInAppNotificationCommand,
  formatErrorMsg,
  IN_APP_NOTIFICATION_PATTERN,
  NATS_CLIENT,
  NOTIFICATION_TYPES,
  NotificationPriority,
  NotificationResourceType,
  QUOTA_ALERT_THRESHOLDS,
  quotaThresholdEventId,
} from '@synapsedesk/common';
import { QUOTA_REDIS } from './quota-counter.service';

/**
 * The 80 / 95 / 100 ladder — RDM §1.14.
 *
 * **The wording matters more than the number.** "You have used 80% of your AI
 * budget" prompts nobody to act. What actually happens at 100% is that every
 * question self-service was deflecting becomes a ticket — a 3-5x overnight
 * spike in agent queue volume — and the message says that, because an admin who
 * reads it needs to know what they are about to be hit by rather than which
 * percentage they crossed.
 *
 * Addressed to `organization.update` holders, not the whole tenant: an agent
 * cannot buy more budget, so telling them is noise that trains people to ignore
 * the next one.
 */
@Injectable()
export class QuotaAlertService {
  private readonly logger = new Logger(QuotaAlertService.name);

  constructor(
    @Inject(NATS_CLIENT) private readonly client: ClientProxy,
    @Inject(QUOTA_REDIS) private readonly redis: Redis,
  ) {}

  /**
   * Fires any threshold this charge crossed. Never throws.
   *
   * Called from `charge()` with the POST-increment total, which is the only
   * value that can tell 79% from 81% — computing the total separately would
   * race every concurrent charge and either double-fire or miss.
   */
  maybeAlert(
    organizationId: string,
    billingCycleStart: Date,
    totalMicros: bigint,
    limitMicros: bigint,
  ): void {
    void this.alert(
      organizationId,
      billingCycleStart,
      totalMicros,
      limitMicros,
    ).catch((error: unknown) =>
      this.logger.error(
        `Quota alert failed for ${organizationId}: ${formatErrorMsg(error)}`,
      ),
    );
  }

  private async alert(
    organizationId: string,
    billingCycleStart: Date,
    totalMicros: bigint,
    limitMicros: bigint,
  ): Promise<void> {
    if (limitMicros <= 0n) return;

    const percent = Number((totalMicros * 100n) / limitMicros);

    for (const threshold of QUOTA_ALERT_THRESHOLDS) {
      if (percent < threshold) continue;

      const eventId = quotaThresholdEventId(
        organizationId,
        billingCycleStart,
        threshold,
      );

      // Two independent idempotency guards, and both earn their place.
      //
      // Domain E's `UNIQUE (recipient_id, event_id)` is the durable one and the
      // reason `eventId` is derived rather than generated — but Domain E does
      // not exist yet, so relying on it alone would mean every charge past 80%
      // publishes another command into a subject nobody is draining.
      //
      // `SET NX` here is the local guard: cheap, and keyed on the same id so
      // the two agree by construction. `EX` rather than a permanent key because
      // the cycle start is already in the id — a stale guard from three cycles
      // ago protects nothing and costs memory.
      const claimed = await this.redis.set(
        `alerted:${eventId}`,
        '1',
        'EX',
        ALERT_GUARD_TTL_SECONDS,
        'NX',
      );
      if (claimed !== 'OK') continue;

      const command: CreateInAppNotificationCommand = {
        organizationId,
        // The ORIGINATING event, not the transport subject.
        // Preference resolution keys on this, so a user who wants budget
        // warnings and not ticket noise needs the two to be distinguishable.
        type: NOTIFICATION_TYPES.quotaThreshold,
        // Addressed by PERMISSION, and this producer is the reason that kind
        // exists: it genuinely does not know who holds `organization.update`
        // in a tenant. An agent cannot buy more budget, so telling them is
        // noise.
        audience: { kind: 'permission', permission: 'organization.update' },
        eventId,
        title: this.titleFor(threshold),
        body: this.bodyFor(threshold),
        // 100% is CRITICAL so it bypasses quiet hours and digest batching —
        // an admin asleep through the moment their queue triples is the case
        // this exists for.
        priority:
          threshold === 100
            ? NotificationPriority.CRITICAL
            : NotificationPriority.NORMAL,
        occurredAt: new Date().toISOString(),
        resourceType: NotificationResourceType.ORGANIZATION,
        resourceId: organizationId,
        // Straight to the page where the plan can actually be changed. A
        // warning that does not link to the fix is a warning people read and
        // then have to go looking.
        actionUrl: '/settings/billing',
        data: { threshold },
      };

      // `.subscribe()` is mandatory: `emit()` is COLD and nothing is published
      // without it. The classic silent failure with this API.
      this.client.emit(IN_APP_NOTIFICATION_PATTERN, command).subscribe({
        error: (error: unknown) =>
          this.logger.error(
            `Could not publish quota alert ${eventId}: ${formatErrorMsg(error)}`,
          ),
      });
    }
  }

  private titleFor(threshold: number): string {
    return threshold === 100
      ? 'AI assistance has stopped for this billing cycle'
      : `AI budget ${threshold}% used`;
  }

  /**
   * The consequence, in the words an admin can act on.
   *
   * Not "you have used 95% of your allowance" — that is a number. What they
   * need is what happens next and roughly when.
   */
  private bodyFor(threshold: number): string {
    if (threshold === 100) {
      return [
        'Self-service answers are now disabled, so every question that AI was',
        'handling will be routed to your agents as a ticket. Expect a sharp',
        'increase in queue volume until the budget resets or is increased.',
        'Escalation summaries are also unavailable, so new tickets will arrive',
        'without AI context.',
      ].join(' ');
    }

    return [
      `This workspace has used ${threshold}% of its AI allowance for the`,
      'current billing cycle. At 100%, all self-service questions will route to',
      'your agents instead of being answered automatically — typically a 3-5x',
      'increase in ticket volume. Increase the allowance now to avoid it.',
    ].join(' ');
  }
}

/** 70 days — long enough to outlive any cycle, short enough not to accumulate. */
const ALERT_GUARD_TTL_SECONDS = 70 * 24 * 60 * 60;
