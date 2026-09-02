import { Injectable, Logger } from '@nestjs/common';
import {
  CreateInAppNotificationCommand,
  EmailTemplateName,
  formatErrorMsg,
  isUniqueConstraintViolation,
  NotificationAudience,
  NotificationChannel,
  type SendPushCommand,
  NotificationPriority,
  NotificationResourceType,
  NOTIFICATION_TYPES,
  SendEmailCommand,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookDispatchService } from '../webhooks/webhook-dispatch.service';
import { AuthReferenceService } from '../auth-client/auth-reference.service';
import type { NotificationRecipient } from '../auth-client/auth-reference.mapper';
import { DeviceTokenService } from '../push/device-token.service';
import { FirebaseMessagingService } from '../push/firebase-messaging.service';
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
  /**
   * People reached on PUSH, not devices — the unit the delivery row uses.
   *
   * Present for the reason this type's docblock gives: computed and logged but
   * absent from the return, every push assertion had to go through
   * `notification_deliveries`, which answers what was RECORDED rather than what
   * the fan-out did.
   */
  pushed: number;
};

/**
 * A recipient, with everything needed to DECIDE about them.
 *
 * **`NotificationRecipient` rather than a narrower local type**, and the
 * difference is a live guard. This used to be `{ userId, email, fullName }` —
 * structurally assignable from what `AuthReferenceService` returns, so it
 * compiled while silently dropping `quietHoursStart`, `quietHoursEnd` and
 * `timezone` at the boundary. `resolve()` was then called without them,
 * `input.quietHours` was always `undefined`, and the quiet-hours branch was
 * unreachable: `DeliverySkipReason.QUIET_HOURS` had no producer anywhere in the
 * system, while its resolver and its window arithmetic were both correct and
 * both unit-tested.
 *
 * The narrowing is the whole defect, which is why this alias exists rather than
 * a hand-written shape: a type that lists three fields cannot fail to compile
 * when a fourth becomes load-bearing.
 */
type Recipient = NotificationRecipient;

/**
 * How many recent group event ids a notification remembers.
 *
 * The guard it powers has to survive NON-consecutive redelivery: a nak'd
 * message comes back after later messages have already advanced the group, so
 * comparing against a single "last" id misses exactly the case a pull consumer
 * produces (ADR 0041). Twenty is the number of increments a redelivery can be
 * displaced by and still be caught, and a displacement wider than that means
 * something is far more wrong than a group count.
 */
