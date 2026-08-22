import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
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

  sendEmail(command: SendEmailCommand): void {
    this.publish(NOTIFICATION_PATTERNS.sendEmail, command, command.template);
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
   * a `SendEmailCommand` carries no id of the act that caused it, so there is
   * nothing for the window to collapse against. ADR 0041 prices it — a password
   * reset that never arrives locks a user out, while one that arrives twice
   * carries the same token and is a nuisance.
   */
  private publish(
    pattern: string,
    payload: unknown,
    description: string,
  ): void {
    this.logger.debug(`Publishing ${description} to ${pattern}`);
    this.jetstream.publish(pattern, payload, randomUUID());
  }
}
