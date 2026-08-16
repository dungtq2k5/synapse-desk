import { Injectable, Logger } from '@nestjs/common';
import {
  CreateInAppNotificationCommand,
  EmailTemplateName,
  formatErrorMsg,
  isUniqueConstraintViolation,
  NotificationAudience,
  NotificationChannel,
  NotificationPriority,
  NotificationResourceType,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthReferenceService } from '../auth-client/auth-reference.service';
import { EmailService } from '../email/email.service';
import { ReplyAddressService } from '../email/reply-address.service';
import { DeliveryRecorder } from '../deliveries/delivery-recorder.service';
import { PreferenceResolver } from '../preferences/preference-resolver.service';
import { NotificationRealtimePublisher } from '../realtime/notification-realtime.publisher';

/** What one delivery attempt did, for the log and the tests. */
export type DeliveryOutcome = {
  recipients: number;
  created: number;
  /** Rows an existing unread group absorbed rather than duplicating. */
  grouped: number;
  duplicates: number;
  emailed: number;
};

/** A resolved recipient — the shape both audience kinds produce. */
type Recipient = {
  userId: string;
  email: string;
  fullName: string;
};

/**
 * `notification.in_app.create` → rows a user can actually see
 *
 * **This consumer is the fix for a subject that had no subscriber.** The AI
 * quota alert published into it correctly, idempotently and to the right
 * audience — and nobody was ever told. Every leg of the cap machinery worked
 * except the one that reaches a person, and the emit looked exactly like
 * success, which is why it survived a review.
 *
 * Turns it from one producer's consumer into Domain E's write path:
 * two audience kinds, group collapse, preference and quiet-hours resolution,
 * and a delivery row for every channel including the ones that were skipped.
 */
@Injectable()
export class InAppNotificationService {
  private readonly logger = new Logger(InAppNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authReference: AuthReferenceService,
    private readonly email: EmailService,
    private readonly deliveries: DeliveryRecorder,
    private readonly preferences: PreferenceResolver,
    private readonly realtime: NotificationRealtimePublisher,
    private readonly replyAddress: ReplyAddressService,
  ) {}

  async deliver(
    command: CreateInAppNotificationCommand,
  ): Promise<DeliveryOutcome> {
    const recipients = await this.resolveAudience(
      command.organizationId,
      command.audience,
    );

    // **Never notify the actor** rule 1.
    //
    // Applied HERE rather than in each producer, so a new producer gets it for
    // free. An agent who assigns a ticket to themselves being told about it is
    // the first thing anyone notices by hand, and it makes the whole feature
    // feel broken on first use.
    const audience = command.actorId
      ? recipients.filter((recipient) => recipient.userId !== command.actorId)
      : recipients;

    if (audience.length === 0) {
      // Logged rather than silently dropped. A tenant where nobody holds
      // `organization.update` is a real configuration — and it means the
      // person who needs to upgrade the plan will never hear about the cap.
      //
      // It is also the ordinary outcome of the actor filter above (you replied
      // to your own ticket), which is why this is a debug-level line for a
      // `users` audience and a warning for a permission one: an unresolvable
      // permission is a misconfiguration, an empty user list usually is not.
      const message =
        `No recipient for '${command.title}' in ${command.organizationId} ` +
        `(${describeAudience(command.audience)})`;

      if (command.audience.kind === 'permission') this.logger.warn(message);
      else this.logger.debug(message);

      return {
        recipients: 0,
        created: 0,
        grouped: 0,
        duplicates: 0,
        emailed: 0,
      };
    }

    let created = 0;
    let grouped = 0;
    let duplicates = 0;
    const newlyNotified: Recipient[] = [];

    for (const recipient of audience) {
      try {
        const outcome = await this.persist(command, recipient.userId);

        if (outcome.kind === 'created') {
          created += 1;
          newlyNotified.push(recipient);
        } else if (outcome.kind === 'grouped') {
          grouped += 1;
        } else {
          duplicates += 1;
        }

        if (outcome.notificationId) {
          await this.recordInAppDelivery(outcome.notificationId);
          this.realtime.publish(command, outcome, recipient.userId);
        }
      } catch (error) {
        // **One recipient's failure must not cost the others theirs**
        // . A fan-out that aborts halfway is worse than one
        // that loses a single row: the recipients it did not reach have no
        // record that anything was attempted.
        this.logger.error(
          `Could not notify ${recipient.userId} of '${command.title}': ${formatErrorMsg(error)}`,
        );
      }
    }

    // Email only for recipients whose row was genuinely NEW, so a NATS
    // redelivery does not re-mail an audience. The notification row is the
    // idempotency record for BOTH channels, which is why it is written first.
    const emailed = await this.fanOutEmail(command, newlyNotified);

    this.logger.log(
      `'${command.title}' (${command.type}) → ${created} new, ${grouped} grouped, ` +
        `${duplicates} duplicate, ${emailed} emailed`,
    );

    return {
      recipients: audience.length,
      created,
      grouped,
      duplicates,
      emailed,
    };
  }

