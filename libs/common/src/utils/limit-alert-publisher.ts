import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import {
  INITIAL_LIMIT_ALERT_STATE,
  LimitAlertDimension,
  evaluateLimitAlert,
  limitAlertStateKey,
  limitThresholdEventId,
} from '../configs/limit-alerts.config';
import {
  CreateInAppNotificationCommand,
  IN_APP_NOTIFICATION_PATTERN,
  NOTIFICATION_TYPES,
  NotificationPriority,
  NotificationResourceType,
} from '../contracts/notification.contract';
import { formatErrorMsg } from './format-error';

/** Reads and writes the DURABLE half of the alarm state. */
export type GenerationStore = {
  read(organizationId: string, dimension: LimitAlertDimension): Promise<number>;
  bump(organizationId: string, dimension: LimitAlertDimension): Promise<number>;
};

/** What a publisher needs from JetStream, narrowed to one method. */
export type AlertTransport = {
  publish(pattern: string, payload: unknown, messageId: string): void;
};

/**
 * The level-alarm publisher, shared by every service that owns a dimension.
 *
 * **One implementation because the event id must be derived identically.** Two
 * services publish these — auth owns seats, ingestion owns storage and
 * documents — and Domain E's durable guard has nothing to match on unless both
 * derive the id the same way. A second copy of this logic is a second chance to
 * generate one instead.
 *
 * **Never routed through a service's own `NotificationPublisher`.** That helper
 * publishes with a fresh `Nats-Msg-Id` per call, which is correct for what it
 * carries — a password reset has no id of a causing act — and wrong here: a
 * threshold crossing has one, and a generated id lands OUTSIDE the partial
 * unique index (`WHERE event_id IS NOT NULL` covers only rows that have one),
 * so the alert would silently get no durable dedupe at all.
 */
export class LimitAlertPublisher {
  private readonly logger = new Logger(LimitAlertPublisher.name);

  constructor(
    private readonly redis: Redis,
    private readonly generations: GenerationStore,
    private readonly transport: AlertTransport,
  ) {}

  /**
   * Evaluates one reading and publishes whatever crossed.
   *
   * **Fire-and-forget by contract.** Called from the enforcement point, where
   * the number is already in hand — so a broker or Redis problem must never
   * fail the upload or the invitation that triggered it. Every failure is
   * logged and swallowed.
   *
   * The hot path touches Redis only: the durable generation is read solely when
   * something actually crossed or cleared, which is rare.
   *
   * @param used the current level, in the dimension's own units.
   * @param limit the resolved ceiling. A zero or absent limit is ignored —
   * there is no meaningful percentage of nothing, and a fail-closed limit is
   * already refusing at the enforcement point.
   */
  async evaluate(
    organizationId: string,
    dimension: LimitAlertDimension,
    used: number,
    limit: number,
  ): Promise<void> {
    if (!Number.isFinite(limit) || limit <= 0) return;

    try {
      const key = limitAlertStateKey(organizationId, dimension);
      const level = Number(await this.redis.get(key)) || 0;
      const percent = (used / limit) * 100;

      // Evaluated against generation 0 first: the generation only matters once
      // something crosses or clears, and reading it on every presign would put
      // a Postgres round trip on the hot path for a value that rarely moves.
      const provisional = evaluateLimitAlert(percent, {
        ...INITIAL_LIMIT_ALERT_STATE,
        level,
      });

      const cleared = provisional.state.generation > 0;
      const nothingHappened = provisional.alerts.length === 0 && !cleared;
      if (nothingHappened) return;

      const generation = cleared
        ? await this.generations.bump(organizationId, dimension)
        : await this.generations.read(organizationId, dimension);

      // **The level is committed BEFORE the publish is attempted, and that is a
      // choice.** `JetStreamPublisher.publish` neither throws nor reports
      // failure, so a dropped publish leaves the level raised and that
      // threshold silent until a full recovery below the band.
      //
      // The other order double-alerts instead: publish first and a crash before
      // the `set` re-alerts every crossing on the next evaluation, which for a
      // tenant parked at 96% is every single presign. Under-alerting once is
      // recoverable by the enforcement point, which still refuses at 100%;
      // over-alerting in a loop is what makes people mute the channel.
      await this.redis.set(key, String(provisional.state.level));

      for (const threshold of provisional.alerts) {
        this.publish(organizationId, dimension, threshold, generation);
      }
    } catch (error) {
      // An alert that cannot be sent must not become an upload that cannot be
      // made. The tenant still gets refused at 100% by the enforcement point,
      // which is the guarantee that matters.
      this.logger.warn(
        `Could not evaluate the ${dimension} alarm for ${organizationId}: ${formatErrorMsg(error)}`,
      );
    }
  }

  private publish(
    organizationId: string,
    dimension: LimitAlertDimension,
    threshold: number,
    generation: number,
  ): void {
    const eventId = limitThresholdEventId(
      organizationId,
      dimension,
      threshold,
      generation,
    );

    const command: CreateInAppNotificationCommand = {
      organizationId,
      type: NOTIFICATION_TYPES.limitThreshold,
      // Addressed by PERMISSION, like the budget alert and for the same reason:
      // this producer does not know who holds `organization.update`, and an
      // agent who cannot raise a limit is not helped by being told about it.
      audience: { kind: 'permission', permission: 'organization.update' },
      eventId,
      title: `${LABELS[dimension]} ${threshold}% used`,
      body: BODIES[dimension](threshold),
      // 100% bypasses quiet hours: at the cap the next thing the tenant tries
      // is refused, and that is worth waking somebody for.
      priority:
        threshold === 100
          ? NotificationPriority.CRITICAL
          : NotificationPriority.NORMAL,
      occurredAt: new Date().toISOString(),
      resourceType: NotificationResourceType.ORGANIZATION,
      resourceId: organizationId,
      actionUrl: '/settings/billing',
      data: { dimension, threshold },
    };

    // The SAME derived id as the message id, so the stream's window and the
    // durable constraint collapse on one field rather than two that have to
    // agree.
    this.transport.publish(IN_APP_NOTIFICATION_PATTERN, command, eventId);
  }
}

const LABELS: Record<LimitAlertDimension, string> = {
  seats: 'Agent seats',
  storage: 'Document storage',
  documents: 'Document count',
};

/** What is refused at the cap, in the tenant's terms rather than column names. */
const BODIES: Record<LimitAlertDimension, (threshold: number) => string> = {
  seats: (threshold) =>
    threshold === 100
      ? 'Every seat on your plan is in use. New invitations will be refused until a seat is freed or your plan is changed.'
      : `You are using ${threshold}% of the agent seats on your plan. At 100%, new invitations are refused.`,
  storage: (threshold) =>
    threshold === 100
      ? 'Your document storage is full. New uploads will be refused until space is freed or your plan is changed.'
      : `You are using ${threshold}% of your document storage. At 100%, new uploads are refused.`,
  documents: (threshold) =>
    threshold === 100
      ? 'You have reached the document limit on your plan. New uploads will be refused until documents are removed or your plan is changed.'
      : `You are holding ${threshold}% of the documents your plan allows. At 100%, new uploads are refused.`,
};
