import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_FILE_NAME_LENGTH,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_OBJECT_PATH_LENGTH,
  type AllowedAttachmentMimeType,
} from '@synapsedesk/common';
import {
  MAX_DATE_HEADER_LENGTH,
  MAX_EMAIL_ADDRESS_LENGTH,
  MAX_FULL_NAME_LENGTH,
  MAX_HEADER_LINE_LENGTH,
  MAX_MESSAGE_ID_LENGTH,
  MAX_PRESENTED_ATTACHMENTS,
  PRINTABLE_ASCII,
} from '../../../../common/config/dto.config';
import { IsPresentButNullable } from '../../../../common/decorators/is-nullable.decorator';

/**
 * One object already in storage, ready to bind to the message.
 *
 * Field-for-field the shape `CreateMessageRequest.attachments` takes, because
 * that is exactly where it goes. **No size and no MIME type**: both are read
 * back from the object at confirm rather than trusted from the caller — the
 * rule states, and a signed-but-attacker-influenced payload must not
 * be allowed to undo.
 */
export class InboundUploadedAttachmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_OBJECT_PATH_LENGTH)
  readonly objectPath!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(MAX_ATTACHMENT_FILE_NAME_LENGTH)
  readonly fileName!: string;
}

/**
 * One eligible attachment, still held by Resend, for storage-service to fetch.
 *
 * **No URL here.** Resend's signed `download_url` is fetched only once routing
 * has produced a ticket (`fetchAttachmentUrls`), because a mail that turns out
 * unroutable or ticket-opening drops every attachment anyway, and the list call
 * would spend the account's rate limit on it. `id` is what that fetch joins on.
 *
 * Every rule below is also checked by the mapper before the object is built:
 * a nested failure here would drop the WHOLE mail as `invalid_payload`, so
 * these are a backstop that should never fire, never the filter.
 */
export class InboundRemoteAttachmentDto {
  /** Resend's attachment id. */
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_MESSAGE_ID_LENGTH)
  readonly id!: string;

  /** `(unnamed)` for an attachment Resend reports with no filename. */
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_ATTACHMENT_FILE_NAME_LENGTH)
  readonly fileName!: string;

  /** Normalised: parameters stripped, lower-cased. */
  @IsIn([...ALLOWED_ATTACHMENT_MIME_TYPES])
  readonly mimeType!: AllowedAttachmentMimeType;

  /** What Resend CLAIMS; storage-service counts the real bytes. */
  @IsInt()
  @Min(1)
  readonly sizeBytes!: number;
}

/** A signed source for one remote attachment, fetched once routing has a ticket. */
export type RemoteAttachmentSource = { sourceUrl: string; expiresAt: Date };

/**
 * One inbound mail, as `InboundEmailService.accept` takes it.
 *
 * **Built, not received.** The Resend webhook assembles it from the verified
 * `email.received` event and the `emails.receiving.get` response
 * (`resend-inbound.mapper.ts`), so no `ValidationPipe` ever sees it —
 * `ResendInboundService` validates it explicitly with the pipe's options, and
 * every constraint below applies only because of that call.
 *
 * **Every field is bounded.** The webhook signature proves Resend sent the
 * delivery and nothing about what a stranger put in the mail — the subject, the
 * body and the sender name are all attacker-controlled text that happens to
 * arrive over a trusted channel.
 */
export class InboundEmailDto {
  /**
   * The message's own `Message-ID` header — the idempotency key.
   *
   * Optional because it is a header a sender can omit. When absent, the
   * receiving side synthesizes one from `from + subject + date`: weaker, and
   * better than a retry storm creating one ticket per attempt.
   */
  @IsOptional()
  @IsString()
  @Matches(PRINTABLE_ASCII, {
    message: 'messageId must be printable ASCII (RFC 5322 msg-id)',
  })
  @MaxLength(MAX_MESSAGE_ID_LENGTH)
  readonly messageId?: string;

  /** The address the mail was delivered to — `support+{token}@…`. */
  @IsString()
  @MaxLength(MAX_EMAIL_ADDRESS_LENGTH)
  readonly to!: string;