  /**
   * The audience, by whichever kind the producer used
   *
   * A `users` audience makes **no call to auth-service for resolution**: the
   * producer already knows who, and a permission lookup here is the exact bug
   * this union exists to prevent — resolving `ticket.read` holders would tell
   * every agent in the tenant that one of them got a ticket.
   *
   * It does still need the addresses, which auth-service owns, and that read is
   * by id rather than by permission.
   */
  private async resolveAudience(
    organizationId: string,
    audience: NotificationAudience,
  ): Promise<Recipient[]> {
    if (audience.kind === 'permission') {
      return this.authReference.listPermissionHolders(
        organizationId,
        audience.permission,
        audience.departmentId,
      );
    }

    const userIds = [...new Set(audience.userIds.filter(Boolean))];
    if (userIds.length === 0) return [];

    return this.authReference.listUsersByIds(organizationId, userIds);
  }

  /**
   * One row per recipient — inserted, GROUPED, or recognised as a duplicate.
   *
   * Three outcomes rather than two, and the middle one is what stops this
   * being a spam machine: `ticket.message_created` fires on every message, so
   * a busy ticket without collapse produces a notification per reply and the
   * user turns notifications off in week one.
   */
  private async persist(
    command: CreateInAppNotificationCommand,
    recipientId: string,
  ): Promise<PersistOutcome> {
    if (command.groupKey) {
      const collapsed = await this.tryGroup(command, recipientId);
      if (collapsed) return collapsed;
    }

    try {
      const notification = await this.prisma.notification.create({
        data: {
          organizationId: command.organizationId,
          recipientId,
          type: command.type,
          priority: command.priority,
          title: command.title,
          body: command.body,
          eventId: command.eventId,
          actorId: command.actorId,
          data: (command.data ?? {}) as never,
          actionUrl: command.actionUrl,
          resourceType: command.resourceType,
          resourceId: command.resourceId,
          groupKey: command.groupKey,
          lastGroupEventId: command.groupKey ? command.eventId : null,
        },
      });

      return { kind: 'created', notificationId: notification.id };
    } catch (error) {
      // A duplicate is SUCCESS, not an error. `UNIQUE (recipient_id, event_id)`
      // is the idempotency mechanism and the producer DERIVES `event_id` from
      // the thing that happened, so a redelivered event is a duplicate-key
      // violation rather than a second notification. Core NATS redelivers, so
      // this is the normal path.
      if (isUniqueConstraintViolation(error)) {
        return { kind: 'duplicate', notificationId: null };
      }

      throw error;
    }
  }