const GROUP_EVENT_WINDOW = 20;

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
    private readonly deviceTokens: DeviceTokenService,
    private readonly messaging: FirebaseMessagingService,
    private readonly webhooks: WebhookDispatchService,
  ) {}

  async deliver(
    command: CreateInAppNotificationCommand,
  ): Promise<DeliveryOutcome> {
    // **Webhooks first — before the audience is even resolved.** Everything
    // below this line is people rules: the actor filter and the empty-audience
    // return decide who gets TOLD, and an integration is not a person — it
    // wants the event BECAUSE somebody did something. Hooked any later, a
    // self-assigned ticket (zero notification rows by design, measured by the
    // system test) would silently never reach the tenant's endpoint.
    await this.webhooks.dispatch(command);

    const recipients = await this.resolveAudience(
      command.organizationId,
      command.audience,
    );

    // **Never notify the actor.**
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
        pushed: 0,
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
        //. A fan-out that aborts halfway is worse than one
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
    const pushed = await this.fanOutPush(command, newlyNotified);

    this.logger.log(
      `'${command.title}' (${command.type}) → ${created} new, ${grouped} grouped, ` +
        `${duplicates} duplicate, ${emailed} emailed, ${pushed} pushed`,
    );

    return {
      recipients: audience.length,
      created,
      grouped,
      duplicates,
      emailed,
      pushed,
    };
  }

  /**
   * The audience, by whichever kind the producer used.
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
   * One row per recipient — inserted, GROUPED, or recognized as a duplicate.
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
          groupEventIds: command.groupKey ? [command.eventId] : [],
        },
      });

      return { kind: 'created', notificationId: notification.id };
    } catch (error) {
      // A duplicate is SUCCESS, not an error. `UNIQUE (recipient_id, event_id)`
      // is the idempotency mechanism and the producer DERIVES `event_id` from
      // the thing that happened, so a redelivered event is a duplicate-key
      // violation rather than a second notification. The stream redelivers
      // (ADR 0041), so this is the normal path.
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
    // One statement, not a read-then-update, and the reason is the same one
    // `markTicketRead` gives: two deliveries racing would both read the row,
    // both find their id absent, and both increment. The `NOT (... = ANY(...))`
    // has to be part of the UPDATE for the database to decide it.
    //
    // `[1:GROUP_EVENT_WINDOW]` after the prepend keeps the newest ids and drops
    // the rest, so a thread with ten thousand replies does not carry ten
    // thousand ids on every increment.
    const [updated] = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE notifications
      SET group_count = group_count + 1,
          -- Back to the top of the feed. A collapsed notification that stayed
          -- where it was would be indistinguishable from one nothing happened to.
          created_at = NOW(),
          group_event_ids =
            (ARRAY[${command.eventId}::varchar(100)] || group_event_ids)[1:${GROUP_EVENT_WINDOW}],
          -- The newest event's wording wins: "12 new messages" should name the
          -- most recent sender, not the one from an hour ago.
          title = ${command.title},
          body = ${command.body}
      WHERE id = (
        SELECT id FROM notifications
        WHERE recipient_id = ${recipientId}
          AND group_key = ${command.groupKey}
          AND read_at IS NULL
          AND archived_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      )
      AND NOT (${command.eventId} = ANY(group_event_ids))
      RETURNING id
    `;

    if (updated) return { kind: 'grouped', notificationId: updated.id };

    // No row came back for one of two reasons, and they need telling apart:
    // either there was no open group to collapse onto — in which case the
    // caller must INSERT — or there was one and this event had already been
    // counted into it.
    const open = await this.prisma.notification.findFirst({
      where: {
        recipientId,
        groupKey: command.groupKey,
        readAt: null,
        archivedAt: null,
      },
      select: { id: true },
    });

    if (!open) return null;

    return { kind: 'duplicate', notificationId: null };
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
    //
    // **And QUIET HOURS cannot fire on this channel at all**, which is a
    // second consequence of the same line and not obvious from either half.
    // The resolver suppresses on quiet hours only for non-`CRITICAL`
    // notifications, and this gate means nothing below `CRITICAL` ever reaches
    // the resolver — so the two conditions are mutually exclusive here. The
    // window is still passed (it was silently dropped before, which is a
    // separate defect this change fixed), and the first channel where it can
    // actually suppress anything is PUSH, whose gate is `HIGH`. That is why
    // the quiet-hours test lives on the push arm rather than this one.
    if (command.priority !== NotificationPriority.CRITICAL) return 0;

    let sent = 0;

    for (const recipient of recipients) {
      const decision = await this.preferences.resolve({
        userId: recipient.userId,
        organizationId: command.organizationId,
        type: command.type,
        channel: NotificationChannel.EMAIL,
        priority: command.priority,
        // **Carried through, which it was not.** The read that produced this
        // recipient fetches the window precisely so this call does not need a
        // second round trip; passing it is the line that makes the resolver's
        // quiet-hours branch reachable at all.
        quietHours: quietHoursOf(recipient),
      });

      if (!decision.allowed) {
        // **A suppressed notification is a SKIPPED row, never a silent drop.**
        // "I never got notified" is unanswerable without it, and it is the
        // single most common support question this feature will generate.
        await this.skipEmail(command, recipient, decision.reason);
        continue;
      }

      const email = emailFor(command, recipient);

      if (!email) {
        // A type with no email arm. Not an error and not a suppression: the
        // notification exists in the feed, and there is simply no template for
        // it — which is true of every ticket event and of `plan.changed`.
        continue;
      }

      try {
        const result = await this.email.send(
          email,
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

  /**
   * The push arm — one delivery row per PERSON, `n` tokens.
   *
   * **`HIGH` and above, not `CRITICAL`.** Copying email's gate would reproduce
   * the gap this channel exists to close: at `CRITICAL` only, a phone user
   * still learns nothing about a ticket assigned to them, an escalation, or 80%
   * storage — precisely the notifications a mobile client is for. Push is the
   * cheap-attention channel: no per-message cost, no inbox to pollute, and an
   * OS-level mute the user already controls.
   *
   * **The gate only means something if producers publish above it**, and for a
   * while this one did not: `ticket.assigned` and `ticket.reassigned` — the two
   * the sentence above names — were published at `NORMAL`, so the example
   * justifying the gate was one the gate never saw. The priorities are where
   * that decision actually lives, and `push.e2e-spec` test 10 drives the real
   * consumer so the two cannot drift apart again silently.
   *
   * **The no-row rule below the gate is kept**, for the reason email states: a
   * `SKIPPED` row per ticket reply would bury the `quiet_hours` and
   * `user_preference` rows that exist to answer a support question. Push has
   * more volume than email, not less.
   */
  private async fanOutPush(
    command: CreateInAppNotificationCommand,
    recipients: Recipient[],
  ): Promise<number> {
    if (recipients.length === 0) return 0;

    if (
      command.priority !== NotificationPriority.CRITICAL &&
      command.priority !== NotificationPriority.HIGH
    ) {
      return 0;
    }

    // **Before the loop, because it is a pure function of `command.type`.**
    // Below, it ran after `resolve()` and `listForUser()` — two queries and a
    // possible `SKIPPED` row — so a user with push disabled could be given a
    // `USER_PREFERENCE` row for a notification that had no push to suppress:
    // the noise the no-row rule exists to prevent, arriving through the other
    // door. Unreachable while every `null` arm was published below the gate,
    // and reachable the moment one of them is raised.
    const push = pushFor(command);
    if (!push) return 0;

    let sent = 0;

    for (const recipient of recipients) {
      const decision = await this.preferences.resolve({
        userId: recipient.userId,
        organizationId: command.organizationId,
        type: command.type,
        channel: NotificationChannel.PUSH,
        priority: command.priority,
        // **The channel where quiet hours can finally fire.** Email's gate is
        // `CRITICAL`-only and the resolver exempts `CRITICAL`, so the two are
        // mutually exclusive there; a `HIGH` push at 3am is the case the window
        // was written for — an email waits until morning, a push wakes someone.
        quietHours: quietHoursOf(recipient),
      });

      if (!decision.allowed) {
        await this.skipPush(command, recipient, decision.reason);
        continue;
      }

      const devices = await this.deviceTokens.listForUser(recipient.userId);

      // **No row at all**, and this is not a skip: nothing was suppressed,
      // there was nowhere to send. A `SKIPPED` row per notification per
      // web-only user would bury the rows that answer real questions.
      if (devices.length === 0) continue;

      sent += await this.sendPush(command, recipient, devices, push);
    }

    return sent;
  }

  /**
   * One multicast, one delivery row, and the per-device outcome written where
   * it is useful.
   *
   * @returns 1 when at least one device accepted, 0 otherwise — the unit is
   *   PEOPLE reached, matching what the delivery row records.
   */
  private async sendPush(
    command: CreateInAppNotificationCommand,
    recipient: Recipient,
    devices: { token: string }[],
    push: SendPushCommand,
  ): Promise<number> {
    const notificationId = await this.notificationIdFor(
      command,
      recipient.userId,
    );
    const tokens = devices.map((device) => device.token);
    // `"3 devices"`, not a token. See the column's docblock: this is the
    // DESTINATION DESCRIPTION at send time, and for a fan-out channel that is a
    // count. A 150+ character rotating credential in a durable row would be
    // storing a secret to answer a question nobody asks.
    const target = `${tokens.length} device${tokens.length === 1 ? '' : 's'}`;

    try {
      const response = await this.messaging.sendEachForMulticast(tokens, {
        notification: { title: push.title, body: push.body },
        data: push.data,
      });

      const dead: string[] = [];
      const delivered: string[] = [];

      response.responses.forEach((result, index) => {
        // FCM's responses carry no token of their own — they are positional,
        // which is what makes the order of `tokens` load-bearing.
        const token = tokens[index];

        if (result.success) {
          delivered.push(token);

          return;
        }

        if (isDeadTokenError(result.error?.code)) dead.push(token);
      });

      await this.deviceTokens.prune(dead);
      await this.deviceTokens.markUsed(delivered);

      if (delivered.length > 0) {
        await this.deliveries.recordSent(
          notificationId,
          NotificationChannel.PUSH,
          {
            target,
            // **Null, deliberately.** FCM returns one id per token; there is no
            // single id, and picking the first would be a record pointing at one
            // arbitrary device.
            providerMessageId: null,
          },
        );

        return 1;
      }

      await this.deliveries.recordBounced(
        notificationId,
        NotificationChannel.PUSH,
        {
          target,
          error: `every device rejected (${dead.length} pruned of ${tokens.length})`,
        },
      );

      return 0;
    } catch (error) {
      // A transport error, or push being unconfigured. Recorded rather than
      // swallowed: a channel that is off has to be VISIBLY off in the table
      // people read to answer "why didn't I get notified".
      this.logger.error(
        `Could not push '${command.title}' to ${recipient.userId}: ${formatErrorMsg(error)}`,
      );

      await this.deliveries.recordFailed(
        notificationId,
        NotificationChannel.PUSH,
        {
          target,
          error: formatErrorMsg(error),
        },
      );

      return 0;
    }
  }

  private async skipPush(
    command: CreateInAppNotificationCommand,
    recipient: Recipient,
    reason: string,
  ): Promise<void> {
    await this.deliveries.recordSkipped(
      await this.notificationIdFor(command, recipient.userId),
      NotificationChannel.PUSH,
      { target: null, reason },
    );
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

/**
 * The FCM error codes that mean a token is DEAD.
 *
 * **Exactly two, and the default is KEEP.** This is the one path where the
 * system destroys a stored credential because a third party said so, and a
 * broad `catch → delete` turns an FCM outage into every user silently losing
 * push — no error, no way back except reinstalling the app.
 * `message-rate-exceeded`, `internal-error` and `server-unavailable` are
 * transient and must not delete anything; an unrecognized code is kept and the
 * send simply counts as failed.
 *
 * **Verified against a fixture, not against Firebase.** There is no client in
 * this repository and no live FCM in the test environment, so the mapping is
 * asserted at a mocked `sendEachForMulticast` boundary. Getting a code wrong in
 * the *keep* direction is harmless; wrong in the *delete* direction silently
 * unsubscribes a user, which is why the set is a literal rather than a pattern.
 */
const DEAD_TOKEN_ERRORS = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/** Whether FCM has told us this token is dead — see `DEAD_TOKEN_ERRORS`. */
function isDeadTokenError(code: string | undefined): boolean {
  return code !== undefined && DEAD_TOKEN_ERRORS.has(code);
}

/**
 * What to push for one notification, or `null` when this type gets none.
 *
 * An exhaustive `switch`, so a new `NotificationType` is a compile error rather
 * than a silent fall-through into whatever the last branch happened to be.
 * That defect shipped once already, on the email arm — `emailFor` below carries
 * the same shape for the same reason.
 */
function pushFor(
  command: CreateInAppNotificationCommand,
): SendPushCommand | null {
  // `satisfies`, so the empty-string fallbacks are checked against the payload
  // type rather than widened to `string` by inference — which is what let a
  // `resourceType` of any string compile.
  const data = {
    notificationType: command.type,
    resourceType: command.resourceType ?? '',
    resourceId: command.resourceId ?? '',
    actionUrl: command.actionUrl ?? '',
  } satisfies SendPushCommand['data'];

  switch (command.type) {
    // Everything a phone should buzz for: the alerts, the money, and the work
    // assigned to a person.
    case NOTIFICATION_TYPES.quotaThreshold:
    case NOTIFICATION_TYPES.limitThreshold:
    case NOTIFICATION_TYPES.paymentFailed:
    case NOTIFICATION_TYPES.ticketAssigned:
    case NOTIFICATION_TYPES.ticketReassigned:
    case NOTIFICATION_TYPES.ticketEscalated:
    // `webhookEndpointDisabled` is published at HIGH by the delivery arm
    // itself: an integration outage is the kind of thing a tenant admin wants
    // on a lock screen, because the events it was receiving have already
    // stopped.
    case NOTIFICATION_TYPES.webhookEndpointDisabled: // eslint-disable-line no-fallthrough
      return { title: command.title, body: command.body, data };

    // Published below the gate today, so unreachable from here — listed so the
    // switch stays exhaustive and a new type has to be considered rather than
    // inheriting a default.
    case NOTIFICATION_TYPES.planChanged:
    case NOTIFICATION_TYPES.ticketMessageCreated:
    case NOTIFICATION_TYPES.ticketStatusChanged:
      return null;
  }
}

/**
 * The quiet-hours window for a recipient, or `undefined` when they set none.
 *
 * `undefined` rather than an object of nulls: the resolver treats an absent
 * window as "no quiet hours", and handing it `{ start: null, end: null }` would
 * make every recipient look like they had configured something.
 */
function quietHoursOf(recipient: Recipient) {
  if (!recipient.quietHoursStart || !recipient.quietHoursEnd) return undefined;

  return {
    quietHoursStart: recipient.quietHoursStart,
    quietHoursEnd: recipient.quietHoursEnd,
    timezone: recipient.timezone,
  };
}

/**
 * The email a notification becomes, or `null` when it becomes none.
 *
 * **This used to be a hardcoded `QUOTA_ALERT`, and that was CORRECT when it was
 * written**: `quota-alert.service.ts` was the only producer of a `CRITICAL`
 * command, so the template genuinely was always that one. It stopped being true
 * the moment a second and third CRITICAL producer arrived, and nothing said so —
 * a dunning notice rendered under a budget-alert subject with its retry date
 * dropped, and no test could see it because the renderers were driven directly.
 *
 * So the shape here is the point: an **exhaustive switch**, so adding a
 * `NotificationType` is a compile error until somebody decides what it emails.
 * Six of the nine types answer `null`, and that is the honest answer rather than
 * a gap — the five ticket events and `plan.changed` are all published below
 * `CRITICAL` and never reach this code, and inventing a template for them to
 * satisfy a total `Record` would be worse than the bug this replaces.
 */
function emailFor(
  command: CreateInAppNotificationCommand,
  recipient: { email: string; fullName: string },
): SendEmailCommand | null {
  switch (command.type) {
    case NOTIFICATION_TYPES.quotaThreshold:
      return {
        template: EmailTemplateName.QUOTA_ALERT,
        to: recipient.email,
        data: {
          fullName: recipient.fullName,
          headline: command.title,
          // The BODY, not a rewrite of it. The producer wrote the sentence that
          // says what happens next; paraphrasing here would mean two places
          // deciding what the warning means.
          detail: command.body,
        },
      };

    case NOTIFICATION_TYPES.limitThreshold:
      return {
        template: EmailTemplateName.LIMIT_ALERT,
        to: recipient.email,
        data: {
          fullName: recipient.fullName,
          headline: command.title,
          detail: command.body,
        },
      };

    case NOTIFICATION_TYPES.paymentFailed:
      return {
        template: EmailTemplateName.PAYMENT_FAILED,
        to: recipient.email,
        data: {
          fullName: recipient.fullName,
          // **Read from `data`, not re-derived from the body.** The producer
          // already decided whether there is a retry; parsing its sentence back
          // out would be a second place deciding what the message means, and
          // the final-attempt wording is the whole reason this template exists.
          nextAttempt: asString(command.data?.nextAttempt),
          reason: asString(command.data?.reason) ?? 'No reason given',
        },
      };

    // Below `CRITICAL` and therefore unreachable from `fanOutEmail` — listed so
    // the switch stays exhaustive and a new type has to be considered here.
    //
    // `webhookEndpointDisabled` is published at HIGH: push and in-app, no
    // email, matching the other operational notices.
    case NOTIFICATION_TYPES.webhookEndpointDisabled:
    case NOTIFICATION_TYPES.planChanged:
    case NOTIFICATION_TYPES.ticketAssigned:
    case NOTIFICATION_TYPES.ticketReassigned:
    case NOTIFICATION_TYPES.ticketEscalated:
    case NOTIFICATION_TYPES.ticketMessageCreated:
    case NOTIFICATION_TYPES.ticketStatusChanged:
      return null;
  }
}

/** `data` is `Record<string, unknown>`, so every read out of it is narrowed. */
function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
