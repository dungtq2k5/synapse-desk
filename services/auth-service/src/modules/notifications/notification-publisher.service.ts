import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  EmailContent,
  NOTIFICATION_PATTERNS,
  SendEmailCommand,
  SendSmsCommand,
  JetStreamPublisher,
} from '@synapsedesk/common';

/**
 * Fire-and-forget publisher for Domain E.
 *
 * Every method is intentionally NON-throwing. Sending a welcome email is a side
 * effect of registration, not part of it: if NATS is unreachable the account
 * must still exist and the caller must still get its response. Anything that
 * genuinely could not proceed without a notification would have to use a
 * request/response call instead — nothing does today.
 */
@Injectable()
export class NotificationPublisher {
  private readonly logger = new Logger(NotificationPublisher.name);

  constructor(private readonly jetstream: JetStreamPublisher) {}

  /**
   * Publishes one email, stamping the send's identity on it.
   *
   * **`sendId` IS the `Nats-Msg-Id`**, one uuid for both. It is minted here, per
   * call, because this is the one place that knows a new act happened — see
   * {@link SendEmailCommand} for why notification-service needs it.
   */
  sendEmail(content: EmailContent): void {
    const sendId = randomUUID();
    const command: SendEmailCommand = { ...content, sendId };

    this.publish(
      NOTIFICATION_PATTERNS.sendEmail,
      command,
      content.template,
      sendId,
    );
  }

  sendSms(command: SendSmsCommand): void {
    this.publish(NOTIFICATION_PATTERNS.sendSms, command, command.template);
  }

  /**
   * Durable since ADR 0041, and not awaited — a slow broker must add no latency
   * to the request that triggered it.
   *
   * **The `Nats-Msg-Id` is fresh per call, which means these two subjects get
   * no publish dedupe.** That is the documented trade rather than an oversight:
   * the id is minted at the moment of publishing, not by the act that caused
   * it, so a caller that published twice would get two ids and the window has
   * nothing to collapse. ADR 0041 prices it — a password reset that never
   * arrives locks a user out, while one that arrives twice carries the same
   * token and is a nuisance. What the id does buy is on the consuming side:
   * for email it doubles as `sendId`, which makes a JetStream REDELIVERY of one
   * message idempotent at the provider.
   *
   * @param messageId the `Nats-Msg-Id`; a fresh uuid unless the caller needs
   * the same value inside the payload, as `sendEmail` does.
   */
  private publish(
    pattern: string,
    payload: unknown,
    description: string,
    messageId: string = randomUUID(),
  ): void {
    this.logger.debug(`Publishing ${description} to ${pattern}`);
    this.jetstream.publish(pattern, payload, messageId);
  }
}
