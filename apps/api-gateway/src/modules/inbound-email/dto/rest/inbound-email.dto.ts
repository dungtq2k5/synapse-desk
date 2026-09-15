import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  MAX_ATTACHMENT_FILE_NAME_LENGTH,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_OBJECT_PATH_LENGTH,
} from '@synapsedesk/common';
import {
  MAX_DATE_HEADER_LENGTH,
  MAX_EMAIL_ADDRESS_LENGTH,
  MAX_FULL_NAME_LENGTH,
  MAX_HEADER_LINE_LENGTH,
  MAX_MESSAGE_ID_LENGTH,
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
   * Filenames of attachments that were not stored — every one, while inbound
   * attachments are not ingested.
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
   * Attachments already in storage, as object paths.
   *
   * **Always empty from the Resend webhook today**: inbound attachments are
   * named in `droppedAttachments` rather than stored. The field stays because
   * `accept` already binds paths to a reply's message — each confirmed by
   * ticket-service as the message is written, a failure skipped and named —
   * and ingesting attachments will fill it without touching that half.
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
