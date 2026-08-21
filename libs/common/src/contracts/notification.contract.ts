/**
 * @file The NATS contract between any service and notification-service (Domain E).
 *
 * Import these on both ends of a subject: NATS is untyped on the wire, so a
 * renamed field is a compile error here and a silent `undefined` without it.
 *
 * Notifications travel over NATS rather than gRPC because they are background
 * side effects — a caller never waits for an SMTP round trip.
 */

import type { InboundRejectionReason } from './inbound-email.contract';

/** Subjects for {@link SendEmailCommand} and {@link SendSmsCommand}. Use `emit`; nothing replies. */
export const NOTIFICATION_PATTERNS = {
  sendEmail: 'notification.email.send',
  sendSms: 'notification.sms.send',
} as const;

/** Which template to render. The value doubles as the discriminant. */
export enum EmailTemplateName {
  WELCOME = 'WELCOME',
  /**
   * The one-time reply to mail this system refused
   *
   * Rate-limited to one per address per day.
   */
  INBOUND_REJECTED = 'INBOUND_REJECTED',
  EMAIL_VERIFICATION = 'EMAIL_VERIFICATION',
  PASSWORD_RESET = 'PASSWORD_RESET',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  INVITATION = 'INVITATION',
  SECURITY_ALERT = 'SECURITY_ALERT',
  /** A budget threshold crossing. */
  QUOTA_ALERT = 'QUOTA_ALERT',
}

export enum SmsTemplateName {
  PHONE_VERIFICATION = 'PHONE_VERIFICATION',
}

/**
 * Where a request came from, quoted back in security mail so an unexpected
 * message is actionable — "Chrome on macOS, 203.0.113.7".
 */
export type NotificationOrigin = {
  ip: string;
  userAgent: string;
};

/**
 * One email to send, discriminated by {@link EmailTemplateName}.
 *
 * The `template` picks the arm, so each template's own `data` shape is checked
 * at the publish site.
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
         * A single-tenant user gets a one-element array.
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
        /** The inviter, by name. Without it the mail reads as phishing. */
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
         * What happens next, not just the percentage — e.g. "at 100%, all
         * self-service questions will route to your agents".
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

/** The subject Domain E subscribes to for in-app notifications. */
export const IN_APP_NOTIFICATION_PATTERN =
  'notification.in_app.create' as const;

/**
 * The `type` values a notification can carry — RDM Table 23.
 *
 * The producer, `GET /notifications?type=` and preference resolution all key on
 * these exact strings. Values mirror the NATS subject that causes them.
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
export const NOTIFICATION_TYPE_VALUES: NotificationType[] =
  Object.values(NOTIFICATION_TYPES);

/** The catch-all key in `notification_preferences` — RDM Table 25. */
export const PREFERENCE_WILDCARD_TYPE = '*';

export enum NotificationPriority {
  // LOW and HIGH are declared by RDM Table 23 but nothing branches on them yet
  // — both behave as NORMAL. Known gap
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
  // Declared but unimplemented.
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

/** Why a delivery did not happen — RDM Table 24. Read back to answer "why didn't I get an email?". */
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
  /** Read by the resolver; the SCHEDULER is deferred. */
  HOURLY = 'HOURLY',
  DAILY = 'DAILY',
  OFF = 'OFF',
}

/**
 * Where a resolved preference came from.
 *
 * The UI renders `DEFAULT` and `WILDCARD` as "inherited" rather than as a
 * choice the user made. Values are lower-case, matching what is stored.
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
 * Who receives a notification.
 *
 * Use `users` whenever the producer knows the recipients; `permission` only
 * when it genuinely cannot, since resolving a permission reaches everyone who
 * holds it.
 */
export type NotificationAudience =
  /**
   * Resolved by auth-service. Quota alerts, and ticket escalations.
   *
   * Set `departmentId` to narrow it to one queue — without it, every holder in
   * the tenant is notified.
   */
  | { kind: 'permission'; permission: string; departmentId?: string }
  /** The producer knows exactly who. Every ticket event. */
  | { kind: 'users'; userIds: string[] };

/** A request to write one in-app notification per resolved recipient. */
export type CreateInAppNotificationCommand = {
  organizationId: string;

  /**
   * The originating event — `ticket.assigned`, one of {@link NOTIFICATION_TYPES}.
   *
   * Never the transport subject: `?type=` filtering and preference resolution
   * both key on this, and a constant value makes both useless.
   */
  type: string;

  audience: NotificationAudience;

  /**
   * Idempotency key, unique per `(recipient_id, event_id)` in Domain E.
   *
   * Derive it from the event; a generated uuid makes every redelivery a new
   * notification.
   */
  eventId: string;

  title: string;
  body: string;
  priority: NotificationPriority;
  occurredAt: string;

  /** Who caused it. Excluded from the recipients. */
  actorId?: string;

  /** Deep-link payload for the SPA: `{ ticketId, ticketNumber, actorName }`. */
  data?: Record<string, unknown>;

  /** Relative SPA path — `/tickets/1042`. */
  actionUrl?: string;

  resourceType?: NotificationResourceType;
  resourceId?: string;

  /**
   * Collapse key — e.g. `ticket:{ticketId}:message`.
   *
   * An unread notification with the same key for the same recipient is
   * incremented rather than duplicated.
   */
  groupKey?: string;
};

// ---------------------------------------------------------------------------
// Real-time — notification-service publishes, the gateway relays
// ---------------------------------------------------------------------------

/**
 * Subjects the gateway subscribes to in order to push a notification down a
 * socket.
 *
 * The socket is a delivery optimisation, not a channel of record: write the row
 * first and emit fire-and-forget, so a disconnected user still finds the
 * notification on next load.
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

/** A read/archive state change, fanned to every socket the user has open. */
export type NotificationReadPayload = {
  recipientId: string;
  /** The rows affected. Empty when the change was "mark everything read". */
  notificationIds: string[];
  /** `read` or `archived` — the client renders them differently. */
  change: 'read' | 'archived';
  /** The authoritative unread total, so a client never has to compute it. */
  unreadCount: number;
};
