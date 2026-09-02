import { Injectable, Logger } from '@nestjs/common';
import { WEBHOOK_RETENTION_DAYS } from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The sweep that bounds `webhook_deliveries`.
 *
 * One row per event per endpoint is unbounded in a way
 * `notification_deliveries` never was — that table is bounded by notifications,
 * which are bounded by events that involve people. This one grows with every
 * event a busy tenant's integrations subscribe to, forever, and nothing else
 * prunes it.
 *
 * The sweep reclaims space; it enforces nothing — a missed night costs disk,
 * not correctness (the `expired-records` rule).
 */
@Injectable()
export class WebhookRetentionJob {
  private readonly logger = new Logger(WebhookRetentionJob.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(): Promise<void> {
    const cutoff = new Date(
      Date.now() - WEBHOOK_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );

    const { count } = await this.prisma.webhookDelivery.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    if (count > 0) {
      this.logger.log(
        `Pruned ${count} webhook delivery row(s) older than ${WEBHOOK_RETENTION_DAYS} days`,
      );
    }
  }
}
