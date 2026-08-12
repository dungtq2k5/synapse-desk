/**
 * The NATS contract between any service and notification-service (Domain E).
 *
 * Shared as TYPES rather than left to convention because NATS is untyped on the
 * wire: a publisher that renames a field or a subject fails silently — the
 * message is delivered, the consumer reads `undefined`, and the email goes out
 * with "Hello undefined". Both ends importing these declarations turns that into
 * a compile error.
 *
 * Per the api-endpoints-plan: gRPC for synchronous cross-service reads,
 * NATS for background side effects. Sending mail is the archetypal side effect —
 * the caller must not wait for an SMTP round trip, and a mail outage must not
 * fail a registration.
 */

import type { InboundRejectionReason } from './inbound-email.contract';

/**
 * Subjects. `emit` (fire-and-forget) rather than `send` (request/response) —
 * see EMAIL/SMS commands below; nothing awaits a reply.
 */
export const NOTIFICATION_PATTERNS = {
  sendEmail: 'notification.email.send',
  sendSms: 'notification.sms.send',
} as const;

/** Which template to render. The value doubles as the discriminant. */
export enum EmailTemplateName {
  WELCOME = 'WELCOME',
  /**
   * The one-time reply to mail this system refused — 31-doc §3, §7.
   *
   * **A drop has to be visible to the SENDER, not only in a log.** Someone
   * emailed a support address and heard nothing; without this they conclude the
   * product is broken, and the silence is indistinguishable from mail being
   * lost. Rate-limited to one per address per day, because the thing most
   * likely to be on the other end of a refused address is an auto-responder.
   */
  INBOUND_REJECTED = 'INBOUND_REJECTED',
  EMAIL_VERIFICATION = 'EMAIL_VERIFICATION',
  PASSWORD_RESET = 'PASSWORD_RESET',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  INVITATION = 'INVITATION',
  SECURITY_ALERT = 'SECURITY_ALERT',
  /**
   * A budget threshold crossing — 16-doc §1.
   *
   * Its own template rather than reusing SECURITY_ALERT, because the two say
   * genuinely different things: a security alert asks "was this you?", and this
   * one says "here is what happens at 100%". Reusing the security shape would
   * put a quota warning under a heading that trains people to ignore it.
   */
  QUOTA_ALERT = 'QUOTA_ALERT',
}

export enum SmsTemplateName {
  PHONE_VERIFICATION = 'PHONE_VERIFICATION',
}

/**
 * Where a request came from, quoted back to the user in security mail
 * ("this request came from Chrome on macOS, 203.0.113.7") so an unexpected
 * message is actionable rather than merely alarming.
 */
export type NotificationOrigin = {
  ip: string;
  userAgent: string;
};

/**
 * A discriminated union rather than `{ template: string; data: object }`.
 *
 * Each template needs a different set of variables, and a shared bag would let
 * a publisher omit `resetUrl` from a PASSWORD_RESET without any complaint until
 * the email arrived with a dead link.
 */
