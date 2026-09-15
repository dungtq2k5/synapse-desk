import type {
  EmailReceivedEvent,
  GetReceivingEmailResponseSuccess,
} from 'resend';
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_FILE_NAME_LENGTH,
  extractEmailAddress,
  extractEmailDomain,
  type AllowedAttachmentMimeType,
} from '@synapsedesk/common';
import { MAX_PRESENTED_ATTACHMENTS } from '../../common/config/dto.config';
import type {
  InboundEmailDto,
  InboundRemoteAttachmentDto,
} from './dto/rest/inbound-email.dto';

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

/** The ellipsis a name over `MAX_ATTACHMENT_FILE_NAME_LENGTH` ends with in the note. */
const TRUNCATION_MARK = '…';

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
 * - **attachments split three ways** ({@link splitAttachments}): eligible ones
 *   go to `remoteAttachments` (still without a URL — that is fetched after
 *   routing), everything else is named in `droppedAttachments`, and
 *   `attachments` (object paths) stays empty.
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
      ...splitAttachments(email.attachments ?? []),
      receivedAt: event.created_at,
    },
  };
}

/**
 * Resend's attachments, split into the ones worth fetching and the names of the
 * rest.
 *
 * **Every check here mirrors a rule on `InboundRemoteAttachmentDto`**, and runs
 * first because a nested DTO failure is mail-fatal: the handler answers any
 * validation failure by dropping the WHOLE mail. So an attachment that would
 * fail a rule is named as dropped instead, and the DTO's rules stay a backstop.
 *
 * | Dropped when | Why |
 * | :--- | :--- |
 * | `inline` with a `content_id` | part of the HTML body, not a file the sender attached |
 * | its type, parameters stripped, is not in `ALLOWED_ATTACHMENT_MIME_TYPES` | platform policy, decided once at the edge |
 * | `size` below 1 | nothing to store |
 * | its name exceeds `MAX_ATTACHMENT_FILE_NAME_LENGTH` | the column's bound; the note truncates it |
 * | it comes after the first `MAX_PRESENTED_ATTACHMENTS` eligible ones | a list that long is a payload, not a mail |
 *
 * @example splitAttachments([{ id: 'a', filename: 'x.png', content_type: 'image/png; name="x.png"', size: 9, … }]).remoteAttachments // [{ id: 'a', fileName: 'x.png', mimeType: 'image/png', sizeBytes: 9 }]
 */
export function splitAttachments(
  attachments: GetReceivingEmailResponseSuccess['attachments'],
): Pick<InboundEmailFields, 'remoteAttachments' | 'droppedAttachments'> {
  const remoteAttachments: InboundRemoteAttachmentDto[] = [];
  const droppedAttachments: string[] = [];

  for (const attachment of attachments) {
    const fileName = attachment.filename || UNNAMED_ATTACHMENT;
    const mimeType = normalizeMimeType(attachment.content_type);
    const eligible =
      !(attachment.content_disposition === 'inline' && attachment.content_id) &&
      isAllowedAttachmentType(mimeType) &&
      attachment.size >= 1 &&
      fileName.length <= MAX_ATTACHMENT_FILE_NAME_LENGTH &&
      remoteAttachments.length < MAX_PRESENTED_ATTACHMENTS;

    if (eligible) {
      remoteAttachments.push({
        id: attachment.id,
        fileName,
        mimeType,
        sizeBytes: attachment.size,
      });
    } else {
      droppedAttachments.push(truncatedName(fileName));
    }
  }

  return { remoteAttachments, droppedAttachments };
}

/** `Image/PNG; name="a.png"` → `image/png` — what the allowlist and the sniffer compare. */
function normalizeMimeType(contentType: string | null): string {
  return (contentType ?? '').split(';')[0].trim().toLowerCase();
}

function isAllowedAttachmentType(
  mimeType: string,
): mimeType is AllowedAttachmentMimeType {
  return (ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(
    mimeType,
  );
}

/** A name that fits the note's column, ending in `…` when it was cut. */
function truncatedName(fileName: string): string {
  return fileName.length <= MAX_ATTACHMENT_FILE_NAME_LENGTH
    ? fileName
    : `${fileName.slice(0, MAX_ATTACHMENT_FILE_NAME_LENGTH - TRUNCATION_MARK.length)}${TRUNCATION_MARK}`;
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