  /**
   * Collapse onto an existing UNREAD notification with the same group key.
   *
   * **Scoped to unread deliberately**. Once the user has read
   * *"3 new replies"*, the next reply is new information and starts a fresh
   * row — otherwise a long thread produces one notification the user read on
   * day one and never sees again.
   *
   * `created_at` is refreshed so the row returns to the top of the feed. A
   * collapsed notification that stayed where it was would be indistinguishable
   * from one nothing had happened to.
   */
  private async tryGroup(
    command: CreateInAppNotificationCommand,
    recipientId: string,
  ): Promise<PersistOutcome | null> {
    const existing = await this.prisma.notification.findFirst({
      where: {
        recipientId,
        groupKey: command.groupKey,
        readAt: null,
        archivedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!existing) return null;

    // **The honest limit of this guard**. The INSERT is deduped
    // by the unique index; an increment has no such protection, so a NATS
    // redelivery could double-count. Comparing against the last triggering
    // event id covers CONSECUTIVE redelivery — which is the case NATS actually
    // produces — and not arbitrary reordering.
    //
    // A count reading "4 new replies" instead of "3" is a cosmetic error, so
    // the cheap guard is the proportionate one; a full event log to make it
    // exact would cost more than the defect.
    if (existing.lastGroupEventId === command.eventId) {
      return { kind: 'duplicate', notificationId: null };
    }

    await this.prisma.notification.update({
      where: { id: existing.id },
      data: {
        groupCount: { increment: 1 },
        // Back to the top of the feed.
        createdAt: new Date(),
        lastGroupEventId: command.eventId,
        // The newest event's wording wins: "12 new messages" should name the
        // most recent sender, not the one from an hour ago.
        title: command.title,
        body: command.body,
      },
    });

    return { kind: 'grouped', notificationId: existing.id };
  }

  /**
   * The IN_APP delivery row.
   *
   * Written even though the in-app channel cannot fail: `notification_deliveries`
   * is the answer to *"was I notified at all, and on what?"*, and a channel
   * missing from it reads as one that was never tried.
   */
  private async recordInAppDelivery(notificationId: string): Promise<void> {
    await this.deliveries.recordSent(
      notificationId,
      NotificationChannel.IN_APP,
      { target: null, providerMessageId: null },
    );
  }

  /**
   * Email as a SECOND channel, not a fallback.
   *
   * A `CRITICAL` notification is one the user must not miss — 100% budget is
   * the canonical case, and RDM §1.14 gives it `CRITICAL` precisely so it
   * bypasses quiet hours. An in-app row that sits unread until someone opens
   * the app is not a warning; it is a record of a warning that was available.
   *
   * Everything below `CRITICAL` is in-app only. Emailing every reply to every
   * agent is how a channel earns the filter that then hides the one that
   * mattered — and you get one chance at a user's
   * notification settings.
   */
  private async fanOutEmail(
    command: CreateInAppNotificationCommand,
    recipients: Recipient[],
  ): Promise<number> {
    if (recipients.length === 0) return 0;

    // **The priority gate comes BEFORE preferences, and that ordering is the
    // rule.** Email is a second channel for notifications a user must not miss,
    // not a mirror of the feed. A `NORMAL` notification is never eligible for
    // it, so no delivery row is written either: a `SKIPPED` row per ticket
    // reply would bury the `quiet_hours` and `user_preference` rows that exist
    // to answer a support question.
    //
    // The consequence, stated rather than implied: an EMAIL preference only
    // has an effect on `CRITICAL` notifications today. It is still worth
    // storing — those are the ones a user most wants control over — and it
    // becomes broader the moment another priority earns the channel.
    if (command.priority !== NotificationPriority.CRITICAL) return 0;

    let sent = 0;

    for (const recipient of recipients) {
      const decision = await this.preferences.resolve({
        userId: recipient.userId,
        organizationId: command.organizationId,
        type: command.type,
        channel: NotificationChannel.EMAIL,
        priority: command.priority,
      });

      if (!decision.allowed) {
        // **A suppressed notification is a SKIPPED row, never a silent drop**
        //. "I never got notified" is unanswerable without it, and
        // it is the single most common support question this feature will
        // generate.
        await this.skipEmail(command, recipient, decision.reason);
        continue;
      }

      try {
        const result = await this.email.send(
          {
            template: EmailTemplateName.QUOTA_ALERT,
            to: recipient.email,
            data: {
              fullName: recipient.fullName,
              headline: command.title,
              // The BODY, not a rewrite of it. The producer wrote the sentence
              // that says what happens next; paraphrasing here would mean two
              // places deciding what the warning means.
              detail: command.body,
            },
          },
          // **A ticket notification is answerable; everything else is not** —
          // The address carries a per-ticket token, so replying to
          // this email appends to the thread it is about rather than opening a
          // duplicate. A notification about anything else offers none, because
          // there is nothing for a reply to attach to.
          { replyTo: await this.replyAddressFor(command) },
        );

        await this.deliveries.recordSent(
          await this.notificationIdFor(command, recipient.userId),
          NotificationChannel.EMAIL,
          {
            target: recipient.email,
            providerMessageId: result?.messageId ?? null,
          },
        );

        sent += 1;
      } catch (error) {
        // One address failing must not cost the others theirs. The in-app row
        // is already written, so the notification is not lost — only this
        // channel is, and the delivery row says which.
        this.logger.error(
          `Could not email '${command.title}' to ${recipient.email}: ${formatErrorMsg(error)}`,
        );

        await this.deliveries.recordFailed(
          await this.notificationIdFor(command, recipient.userId),
          NotificationChannel.EMAIL,
          { target: recipient.email, error: formatErrorMsg(error) },
        );
      }
    }

    return sent;
  }

  /**
   * The `Reply-To` for a ticket notification, or `undefined`.
   *
   * `resourceType`/`resourceId` are how a notification says what it is about,
   * and only a TICKET has a thread to reply into. The ticket NUMBER is what the
   * reply token encodes — the id is a uuid and would not fit an address.
   */
  private async replyAddressFor(
    command: CreateInAppNotificationCommand,
  ): Promise<string | undefined> {
    if (command.resourceType !== NotificationResourceType.TICKET) {
      return undefined;
    }

    // **The number comes from `data`, which is where `ticketTarget` puts it.**
    // The command carries `resourceId` — a uuid — and the reply token encodes
    // the NUMBER, because a uuid does not fit inside a 64-octet local part
    // beside the tenant token.
    const ticketNumber = (command.data as { ticketNumber?: number } | undefined)
      ?.ticketNumber;

    if (typeof ticketNumber !== 'number') return undefined;

    return this.replyAddress.forTicket(command.organizationId, ticketNumber);
  }

  private async skipEmail(
    command: CreateInAppNotificationCommand,
    recipient: Recipient,
    reason: string,
  ): Promise<void> {
    await this.deliveries.recordSkipped(
      await this.notificationIdFor(command, recipient.userId),
      NotificationChannel.EMAIL,
      { target: recipient.email, reason },
    );
  }

  /**
   * The row this command produced for this recipient.
   *
   * Looked up rather than threaded through, because the email fan-out runs
   * after the whole audience has been persisted and the alternative is
   * carrying a parallel array of ids that can only ever get out of step.
   */
  private async notificationIdFor(
    command: CreateInAppNotificationCommand,
    recipientId: string,
  ): Promise<string> {
    const row = await this.prisma.notification.findFirstOrThrow({
      where: { recipientId, eventId: command.eventId },
      select: { id: true },
    });

    return row.id;
  }
}

type PersistOutcome = {
  kind: 'created' | 'grouped' | 'duplicate';
  notificationId: string | null;
};

/** For a log line that says what was tried, not just that nothing matched. */
function describeAudience(audience: NotificationAudience): string {
  return audience.kind === 'permission'
    ? `permission '${audience.permission}'`
    : `${audience.userIds.length} user(s)`;
}