export type SendEmailCommand =
  | {
      template: EmailTemplateName.INBOUND_REJECTED;
      to: string;
      data: {
        /** Why it was refused, in words a sender can act on. */
        reason: InboundRejectionReason;
        /** Where they should go instead. */
        portalUrl: string;
        organizationName: string | null;
      };
    }
  | {
      template: EmailTemplateName.WELCOME;
      to: string;
      data: {
        fullName: string;
        organizationName: string | null;
        origin: NotificationOrigin;
      };
    }
  | {
      template: EmailTemplateName.EMAIL_VERIFICATION;
      to: string;
      data: {
        fullName: string;
        code: string;
        expiresInMinutes: number;
      };
    }
  | {
      template: EmailTemplateName.PASSWORD_RESET;
      to: string;
      data: {
        fullName: string;
        /**
         * One labelled link per tenant that holds this address.
         *
         * An array rather than a single `resetUrl` because an address may now
         * own accounts in several tenants, and two near-identical emails are
         * indistinguishable to the recipient. Single-tenant users get a
         * one-element array, so the template renders as it always did.
         */
        links: { organizationName: string; url: string }[];
        expiresInMinutes: number;
        origin: NotificationOrigin;
      };
    }
  | {
      template: EmailTemplateName.PASSWORD_CHANGED;
      to: string;
      data: {
        fullName: string;
        revokedSessionCount: number;
        origin: NotificationOrigin;
      };
    }
  | {
      template: EmailTemplateName.INVITATION;
      to: string;
      data: {
        organizationName: string;
        /**
         * Load-bearing: an invitation from an unfamiliar domain is
         * indistinguishable from phishing without a name the recipient
         * recognizes. Highest-leverage field in the message.
         */
        inviterName: string;
        roleNames: string[];
        acceptUrl: string;
        expiresAt: string;
        origin: NotificationOrigin;
      };
    }
  | {
      template: EmailTemplateName.SECURITY_ALERT;
      to: string;
      data: {
        fullName: string;
        headline: string;
        detail: string;
        origin: NotificationOrigin;
      };
    }
  | {
      template: EmailTemplateName.QUOTA_ALERT;
      to: string;
      data: {
        fullName: string;
        /** e.g. "AI budget 80% used". */
        headline: string;
        /**
         * **States the OPERATIONAL consequence, not just the number.**
         *
         * api-endpoints-plan is explicit that the 80% message must say *"at
         * 100%, all self-service questions will route to your agents"* —
         * because at a 70-80% deflection rate, hitting the cap is a 3-5x spike
         * in agent queue volume rather than a billing footnote. A percentage
         * with no consequence beside it reads as noise.
         */
        detail: string;
      };
    };

export type SendSmsCommand = {
  template: SmsTemplateName.PHONE_VERIFICATION;
  to: string;
  data: {
    code: string;
    expiresInMinutes: number;
  };
};

// ---------------------------------------------------------------------------
// In-app notifications — Domain E's table, published to before it exists
// ---------------------------------------------------------------------------

/**
 * The subject Domain E will subscribe to for in-app notifications.
 *
 * Published to now, with nothing consuming it, for the same reason
 * `audit.record` was: the producer's obligation is real today and retrofitting
 * it across every call site once the consumer exists is far worse than emitting
 * into a subject that is currently quiet.
 */
export const IN_APP_NOTIFICATION_PATTERN =
  'notification.in_app.create' as const;

/**
 * The `type` values a notification can carry — RDM Table 23.
 *
 * Declared once and shared, because THREE things must agree on the exact
 * string: the producer writing the row, `GET /notifications?type=` filtering
 * it, and preference resolution keying `(type, channel)` on it. A typo in any
 * one of them is a preference the user sets that silences nothing.
 *
 * The values mirror the NATS subjects that cause them, so routing stays
 * producer-driven and a new event type does not need a translation table.
 */
export const NOTIFICATION_TYPES = {
  ticketAssigned: 'ticket.assigned',
  ticketReassigned: 'ticket.reassigned',
  ticketEscalated: 'ticket.escalated',
  ticketMessageCreated: 'ticket.message_created',
  ticketStatusChanged: 'ticket.status_changed',
  quotaThreshold: 'quota.threshold',
} as const;

export type NotificationType =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

/** Every type, for the preference catalogue and for validation. */
export const NOTIFICATION_TYPE_VALUES = Object.values(
  NOTIFICATION_TYPES,
) as NotificationType[];

/** The catch-all key in `notification_preferences` — RDM Table 25. */
export const PREFERENCE_WILDCARD_TYPE = '*';

export enum NotificationPriority {
  /**
   * RDM Table 23 defines four levels; only two currently MEAN anything.
   *
   * `LOW` and `HIGH` are in the enum because the table declares them and a
   * producer needs somewhere to put "this matters more than a reply" — but
   * nothing branches on them yet, so they behave as `NORMAL`. Recorded as a
   * known gap (18-doc §8) rather than quietly implied: an enum value that looks
   * like a control and is not is worse than one that is obviously unused.
   */
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  /** Bypasses quiet hours and digest batching (RDM Table 25). */
  CRITICAL = 'CRITICAL',
}

