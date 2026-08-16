import { Controller, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  EMAIL_INBOUND_PATTERNS,
  EmailTemplateName,
  formatErrorMsg,
  isUniqueConstraintViolation,
  type InboundEmailRejectedEvent,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

/** How long one address waits before it can be told again. */
const AUTO_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Tells a sender their mail was refused — once a day, at most.
 *
 * **The gateway does not send this, and that split is deliberate**
 * The webhook must answer 200 whatever happens, so the drop path cannot be
 * allowed to fail because a mailbox was slow; and the rate limit belongs where
 * the sending happens, because a limit enforced by the publisher counts
 * intentions while the loop is made of messages.
 *
 * **Never throws.** An unhandled rejection in a NATS handler takes the process
 * down, and the worst case here is one courtesy reply nobody receives.
 */
@Controller()
export class InboundRejectionConsumer {
  private readonly logger = new Logger(InboundRejectionConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly configService: ConfigService,
  ) {}

  @EventPattern(EMAIL_INBOUND_PATTERNS.rejected)
  rejected(@Payload() event: InboundEmailRejectedEvent): void {
    void this.reply(event).catch((error: unknown) =>
      this.logger.error(
        `Could not answer a refused inbound email: ${formatErrorMsg(error)}`,
      ),
    );
  }

  private async reply(event: InboundEmailRejectedEvent): Promise<void> {
    const sender = event?.sender?.trim().toLowerCase();

    if (!sender) {
      // A producer-side bug. Logged rather than thrown — the alternative is a
      // dead consumer for every subsequent message.
      this.logger.warn('An inbound rejection arrived with no sender');

      return;
    }

    // A rejection always carries a tenant now: the only reason that resolved to
    // nothing was an unroutable address, and that path no longer replies at all
    // — replying to an unverified sender for an address nobody was issued is
    // backscatter, and the MTA is where an unknown recipient is refused.
    if (!event.organizationId) {
      this.logger.warn(
        'An inbound rejection arrived with no tenant; nothing was sent',
      );

      return;
    }

    if (!(await this.claimDailySlot(event.organizationId, sender))) {
      this.logger.log(`Auto-reply suppressed: ${sender} was told today`);

      return;
    }

    await this.email.send({
      template: EmailTemplateName.INBOUND_REJECTED,
      to: sender,
      data: {
        reason: event.reason,
        portalUrl: this.configService.getOrThrow<string>('APP_WEB_URL'),
        organizationName: null,
      },
    });
  }

  /**
   * Takes today's slot for this address, or reports that it is taken.
   *
   * **Two statements, and the order matters.** `updateMany` with the window in
   * its `WHERE` is atomic — the row is either older than the window or it is
   * not, and only one concurrent caller can move it. The `create` that follows
   * handles the first-ever reply, and its duplicate-key failure means another
   * delivery of the same burst won the race.
   *
   * A read-then-write would let two copies of one auto-responder's message both
   * observe "nobody has replied today" and both reply, which is the exchange
   * this limit exists to bound.
   */
  private async claimDailySlot(
    organizationId: string,
    email: string,
  ): Promise<boolean> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - AUTO_REPLY_WINDOW_MS);

    const moved = await this.prisma.inboundAutoReply.updateMany({
      where: { organizationId, email, lastSentAt: { lt: cutoff } },
      data: { lastSentAt: now },
    });

    if (moved.count > 0) return true;

    try {
      await this.prisma.inboundAutoReply.create({
        data: { organizationId, email, lastSentAt: now },
      });

      // **Pruned here rather than by a scheduled job**, because this service
      // has no scheduler and adding a queue, a registrar and a processor for
      // one sweep is disproportionate to the row it removes.
      //
      // Attached to the INSERT, which is the only path that grows the table: an
      // address that writes again is moved forward by the `updateMany` above,
      // so the rows that accumulate are strangers who never returned. That
      // keeps the table proportional to active correspondents instead of to
      // every address that has ever been refused.
      //
      // Fire-and-forget: a failed prune costs disk, and blocking a courtesy
      // reply on housekeeping would be the wrong trade.
      void this.prisma.inboundAutoReply
        .deleteMany({ where: { lastSentAt: { lt: cutoff } } })
        .catch((error: unknown) =>
          this.logger.warn(
            `Could not prune expired auto-reply rows: ${formatErrorMsg(error)}`,
          ),
        );

      return true;
    } catch (error) {
      // **Narrowed to the unique violation.** A bare catch returned `false` for
      // any failure, so a database outage was reported as "this sender was
      // already told today" — the right direction to fail in for a loop guard,
      // and a log line that actively described the wrong thing.
      if (isUniqueConstraintViolation(error)) return false;

      throw error;
    }
  }
}
