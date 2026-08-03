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
  EMAIL_VERIFICATION = 'EMAIL_VERIFICATION',
  PASSWORD_RESET = 'PASSWORD_RESET',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  INVITATION = 'INVITATION',
  SECURITY_ALERT = 'SECURITY_ALERT',
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
    };

export type SendSmsCommand = {
  template: SmsTemplateName.PHONE_VERIFICATION;
  to: string;
  data: {
    code: string;
    expiresInMinutes: number;
  };
};
