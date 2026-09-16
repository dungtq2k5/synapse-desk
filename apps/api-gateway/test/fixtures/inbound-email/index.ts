import { randomUUID } from 'node:crypto';
import type {
  EmailReceivedEvent,
  GetReceivingEmailResponseSuccess,
  ListAttachmentsResponseSuccess,
} from 'resend';
import { generateInboundToken } from '@synapsedesk/common';

/**
 * Inbound-mail fixtures, as the `InboundEmailDto` the webhook hands `accept()`.
 *
 * **Hand-built, not captured.** A synthetic fixture agrees with whatever the
 * mapper does; a recorded one can disagree, which is the point — replace these
 * with a real `email.received` capture when one exists. The shape is the DTO,
 * and {@link resendDelivery} turns it into the two objects Resend sends.
 */
export const INBOUND_DOMAIN = 'inbound.test';

export type InboundFixture = ReturnType<typeof plainEmail>;

export function plainEmail(overrides: Record<string, unknown> = {}) {
  return {
    messageId: '<CAF=abc123@mail.example.test>',
    to: `support+${generateInboundToken()}@${INBOUND_DOMAIN}`,
    from: 'customer@acme.test',
    fromName: 'A Customer',
    subject: 'The printer is on fire',
    text: 'It really is. Please help.',
    html: null,
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** The fields a DTO-shaped fixture may carry, as far as the inverse mapper reads them. */
type InboundFixtureFields = Record<string, unknown> & {
  to?: string;
  from?: string;
  fromName?: string;
  subject?: string;
  text?: string | null;
  html?: string | null;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  date?: string;
  headers?: Record<string, string>;
  droppedAttachments?: string[];
  /** Attachments as Resend reports them — eligible or not, the mapper decides. */
  files?: FixtureFile[];
  receivedAt?: string;
};

/** One attachment on a fixture mail, with the download URL `attachments.list` reports. */
export type FixtureFile = {
  id?: string;
  filename: string | null;
  contentType: string;
  size: number;
  disposition?: 'inline' | 'attachment';
  contentId?: string;
  downloadUrl?: string;
  /** ISO 8601; an hour from now unless the test says otherwise. */
  expiresAt?: string;
};

/**
 * The `email.received` event and the `emails.receiving.get` response that map
 * back to a DTO-shaped fixture — the inverse of `toMappedInboundEmail`.
 *
 * Lets the routing suite keep describing mail as the DTO `accept()` sees, while
 * every request goes through the real webhook: signature, fetch, mapping and
 * validation included. A field the fixture omits is omitted from Resend's
 * objects too, so the mapper's absent-header paths run.
 *
 * @example resendDelivery(plainEmail()).email.received_for // ['support+k3x9…@inbound.test']
 */
export function resendDelivery(fields: InboundFixtureFields): {
  event: EmailReceivedEvent;
  email: GetReceivingEmailResponseSuccess;
  attachmentList: ListAttachmentsResponseSuccess;
} {
  const emailId = randomUUID();
  const to = fields.to ?? '';
  const from = fields.fromName
    ? `"${fields.fromName}" <${fields.from}>`
    : String(fields.from);
  const headers: Record<string, string> = {
    ...(fields.messageId ? { 'Message-ID': fields.messageId } : {}),
    ...(fields.inReplyTo ? { 'In-Reply-To': fields.inReplyTo } : {}),
    ...(fields.references?.length
      ? { References: fields.references.join(' ') }
      : {}),
    ...(fields.date ? { Date: fields.date } : {}),
    ...fields.headers,
  };
  // A name in `droppedAttachments` becomes an attachment of a type outside the
  // allowlist, so the mapper drops it by name exactly as the fixture says.
  const resolved = [
    ...(fields.droppedAttachments ?? []).map((filename): FixtureFile => ({
      filename,
      contentType: 'application/octet-stream',
      size: 1,
    })),
    ...(fields.files ?? []),
  ].map((file) => ({
    id: file.id ?? randomUUID(),
    filename: file.filename,
    contentType: file.contentType,
    size: file.size,
    disposition: file.disposition ?? 'attachment',
    contentId: file.contentId,
    downloadUrl:
      file.downloadUrl ??
      `https://attachments.resend.test/${randomUUID()}?X-Signature=abc`,
    expiresAt:
      file.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  }));
  const attachments = resolved.map((file) => ({
    id: file.id,
    filename: file.filename,
    size: file.size,
    content_type: file.contentType,
    content_id: file.contentId ?? null,
    content_disposition: file.disposition,
  }));
  const createdAt = fields.receivedAt ?? new Date().toISOString();

  return {
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
        message_id: fields.messageId ?? '',
        subject: fields.subject ?? '',
        attachments: attachments.map((attachment) => ({
          id: attachment.id,
          filename: attachment.filename,
          content_type: attachment.content_type,
          content_disposition: attachment.content_disposition,
          content_id: attachment.content_id,
        })),
      },
    },
    email: {
      object: 'email',
      id: emailId,
      to: [to],
      from,
      created_at: createdAt,
      subject: fields.subject ?? '',
      bcc: null,
      cc: null,
      reply_to: null,
      received_for: [to],
      html: fields.html ?? null,
      text: fields.text ?? null,
      headers,
      message_id: fields.messageId ?? '',
      attachments,
    },
    attachmentList: {
      object: 'list',
      has_more: false,
      data: resolved.map((file) => ({
        id: file.id,
        filename: file.filename ?? undefined,
        size: file.size,
        content_type: file.contentType,
        content_disposition: file.disposition,
        content_id: file.contentId,
        download_url: file.downloadUrl,
        expires_at: file.expiresAt,
      })),
    },
  };
}