  /**
   * The sender's address.
   *
   * Validated as an email because everything downstream treats it as one: the
   * domain decides whether an account may be provisioned, and a
   * malformed value would make that check meaningless rather than merely ugly.
   */
  @IsEmail()
  @MaxLength(MAX_EMAIL_ADDRESS_LENGTH)
  readonly from!: string;

  /** The `From` display name, when the client sent one. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_FULL_NAME_LENGTH)
  readonly fromName?: string;

  @IsString()
  @MaxLength(MAX_HEADER_LINE_LENGTH)
  readonly subject!: string;

  /** The `text/plain` part. Null when the sender wrote HTML only. */
  @IsPresentButNullable()
  @IsString()
  readonly text!: string | null;

  /** The `text/html` part, used only when `text` is absent. */
  @IsPresentButNullable()
  @IsString()
  readonly html!: string | null;

  /** `In-Reply-To`, for the threading fallback. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_MESSAGE_ID_LENGTH)
  readonly inReplyTo?: string;

  /** `References`, oldest first — the same fallback, one hop wider. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(MAX_MESSAGE_ID_LENGTH, { each: true })
  @ApiPropertyOptional()
  readonly references: string[] = [];

  /**
   * The loop-guard headers, and only those.
   *
   * `Auto-Submitted` and `Precedence` are invisible once the body is parsed,
   * and they are what stop an auto-responder and this system replying to each
   * other forever. The mapper copies exactly these two rather than the whole
   * header block: a full copy is unbounded attacker-controlled data with one
   * use.
   */
  @IsOptional()
  @IsObject()
  readonly headers?: Record<string, string>;

  /**
   * Filenames of attachments the MAPPER already decided not to store: a type
   * outside the allowlist, an inline image, an empty file, a name too long,
   * anything past {@link MAX_PRESENTED_ATTACHMENTS}. What ingest refuses later
   * is added to the note by `accept`, not written back here.
   *
   * Carried so the ticket can say what was omitted. *"Attachments silently
   * vanish"* is something a customer discovers before you do.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ApiPropertyOptional()
  readonly droppedAttachments: string[] = [];

  /**
   * Eligible attachments still held by Resend, ingested by `accept` once
   * routing has produced a ticket.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PRESENTED_ATTACHMENTS)
  @ValidateNested({ each: true })
  @Type(() => InboundRemoteAttachmentDto)
  @ApiPropertyOptional()
  readonly remoteAttachments: InboundRemoteAttachmentDto[] = [];

  /**
   * Attachments already in storage, as object paths.
   *
   * **Always empty from the Resend webhook**: the mapper never fills it.
   * `accept` ingests `remoteAttachments` into paths itself and hands those to
   * `createMessage`, each confirmed by ticket-service as the message is written,
   * a failure skipped and named.
   *
   * **Only on a reply.** A mail that opens a NEW ticket has nothing to attach
   * to: `createTicket` writes a ticket row and no message, so there is no
   * `message_attachments` parent.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ATTACHMENTS_PER_MESSAGE)
  @ValidateNested({ each: true })
  @Type(() => InboundUploadedAttachmentDto)
  @ApiPropertyOptional()
  readonly attachments: InboundUploadedAttachmentDto[] = [];

  /**
   * The message's own `Date` header, verbatim.
   *
   * **A property of the MESSAGE, which is what makes it usable as an
   * idempotency key**. `receivedAt` below is generated fresh on
   * every delivery attempt, so a key built from it changes on each retry and
   * dedups nothing.
   *
   * Not parsed or normalised: it is hashed, and two deliveries of one message
   * carry byte-identical headers. Optional because a sender can omit it.
   */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DATE_HEADER_LENGTH)
  readonly date?: string;

  /**
   * When Resend received it, ISO 8601 — the webhook event's `created_at`.
   *
   * **Never part of the idempotency key.** It describes the delivery, not the
   * message, so it is not guaranteed stable across Resend's redeliveries —
   * which are precisely the retries the key exists to collapse.
   */
  @IsISO8601({ strict: true })
  readonly receivedAt!: string;
}
