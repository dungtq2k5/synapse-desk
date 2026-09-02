import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  WEBHOOK_BACKOFF_MS,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_QUEUE,
  WebhookDeliveryStatus,
  formatErrorMsg,
  isUniqueConstraintViolation,
  type CreateInAppNotificationCommand,
  type WebhookEventPayload,
} from '@synapsedesk/common';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** What a queued job carries: the row is the record, the job is a pointer. */
export type WebhookJobData = { deliveryId: string };

/**
 * One event → one delivery row and one queued POST per subscribed endpoint.
 *
 * **Called at the TOP of `deliver()`, before the actor filter and before the
 * empty-audience return — and that placement is load-bearing.** Those branches
 * are people rules: "never notify the actor" is about not telling a person
 * what they just did. An integration is not a person; it wants the event
 * BECAUSE somebody did something. Hooked below them, a self-assigned ticket —
 * which produces zero notification rows by design, measured by the system
 * test — would silently never reach the tenant's endpoint, with no row, no
 * error, and nothing to look at.
 */
@Injectable()
export class WebhookDispatchService {
  private readonly logger = new Logger(WebhookDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WEBHOOK_QUEUE) private readonly queue: Queue<WebhookJobData>,
  ) {}

  /**
   * Fans one command out to the tenant's subscribed endpoints.
   *
   * **Failure here must not cost the person-facing path**: a Redis hiccup that
   * refused an enqueue is a webhook problem, and swallowing it into a log is
   * the same call `fanOutEmail` makes for its own arm. The delivery rows that
   * did get written are picked up by nothing — visibly PENDING with zero
   * attempts, which is what `GET .../deliveries` is for.
   */
  async dispatch(command: CreateInAppNotificationCommand): Promise<number> {
    try {
      return await this.enqueue(command);
    } catch (error) {
      this.logger.error(
        `Could not enqueue webhooks for ${command.type} in ${command.organizationId}: ${formatErrorMsg(error)}`,
      );

      return 0;
    }
  }

  private async enqueue(
    command: CreateInAppNotificationCommand,
  ): Promise<number> {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: {
        organizationId: command.organizationId,
        isActive: true,
        eventTypes: { has: command.type },
      },
      select: { id: true },
    });

    if (endpoints.length === 0) return 0;

    let enqueued = 0;

    for (const endpoint of endpoints) {
      // **`(endpointId, eventId)` unique is the idempotency**, the same
      // mechanism `billing_events` uses for Stripe redelivery: the command
      // subject is JetStream and delivery is at-least-once, so the second
      // arrival of one event is a duplicate-key no-op rather than a second
      // POST the receiver has to deduplicate.
      const delivery = await this.prisma.webhookDelivery
        .create({
          data: {
            endpointId: endpoint.id,
            eventId: command.eventId,
            eventType: command.type,
            status: WebhookDeliveryStatus.PENDING,
            occurredAt: new Date(command.occurredAt),
            // Through `InputJsonValue`: Prisma's JSON input type cannot
            // absorb `Record<string, unknown>` directly, and the payload is by
            // construction JSON — it exists to be serialized once and signed.
            payload: WebhookDispatchService.payloadFor(
              command,
            ) as unknown as Prisma.InputJsonValue,
          },
          select: { id: true },
        })
        .catch((error: unknown) => {
          if (isUniqueConstraintViolation(error)) return null;
          throw error;
        });

      if (!delivery) continue;

      await this.queue.add(
        'deliver',
        { deliveryId: delivery.id },
        {
          attempts: WEBHOOK_MAX_ATTEMPTS,
          backoff: { type: 'exponential', delay: WEBHOOK_BACKOFF_MS },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      );

      enqueued += 1;
    }

    return enqueued;
  }

  /** The payload the processor sends — built once, from the ROW plus command data. */
  static payloadFor(
    command: Pick<
      CreateInAppNotificationCommand,
      | 'eventId'
      | 'type'
      | 'occurredAt'
      | 'organizationId'
      | 'resourceType'
      | 'resourceId'
      | 'data'
    >,
  ): WebhookEventPayload {
    // **No `title`, no `body` — ever.** They are product copy: written for a
    // person, in one language, changed whenever somebody improves a sentence.
    // In an integration payload every copy edit becomes a breaking API change
    // for every customer parsing it — and they would parse it, because it
    // would be the only human-readable field.
    return {
      id: command.eventId,
      type: command.type,
      occurredAt: command.occurredAt,
      organizationId: command.organizationId,
      resourceType: command.resourceType ?? null,
      resourceId: command.resourceId ?? null,
      data: command.data ?? {},
    };
  }
}
