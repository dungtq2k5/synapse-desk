import type {
  EmailReceivedEvent,
  GetReceivingEmailResponseSuccess,
} from 'resend';
import { extractEmailAddress, extractEmailDomain } from '@synapsedesk/common';
import type { InboundEmailDto } from './dto/rest/inbound-email.dto';

/** An {@link InboundEmailDto}'s fields as a plain object, before validation. */
export type InboundEmailFields = {
  [K in keyof InboundEmailDto]: InboundEmailDto[K];
};

/** What the mapper produced, plus what the caller logs about it. */
export type MappedInboundEmail = {
  fields: InboundEmailFields;
  /** How many `received_for` entries were on the inbound domain; the first wins. */
  tenantRecipientCount: number;
};

/** The two loop-guard headers — the only headers forwarded into the DTO. */
const LOOP_HEADERS = ['auto-submitted', 'precedence'] as const;

/** What a nameless attachment is called in the ticket's dropped-files note. */
export const UNNAMED_ATTACHMENT = '(unnamed)';

/**
 * Builds the inbound mail `accept()` takes from Resend's two objects: the
 * verified `email.received` event and the `emails.receiving.get` response.
 *
 * - **`to`** is the first `received_for` entry on `inboundDomain` — the envelope
 *   recipients, so a mail that reached the tenant address by BCC or through a
 *   list still routes, where the `To:` header would name somebody else. None on
 *   the domain yields `''`, which `parseInboundAddress` refuses, so the mail is
 *   `UNROUTABLE` rather than routed by a local part on a foreign domain.
 * - **`from`** is the bare address and **`fromName`** the display name before
 *   `<…>`, because Resend reports `Name <addr>` and the DTO's `@IsEmail()`
 *   refuses that form.
 * - **`messageId`** is `message_id` as given; empty becomes absent, so the DTO's
 *   own synthesis applies.
 * - **`inReplyTo`**, **`references`** (split on whitespace) and **`date`** come
 *   from the headers, read case-insensitively; a missing header is absent.
 * - **`headers`** carries only `auto-submitted` and `precedence`: a full copy
 *   is unbounded sender-controlled data with one use.
 * - **`attachments`** is empty and every attachment's filename goes to
 *   `droppedAttachments` — inbound attachments are not stored in this release.
 *
 * Pure: no I/O, and the output is NOT validated here — the caller validates it
 * with the `ValidationPipe`'s options, because nothing else will.
 *
 * @example toMappedInboundEmail(event, email, 'inbound.synapsedesk.com').fields.to // 'support+k3x9…@inbound.synapsedesk.com'
 */
export function toMappedInboundEmail(
  event: EmailReceivedEvent,
  email: GetReceivingEmailResponseSuccess,
  inboundDomain: string,
): MappedInboundEmail {
  const domain = inboundDomain.toLowerCase();
  const recipients = (email.received_for ?? event.data.received_for ?? [])
    .map(extractEmailAddress)
    .filter((address) => extractEmailDomain(address) === domain);

  const header = headerReader(email.headers);
  const loopHeaders = Object.fromEntries(
    LOOP_HEADERS.flatMap((name) => {
      const value = header(name);
      return value === undefined ? [] : [[name, value]];
    }),
  );
  const references = header('references')?.split(/\s+/).filter(Boolean);
  const fromName = displayNameOf(email.from);

  return {
    tenantRecipientCount: recipients.length,
    fields: {
      to: recipients[0] ?? '',
      from: extractEmailAddress(email.from),
      ...(fromName ? { fromName } : {}),
      subject: email.subject ?? '',
      text: email.text ?? null,
      html: email.html ?? null,
      ...(email.message_id ? { messageId: email.message_id } : {}),
      ...optional('inReplyTo', header('in-reply-to')),
      references: references ?? [],
      ...optional('date', header('date')),
      ...(Object.keys(loopHeaders).length > 0 ? { headers: loopHeaders } : {}),
      attachments: [],
      droppedAttachments: (email.attachments ?? []).map(
        (attachment) => attachment.filename ?? UNNAMED_ATTACHMENT,
      ),
      receivedAt: event.created_at,
    },
  };
}

/** A case-insensitive, trimmed lookup over Resend's header record. */
function headerReader(
  headers: Record<string, string> | null,
): (name: string) => string | undefined {
  const byName = new Map(
    Object.entries(headers ?? {}).map(([name, value]) => [
      name.toLowerCase(),
      String(value).trim(),
    ]),
  );

  return (name) => byName.get(name) || undefined;
}

/**
 * The display name of a `From` value, or `undefined`.
 *
 * @example displayNameOf('"A Customer" <a@acme.test>') // 'A Customer'
 */
function displayNameOf(from: string): string | undefined {
  const angle = from.indexOf('<');
  if (angle <= 0) return undefined;

  const name = from
    .slice(0, angle)
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .trim();

  return name || undefined;
}

function optional<K extends string>(
  key: K,
  value: string | undefined,
): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}
