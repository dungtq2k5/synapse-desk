import { Injectable, Logger } from '@nestjs/common';
import {
  CreateInAppNotificationCommand,
  EmailTemplateName,
  formatErrorMsg,
  IN_APP_NOTIFICATION_PATTERN,
  isUniqueConstraintViolation,
  NotificationPriority,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthReferenceService } from '../auth-client/auth-reference.service';
import { EmailService } from '../email/email.service';

/** What one delivery attempt did, for the log and the tests. */
export type DeliveryOutcome = {
  recipients: number;
  created: number;
  duplicates: number;
  emailed: number;
};

/**
 * `notification.in_app.create` → rows a user can actually see — 16-doc §1.
 *
 * **This consumer is the fix for a subject that had no subscriber.** The AI
 * quota alert published into it correctly, idempotently and to the right
 * audience — and nobody was ever told. Every leg of the cap machinery worked
 * except the one that reaches a person, and the emit looked exactly like
 * success, which is why it survived a review.
 *
 * Why it matters more than the earlier casualties of the same gap: RDM §1.14 is
 * explicit that at a 70-80% deflection rate, hitting the cap is a 3-5x spike in
 * agent queue volume. Discovering that from the queue rather than from an 80%
 * warning is the difference between a planned upgrade and an incident.
 */
@Injectable()
export class InAppNotificationService {
  private readonly logger = new Logger(InAppNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authReference: AuthReferenceService,
    private readonly email: EmailService,
  ) {}

  async deliver(
    command: CreateInAppNotificationCommand,
  ): Promise<DeliveryOutcome> {
    const recipients = await this.authReference.listPermissionHolders(
      command.organizationId,
      command.audiencePermission,
    );

    if (recipients.length === 0) {
      // Logged rather than silently dropped. A tenant where nobody holds
      // `organization.update` is a real configuration — and it means the
      // person who needs to upgrade the plan will never hear about the cap,
      // which is worth seeing in a log.
      this.logger.warn(
        `No holder of '${command.audiencePermission}' in ${command.organizationId}; ` +
          `'${command.title}' reached nobody`,
      );

      return { recipients: 0, created: 0, duplicates: 0, emailed: 0 };
    }

    let created = 0;
    let duplicates = 0;

    for (const recipient of recipients) {
      const wrote = await this.persist(command, recipient.userId);
      if (wrote) created += 1;
      else duplicates += 1;
    }

    // Email only for the notifications a duplicate check let through, so a
    // NATS redelivery does not re-mail everyone. The row is the idempotency
    // record for BOTH channels, which is why it is written first.
    const emailed = await this.fanOutEmail(command, recipients, created > 0);

    this.logger.log(
      `'${command.title}' → ${created} new, ${duplicates} duplicate, ${emailed} emailed`,
    );

    return { recipients: recipients.length, created, duplicates, emailed };
  }

  /**
   * One row per recipient. A duplicate is a SUCCESS, not an error.
   *
   * `UNIQUE (recipient_id, event_id)` is the idempotency mechanism and the
   * producer derives `event_id` from the thing that happened — for the quota
   * alert, `quota:{org}:{cycle}:{threshold}` — so a redelivered event is a
   * duplicate-key violation rather than a second notification. Core NATS
   * redelivers, so this is the normal path.
   */
  private async persist(
    command: CreateInAppNotificationCommand,
    recipientId: string,
  ): Promise<boolean> {
    try {
      await this.prisma.notification.create({
        data: {
          organizationId: command.organizationId,
          recipientId,
          type: IN_APP_NOTIFICATION_PATTERN,
          priority: command.priority,
          title: command.title,
          body: command.body,
          eventId: command.eventId,
        },
      });

      return true;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) return false;

      // Not swallowed here — the caller's handler logs and continues, so one
      // bad row does not cost the rest of the audience their notification.
      throw error;
    }
  }

  /**
   * Email as a SECOND channel, not a fallback.
   *
   * A CRITICAL notification is one the user must not miss — 100% budget is the
   * canonical case, and RDM §1.14 gives it `CRITICAL` precisely so it bypasses
   * quiet hours. An in-app row that sits unread until someone opens the app is
   * not a warning; it is a record of a warning that was available.
   *
   * NORMAL notifications stay in-app only. Emailing every 80% crossing to every
   * admin is how a channel earns the filter that then hides the 100% one.
   */
  private async fanOutEmail(
    command: CreateInAppNotificationCommand,
    recipients: Array<{ email: string; fullName: string }>,
    hasNewRecipients: boolean,
  ): Promise<number> {
    if (command.priority !== NotificationPriority.CRITICAL) return 0;
    if (!hasNewRecipients) return 0;

    let sent = 0;

    for (const recipient of recipients) {
      try {
        await this.email.send({
          template: EmailTemplateName.QUOTA_ALERT,
          to: recipient.email,
          data: {
            fullName: recipient.fullName,
            headline: command.title,
            // The BODY, not a rewrite of it. The producer wrote the sentence
            // that says what happens at 100%; paraphrasing here would mean two
            // places deciding what the warning means.
            detail: command.body,
          },
        });

        sent += 1;
      } catch (error) {
        // One address failing must not cost the others theirs. The in-app row
        // is already written, so the notification is not lost — only this
        // channel is.
        this.logger.error(
          `Could not email '${command.title}' to ${recipient.email}: ${formatErrorMsg(error)}`,
        );
      }
    }

    return sent;
  }
}
