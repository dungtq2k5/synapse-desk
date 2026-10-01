/**
 * @file Inbound mail, as Resend sends it.
 *
 * The two objects a delivery involves — the `email.received` EVENT the webhook
 * is called with, and the EMAIL the gateway then fetches by id — built from the
 * handful of fields a row cares about. Everything else is filled the way Resend
 * fills it, so the mapper's absent-header paths run exactly as they do in
 * production.
 *
 * Hand-built, not captured: a synthetic fixture agrees with whatever the
 * mapper does, and a recorded one can disagree. Replace these with a real
 * capture when one exists.
 */

import { randomUUID } from 'node:crypto';
import { GATEWAY_ENV } from './gateway';

/** The mail domain the catch-all route serves — the gateway's own setting. */
export const INBOUND_DOMAIN = GATEWAY_ENV.INBOUND_EMAIL_DOMAIN;

/** The key the gateway presents to Resend, so a row can assert it was the one used. */
export const RESEND_API_KEY = GATEWAY_ENV.RESEND_GATEWAY_API_KEY;

/** The address the gateway itself sends from — mail from it is a loop. */
export const OWN_ADDRESS = GATEWAY_ENV.EMAIL_SENDER;

/** A tenant token: 32 lowercase hex characters. */
export const TENANT_TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

/** `support+{token}@domain`, the address a tenant publishes. */
export const tenantAddress = (token: string = TENANT_TOKEN): string =>
  `support+${token}@${INBOUND_DOMAIN}`;

export type MailFields = {
  to?: string;
  from?: string;
  fromName?: string;
  subject?: string;
  text?: string | null;
  html?: string | null;
  messageId?: string;
  headers?: Record<string, string>;
};

/**
 * One delivery: the event to POST, the email Resend would return for its id, and
 * that id — which is the path a row programs the vendor fake with.
 */
export function resendMail(fields: MailFields = {}) {
  const emailId = randomUUID();
  const to = fields.to ?? tenantAddress();
  const address = fields.from ?? 'customer@acme.test';
  const from = fields.fromName ? `"${fields.fromName}" <${address}>` : address;
  const subject = fields.subject ?? 'The printer is on fire';
  const messageId = fields.messageId ?? `<${randomUUID()}@mail.acme.test>`;
  const createdAt = new Date().toISOString();

  return {
    emailId,
    messageId,
    event: {
      type: 'email.received',
      created_at: createdAt,
      data: {
        email_id: emailId,
        created_at: createdAt,
        from,
        to: [to],
        cc: [],
        bcc: [],
        received_for: [to],
        message_id: messageId,
        subject,
        attachments: [],
      },
    },
    email: {
      object: 'email',
      id: emailId,
      to: [to],
      from,
      created_at: createdAt,
      subject,
      bcc: null,
      cc: null,
      reply_to: null,
      received_for: [to],
      html: fields.html ?? null,
      text:
        fields.text === undefined ? 'It really is. Please help.' : fields.text,
      headers: { 'Message-ID': messageId, ...fields.headers },
      message_id: messageId,
      attachments: [],
    },
  };
}
