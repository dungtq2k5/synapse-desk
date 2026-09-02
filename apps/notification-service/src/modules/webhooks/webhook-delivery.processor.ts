import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  IN_APP_NOTIFICATION_PATTERN,
  JetStreamPublisher,
  NOTIFICATION_TYPES,
  NotificationPriority,
  WEBHOOK_DISABLE_AFTER_FAILURES,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_QUEUE,
  WebhookDeliveryStatus,
  type CreateInAppNotificationCommand,
  type WebhookEventPayload,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookSenderService } from './webhook-sender.service';
import type { WebhookJobData } from './webhook-dispatch.service';

/**
 * One queued attempt: load the row, POST, record what happened.
 *
 * **The row is the record and the job is a pointer to it.** BullMQ owns the
 * retry arithmetic — attempts, exponential backoff — and this processor owns
 * the facts: status, attempt count, the receiver's last answer. `throw` is the
 * one signal BullMQ understands, so a failed attempt records first and throws
 * second.
 */
@Processor(WEBHOOK_QUEUE, {
  // One at a time per worker. Webhooks are minutes-tolerant by nature and a
  // tenant's flaky receiver timing out must not hold more than one slot.
  concurrency: 2,
})
export class WebhookDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookDeliveryProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: WebhookSenderService,
    private readonly jetstream: JetStreamPublisher,
  ) {
    super();
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: job.data.deliveryId },
      include: { endpoint: true },
    });

    // The row can be gone (retention swept it mid-retry) or already settled (a
    // duplicate job after a redeploy). Neither is work.
    if (!delivery || delivery.status !== String(WebhookDeliveryStatus.PENDING))
      return;

    // Disabled between enqueue and now — the auto-disable below, or a tenant's
    // own PATCH. The row settles as FAILED with the reason, so the deliveries
    // list explains itself instead of showing a PENDING that never moves.
    if (!delivery.endpoint.isActive) {
      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: WebhookDeliveryStatus.FAILED,
          lastError: 'The endpoint was disabled before this delivery ran',
        },
      });

      return;
    }

    const outcome = await this.sender.send(
      delivery.endpoint,
      delivery.payload as WebhookEventPayload,
    );

    if (outcome.delivered) {
      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: WebhookDeliveryStatus.DELIVERED,
          attempts: { increment: 1 },
          responseStatus: outcome.statusCode,
          lastError: null,
          deliveredAt: new Date(),
        },
      });

      // Any success resets the streak — the disable threshold is about a DEAD
      // endpoint, not a flaky one.
      await this.prisma.webhookEndpoint.update({
        where: { id: delivery.endpointId },
        data: { consecutiveFailures: 0 },
      });

      return;
    }

    const exhausted = job.attemptsMade + 1 >= WEBHOOK_MAX_ATTEMPTS;

    await this.prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        // FAILED only when BullMQ will not try again: the status answers "was
        // this event delivered", and PENDING-with-errors is the honest state
        // while retries remain.
        ...(exhausted ? { status: WebhookDeliveryStatus.FAILED } : {}),
        attempts: { increment: 1 },
        responseStatus: outcome.statusCode ?? null,
        lastError: outcome.error.slice(0, 500),
      },
    });

    if (exhausted) {
      await this.recordEndpointFailure(
        delivery.endpointId,
        delivery.endpoint.organizationId,
        delivery.id,
      );

      // Exhausted is SETTLED, not failed work: throwing here would have BullMQ
      // schedule attempt N+1 of N.
      return;
    }

    throw new Error(outcome.error);
  }

  /**
   * The streak, and the disable that makes this feature safe to operate.
   *
   * A dead endpoint with no disable costs one POST per event forever, per
   * tenant, and the load scales with how successful the product is.
   */
  private async recordEndpointFailure(
    endpointId: string,
    organizationId: string,
    deliveryId: string,
  ): Promise<void> {
    const endpoint = await this.prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: { consecutiveFailures: { increment: 1 } },
    });

    if (
      endpoint.consecutiveFailures < WEBHOOK_DISABLE_AFTER_FAILURES ||
      !endpoint.isActive
    ) {
      return;
    }

    const reason = `Auto-disabled after ${endpoint.consecutiveFailures} consecutive failed deliveries`;

    await this.prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: { isActive: false, disabledReason: reason },
    });

    this.logger.warn(`Endpoint ${endpointId} (${endpoint.url}): ${reason}`);

    // **Told, not just recorded** — an endpoint that silently stops is worse
    // than one that noisily does. Published to the same JetStream subject every
    // other producer uses rather than calling `deliver()` directly: the notice
    // flows the standard path (idempotent on eventId, durable, preference-
    // resolved), and this module never imports the in-app service, which
    // imports this one.
    const command: CreateInAppNotificationCommand = {
      organizationId,
      type: NOTIFICATION_TYPES.webhookEndpointDisabled,
      audience: { kind: 'permission', permission: 'organization.update' },
      // Derived from the delivery that tipped the threshold, so a JetStream
      // redelivery of this very notice cannot duplicate it.
      eventId: `webhook-disabled:${endpointId}:${deliveryId}`,
      title: 'A webhook endpoint was disabled',
      body:
        `Deliveries to ${endpoint.url} failed ${endpoint.consecutiveFailures} times in a row, ` +
        'so the endpoint was disabled. Re-enable it from the webhook settings once the receiver is fixed.',
      priority: NotificationPriority.HIGH,
      occurredAt: new Date().toISOString(),
      data: { endpointId, url: endpoint.url, reason },
    };

    // The message id is the dedupe key at the STREAM (the publish window),
    // and the eventId dedupes at the consumer — both derived from the same
    // act, so a retry of this processor cannot double-publish the notice.
    this.jetstream.publish(
      IN_APP_NOTIFICATION_PATTERN,
      command,
      command.eventId,
    );
  }
}
