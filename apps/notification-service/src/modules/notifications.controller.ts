import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, NatsContext, Payload } from '@nestjs/microservices';
import {
  NOTIFICATION_PATTERNS,
  SendEmailCommand,
  SendSmsCommand,
} from '@synapsedesk/common';
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
