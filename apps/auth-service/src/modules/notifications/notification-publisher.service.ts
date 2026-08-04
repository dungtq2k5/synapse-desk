import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  formatErrorMsg,
  NOTIFICATION_PATTERNS,
  SendEmailCommand,
  SendSmsCommand,
  NATS_CLIENT,
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

  constructor(@Inject(NATS_CLIENT) private readonly client: ClientProxy) {}

  sendEmail(command: SendEmailCommand): void {
    this.publish(NOTIFICATION_PATTERNS.sendEmail, command, command.template);
  }

  sendSms(command: SendSmsCommand): void {
    this.publish(NOTIFICATION_PATTERNS.sendSms, command, command.template);
  }

  /**
   * `emit()` returns a COLD observable — nothing is published until something
   * subscribes. Omitting the `.subscribe()` is the classic silent failure with
   * this API: no error, no message, no clue.
   *
   * Not awaited, so a slow broker adds no latency to the request that triggered
   * it.
   */
  private publish(
    pattern: string,
    payload: unknown,
    description: string,
  ): void {
    this.client.emit(pattern, payload).subscribe({
      error: (error: unknown) =>
        this.logger.error(
          `Failed to publish ${description} to ${pattern}: ${formatErrorMsg(error)}
          }`,
        ),
    });
  }
}