/** RDM Table 24 — the transports a notification can take. */
export enum NotificationChannel {
  IN_APP = 'IN_APP',
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  /**
   * In the enum for completeness and deliberately unimplemented (18-doc §8):
   * real webhooks need per-tenant endpoint config, signing and retry. That is a
   * feature, not a channel.
   */
  WEBHOOK = 'WEBHOOK',
}

/** The channels a USER can express a preference for — Table 25, not Table 24. */
export const PREFERENCE_CHANNELS = [
  NotificationChannel.IN_APP,
  NotificationChannel.EMAIL,
  NotificationChannel.SMS,
] as const;

/** RDM Table 24. `SENT` is not `READ`, and neither is `DELIVERED`. */
export enum DeliveryStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  /** Confirmed by the provider — needs delivery webhooks, so unused today. */
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  /** The valuable one. Always carries a `skipReason`. */
  SKIPPED = 'SKIPPED',
  BOUNCED = 'BOUNCED',
}

/**
 * Why a delivery did not happen — RDM Table 24.
 *
 * An enum rather than free text because these are ANSWERS to a support
 * question: *"why didn't I get an email?"* is answered by reading one of these
 * back, and a free-text field would accumulate five spellings of the same
 * reason within a month.
 */
export enum DeliverySkipReason {
  USER_PREFERENCE = 'user_preference',
  QUIET_HOURS = 'quiet_hours',
  UNVERIFIED_ADDRESS = 'unverified_address',
  ALREADY_SEEN_IN_APP = 'already_seen_in_app',
  RATE_LIMITED = 'rate_limited',
}

/** RDM Table 25 — batching mode. Only `IMMEDIATE` and `OFF` act today. */
export enum DigestMode {
  IMMEDIATE = 'IMMEDIATE',
  /** Read by the resolver; the SCHEDULER is deferred (18-doc §8). */
  HOURLY = 'HOURLY',
  DAILY = 'DAILY',
  OFF = 'OFF',
}

/**
 * WHERE a resolved preference came from — 18-doc §4.
 *
 * Named here rather than left as an inline union on `ResolvedPreference`
 * because it crosses the wire, and a value that crosses the wire needs one
 * spelling both sides agree on. The UI renders `DEFAULT` and `WILDCARD` as
 * "inherited"; a settings screen that showed them as chosen would be one the
 * user cannot reason about.
 *
 * Lowercase values, matching the strings already stored and sent.
 */
export enum PreferenceSource {
  /** A row for this exact (type, channel). */
  EXPLICIT = 'explicit',
  /** A row for `'*'` on this channel — "stop emailing me about anything". */
  WILDCARD = 'wildcard',
  /** No row at all. Permissive by design: a new account receives everything. */
  DEFAULT = 'default',
}

/** What a notification is ABOUT — RDM Table 23's `resource_type`. */
export enum NotificationResourceType {
  TICKET = 'ticket',
  DOCUMENT = 'document',
  USER = 'user',
  ORGANIZATION = 'organization',
}

/**
 * Who receives a notification — 18-doc §1.3.
 *
 * **Two kinds, because addressing by permission is right for exactly one
 * producer and wrong for every other.** The quota alert genuinely does not know
 * who holds `organization.update` in a tenant, so it names the permission and
 * auth-service resolves it. A ticket event knows precisely who the assignee is,
 * and resolving `ticket.read` holders instead would tell every agent in the
 * tenant that one of them got a ticket.
 *
 * A discriminated union rather than two optional fields: with both optional, a
 * producer that sets neither compiles, and a producer that sets both leaves the
 * consumer to invent a precedence rule.
 */
export type NotificationAudience =
  /**
   * The producer does not know who. Quota alerts, and ticket ESCALATIONS.
   *
   * `departmentId` narrows it to one queue and is the part that matters most:
   * tenant-wide would page every agent in the company for one department's
   * escalation, which is the noise that trains people to ignore the badge.
   */
  | { kind: 'permission'; permission: string; departmentId?: string }
  /** The producer knows exactly who. Every ticket event. */
  | { kind: 'users'; userIds: string[] };

