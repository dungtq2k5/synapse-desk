import { Injectable, Logger } from '@nestjs/common';
import {
  DeliverySkipReason,
  DeliveryStatus,
  formatErrorMsg,
  NotificationChannel,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * `notification_deliveries` **Telemetry, not a feature.**
 *
 * No HTTP endpoint anywhere: a user seeing `BOUNCED` on their own address
 * cannot act on it, and `provider_message_id` leaks the ESP relationship. This
 * surfaces through `/platform/metrics` and alerting.
 *
 * **The valuable status is `SKIPPED`.** `SENT` and `FAILED` are obvious; a
 * `SKIPPED` row carrying `quiet_hours` is the difference between answering
 * *"why didn't I get an email?"* in ten seconds and not being able to answer it
 * at all — which is the most common support question this feature will
 * generate, and the reason a silent drop is never acceptable here.
 *
 * Every write is an UPSERT on `(notification_id, channel)`: a retry updates the
 * attempt rather than adding a row, so the table answers "what happened on this
 * channel" and not "how many times did we try before someone looked".
 */
@Injectable()
export class DeliveryRecorder {
  private readonly logger = new Logger(DeliveryRecorder.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordSent(
    notificationId: string,
    channel: NotificationChannel,
    details: { target: string | null; providerMessageId: string | null },
  ): Promise<void> {
    await this.upsert(notificationId, channel, {
      status: DeliveryStatus.SENT,
      target: details.target,
      providerMessageId: details.providerMessageId,
      sentAt: new Date(),
      skipReason: null,
      errorLog: null,
    });
  }

  /**
   * A delivery that was deliberately NOT attempted.
   *
   * `attempts` is left alone: a skip is not a failed try, and counting it as
   * one would make a user with quiet hours look like an address that keeps
   * bouncing.
   */
  async recordSkipped(
    notificationId: string,
    channel: NotificationChannel,
    details: { target: string | null; reason: DeliverySkipReason | string },
  ): Promise<void> {
    await this.upsert(
      notificationId,
      channel,
      {
        status: DeliveryStatus.SKIPPED,
        target: details.target,
        skipReason: details.reason,
        sentAt: null,
        errorLog: null,
        providerMessageId: null,
      },
      { countsAsAttempt: false },
    );
  }

  async recordFailed(
    notificationId: string,
    channel: NotificationChannel,
    details: { target: string | null; error: string },
  ): Promise<void> {
    await this.upsert(notificationId, channel, {
      status: DeliveryStatus.FAILED,
      target: details.target,
      // Truncated: a provider stack trace can be kilobytes, and the first line
      // is what anybody reads. The same convention `ingestion_jobs.error_log`
      // follows.
      errorLog: details.error.slice(0, 1_000),
      failedAt: new Date(),
      skipReason: null,
      providerMessageId: null,
    });
  }

  private async upsert(
    notificationId: string,
    channel: NotificationChannel,
    data: Record<string, unknown>,
    { countsAsAttempt = true }: { countsAsAttempt?: boolean } = {},
  ): Promise<void> {
    try {
      await this.prisma.notificationDelivery.upsert({
        where: {
          notificationId_channel: { notificationId, channel },
        },
        create: {
          notificationId,
          channel,
          attempts: countsAsAttempt ? 1 : 0,
          ...data,
        },
        update: {
          ...data,
          ...(countsAsAttempt ? { attempts: { increment: 1 } } : {}),
        },
      });
    } catch (error) {
      // **Swallowed, and this is the one place in Domain E where that is
      // right.** These rows explain deliveries; they are not the delivery. A
      // telemetry write that could fail the notification it describes would
      // trade the thing for the record of the thing.
      this.logger.error(
        `Could not record ${channel} delivery for ${notificationId}: ${formatErrorMsg(error)}`,
      );
    }
  }
}
