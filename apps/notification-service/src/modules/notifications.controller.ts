import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, NatsContext, Payload } from '@nestjs/microservices';
import {
  CreateInAppNotificationCommand,
  IN_APP_NOTIFICATION_PATTERN,
  NOTIFICATION_PATTERNS,
  SendEmailCommand,
  SendSmsCommand,
} from '@synapsedesk/common';
import { InAppNotificationService } from './in-app/in-app-notification.service';
import { EmailService } from './email/email.service';
import { SmsService } from './sms/sms.service';

/**
 * NATS entry point for Domain E.
 *
 * `@EventPattern`, not `@MessagePattern`: the publisher fires and forgets. A
 * registration must not fail because SMTP is slow, and no caller has anything
 * useful to do with a delivery receipt.
 */
@Controller()
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly smsService: SmsService,
    private readonly inApp: InAppNotificationService,
  ) {}

  @EventPattern(NOTIFICATION_PATTERNS.sendEmail)
  async handleSendEmail(
    @Payload() command: SendEmailCommand,
    @Ctx() context: NatsContext,
  ): Promise<void> {
    await this.dispatch(
      () => this.emailService.send(command),
      `${command.template} email`,
      context,
    );
  }

  @EventPattern(NOTIFICATION_PATTERNS.sendSms)
  async handleSendSms(
    @Payload() command: SendSmsCommand,
    @Ctx() context: NatsContext,
  ): Promise<void> {
    await this.dispatch(
      () => this.smsService.send(command),
      `${command.template} SMS`,
      context,
    );
  }

  /**
   * The subscriber this subject did not have — 16-doc §1.
   *
   * `IN_APP_NOTIFICATION_PATTERN` was published to from the moment the quota
   * alert existed, on the same reasoning that had `audit.record` emitting
   * before its consumer did: the producer's obligation is real immediately, and
   * retrofitting it across every call site later is far worse than emitting
   * into a quiet subject. This is the other half finally arriving — and the
   * quota alert is what made it urgent, because a cap nobody is warned about
   * arrives as a 3-5x queue spike rather than as a billing notice.
   */
  @EventPattern(IN_APP_NOTIFICATION_PATTERN)
  async handleInAppNotification(
    @Payload() command: CreateInAppNotificationCommand,
    @Ctx() context: NatsContext,
  ): Promise<void> {
    if (!command?.organizationId || !command.audiencePermission) {
      // Dropped rather than guessed at. An audience of "everyone" is the one
      // interpretation a malformed command must never receive.
      this.logger.error(
        `${IN_APP_NOTIFICATION_PATTERN} arrived without a tenant or an audience`,
      );
      return;
    }

    await this.dispatch(
      async () => {
        await this.inApp.deliver(command);
      },
      `in-app '${command.title}'`,
      context,
    );
  }

  /**
   * Swallows the error after logging it.
   *
   * An event handler that throws gives core NATS nowhere to put the failure —
   * there is no reply channel and, without JetStream ack semantics wired up, no
   * redelivery either. Rethrowing would surface as an unhandled rejection and
   * take the process down, losing every other queued notification. Logging and
   * continuing keeps one bad message from becoming an outage.
   *
   * TODO Once JetStream is in use (the broker already runs with `-js`), replace
   * this with an explicit nak() so failed sends are redelivered with backoff and
   * land in a DLQ after N attempts.
   */
  private async dispatch(
    send: () => Promise<void>,
    description: string,
    context: NatsContext,
  ): Promise<void> {
    try {
      await send();
    } catch (error) {
      this.logger.error(
        `Failed to deliver ${description} (subject: ${context.getSubject()}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