/**
 * A request to write one in-app notification per resolved recipient.
 *
 * `type` is the ORIGINATING event (`ticket.assigned`), never the transport
 * subject — see the field's own note.
 */
export type CreateInAppNotificationCommand = {
  organizationId: string;

  /**
   * **The originating event, and this is load-bearing** — 18-doc §1.3.
   *
   * It used to be written as `IN_APP_NOTIFICATION_PATTERN`, the transport
   * subject, which is identical on every row. Harmless with one producer and a
   * blocker with two: `GET /notifications?type=` would match everything against
   * everything, and preference resolution keys on `(type, channel)` — so a user
   * could turn EVERYTHING off or everything on, and nothing in between.
   */
  type: string;

  audience: NotificationAudience;

  /**
   * `UNIQUE (recipient_id, event_id)` in Domain E is what makes redelivery
   * harmless. The id must therefore be DERIVED from the thing that happened,
   * never generated — a uuid here would make every retry a new notification.
   */
  eventId: string;

  title: string;
  body: string;
  priority: NotificationPriority;
  occurredAt: string;

  /**
   * Who caused it. Suppressed as a recipient — an agent who assigns a ticket to
   * themselves must not be told about it (18-doc §3.1 rule 1).
   */
  actorId?: string;

  /** Deep-link payload for the SPA: `{ ticketId, ticketNumber, actorName }`. */
  data?: Record<string, unknown>;

  /** Relative SPA path — `/tickets/1042`. */
  actionUrl?: string;

  resourceType?: NotificationResourceType;
  resourceId?: string;

  /**
   * Collapse key — `ticket:{ticketId}:message`.
   *
   * When present, an UNREAD notification with the same key for the same
   * recipient is incremented rather than duplicated. Without it,
   * `ticket.message_created` produces a row per reply and the user turns
   * notifications off in week one (18-doc §3.2).
   */
  groupKey?: string;
};

// ---------------------------------------------------------------------------
// Real-time — notification-service publishes, the gateway relays
// ---------------------------------------------------------------------------

/**
 * Subjects the gateway subscribes to in order to push a notification down a
 * socket — 18-doc §6.
 *
 * notification-service owns no WebSocket, and should not: the socket server
 * lives at the gateway with the Redis adapter and the `user:{id}` rooms that
 * every other real-time event already uses. So Domain E publishes a fact and
 * the gateway decides which room it belongs in — the same shape
 * `ticket-events.consumer.ts` already has, with neither side importing the
 * other.
 *
 * **The socket is a delivery OPTIMISATION, not a channel of record.** The row
 * is written first and the emit is fire-and-forget: a disconnected user must
 * find the notification waiting on next load, not lose it. That is also why
 * there is no `WEBHOOK`-style delivery row for the socket — the in-app row IS
 * that record.
 */
export const NOTIFICATION_REALTIME_PATTERNS = {
  /** A new row was written. */
  created: 'notification.created',
  /** An existing row was COALESCED — same group key, higher count. */
  updated: 'notification.updated',
  /** Read or archived, so a second tab can catch up. */
  read: 'notification.read',
} as const;

/** The row, as the SPA needs it — enough to render and deep-link without a fetch. */
export type NotificationRealtimePayload = {
  organizationId: string;
  recipientId: string;
  notificationId: string;
  type: string;
  priority: NotificationPriority;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  actionUrl: string | null;
  groupKey: string | null;
  groupCount: number;
  occurredAt: string;
};

/**
 * A read/archive state change, fanned to every socket the user has open.
 *
 * `read_at` is per-row rather than per-connection, so without this event two
 * open tabs disagree until one of them refreshes — and dismissing a badge on
 * mobile leaves it lit on the desktop.
 */
export type NotificationReadPayload = {
  recipientId: string;
  /** The rows affected. Empty when the change was "mark everything read". */
  notificationIds: string[];
  /** `read` or `archived` — the client renders them differently. */
  change: 'read' | 'archived';
  /** The authoritative unread total, so a client never has to compute it. */
  unreadCount: number;
};
