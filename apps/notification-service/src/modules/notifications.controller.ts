import { Injectable, Logger } from '@nestjs/common';
import {
  CreateInAppNotificationCommand,
  IN_APP_NOTIFICATION_PATTERN,
  NOTIFICATION_PATTERNS,
  SendEmailCommand,
  SendSmsCommand,
  UnprocessableMessage,
} from '@synapsedesk/common';
import { InAppNotificationService } from './in-app/in-app-notification.service';
import { EmailService } from './email/email.service';
import { SmsService } from './sms/sms.service';

/**
 * JetStream entry point for Domain E.
 *
 * Fire-and-forget from the publisher's side: a registration must not fail
 * because the email provider is slow, and no caller has anything useful to do with a delivery
 * receipt.
 *
 * **Plain methods, not `@EventPattern` handlers** (ADR 0041). Nest's NATS
 * transport is core-only, so a decorated handler never receives a durable
 * message; `main.ts` runs a `PullConsumerRunner` per subject and calls these
 * directly. What was lost is Nest's routing, which for three subjects is three
 * runners. What was gained is that the ack is explicit and local.
 */
@Injectable()
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly smsService: SmsService,
    private readonly inApp: InAppNotificationService,
  ) {}

  async handleSendEmail(command: SendEmailCommand): Promise<void> {
    await this.dispatch(
      async () => {
        // The message id is discarded on THIS path deliberately: a bare
        // `notification.email.send` has no `notifications` row to attach a
        // delivery record to. Domain E's own fan-out captures it;
        // this subject predates the table and is still used for transactional
        // mail — a password reset is not an in-app notification.
        await this.emailService.send(command);
      },
      `${command.template} email`,
      NOTIFICATION_PATTERNS.sendEmail,
    );
  }

  async handleSendSms(command: SendSmsCommand): Promise<void> {
    await this.dispatch(
      () => this.smsService.send(command),
      `${command.template} SMS`,
      NOTIFICATION_PATTERNS.sendSms,
    );
  }

  /**
   * The subscriber this subject did not have.
   *
   * `IN_APP_NOTIFICATION_PATTERN` was published to from the moment the quota
   * alert existed, on the same reasoning that had `audit.record` emitting
   * before its consumer did: the producer's obligation is real immediately, and
   * retrofitting it across every call site later is far worse than emitting
   * into a quiet subject. This is the other half finally arriving — and the
   * quota alert is what made it urgent, because a cap nobody is warned about
   * arrives as a 3-5x queue spike rather than as a billing notice.
   */
  async handleInAppNotification(
    command: CreateInAppNotificationCommand,
  ): Promise<void> {
    if (!command?.organizationId || !command.audience || !command.type) {
      // Never guessed at. An audience of "everyone" is the one interpretation a
      // malformed command must not receive, and a missing `type` would produce a
      // row no preference can ever silence — worse than no row at all.
      //
      // `UnprocessableMessage` rather than a log and a return: returning ACKS
      // the message, so a malformed command was destroyed with only a log line
      // left. This parks it in the DLQ without spending a retry, which is what
      // that error exists for — `audit.consumer.ts` guards its `eventId` the
      // same way.
      throw new UnprocessableMessage(
        `${IN_APP_NOTIFICATION_PATTERN} arrived without a tenant, a type or an audience`,
      );
    }

    await this.dispatch(
      async () => {
        await this.inApp.deliver(command);
      },
      `in-app '${command.title}'`,
      IN_APP_NOTIFICATION_PATTERN,
    );
  }

  /**
   * Runs one delivery, naming the failure in the log before letting it out.
   *
   * **Rethrows deliberately — that is how a handler asks to be retried.**
   * `PullConsumerRunner` catches, `nak()`s with the backoff delay while
   * deliveries remain, and parks the message in its DLQ subject after
   * `MAX_DELIVER`. Swallowing here would ack a delivery that never happened.
   *
   * @param send - the delivery to attempt
   * @param description - names the message in the log line, e.g. `welcome email`
   * @param subject - the durable subject it arrived on
   */
  private async dispatch(
    send: () => Promise<void>,
    description: string,
    subject: string,
  ): Promise<void> {
    try {
      await send();
    } catch (error) {
      this.logger.error(
        `Failed to deliver ${description} (subject: ${subject}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }
}

/**
 * Every durable subject this service consumes, paired with what handles it.
 *
 * **One list, read by both `main.ts` and the bootstrap test.** The decorators
 * these replaced were self-describing — a handler that lost its `@EventPattern`
 * could be caught by reflecting over the class — and a hand-maintained list in
 * `main.ts` would give that property up silently. This keeps it: the test
 * asserts these subjects are exactly the non-audit durable ones, so a subject
 * added to the contract without a runner fails rather than going unconsumed.
 */
export type SubjectSubscription = {
  subject: string;
  /**
   * **`never` is doing real work.** The three handlers take three different
   * command types, and function parameters are contravariant — so a parameter of
   * `never` accepts every handler, while `(command: SendEmailCommand) => …`
   * would accept exactly one. It is what makes them one array.
   *
   * The runner supplies the decoded payload and reasserts the type there.
   */
  handle: (command: never) => Promise<void>;
};

export function notificationSubscriptions(
  controller: NotificationsController,
): SubjectSubscription[] {
  return [
    {
      subject: NOTIFICATION_PATTERNS.sendEmail,
      handle: (command: SendEmailCommand) =>
        controller.handleSendEmail(command),
    },
    {
      subject: NOTIFICATION_PATTERNS.sendSms,
      handle: (command: SendSmsCommand) => controller.handleSendSms(command),
    },
    {
      subject: IN_APP_NOTIFICATION_PATTERN,
      handle: (command: CreateInAppNotificationCommand) =>
        controller.handleInAppNotification(command),
    },
  ] as SubjectSubscription[];
}
