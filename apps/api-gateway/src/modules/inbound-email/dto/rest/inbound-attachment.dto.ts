import {
  MAX_EMAIL_ADDRESS_LENGTH,
  MAX_FULL_NAME_LENGTH,
  MAX_MESSAGE_ID_LENGTH,
  MAX_PRESENTED_ATTACHMENTS,
} from '../../../../common/config/dto.config';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_FILE_NAME_LENGTH,
  type AllowedAttachmentMimeType,
} from '@synapsedesk/common';

/** One file the Worker has parsed out of a message and would like to upload. */
export class InboundAttachmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_ATTACHMENT_FILE_NAME_LENGTH)
  readonly fileName!: string;

  /**
   * **Validated against the allowlist HERE, so the Worker does not hold a copy
   * of it.** The Worker reports what the MIME part declared; this route decides
   * whether it may be stored. A second copy of the allowlist in a Cloudflare
   * Worker is a copy that drifts, and the one place it must not drift from is
   * the policy storage-service enforces at presign anyway.
   */
  @IsIn([...ALLOWED_ATTACHMENT_MIME_TYPES])
  readonly mimeType!: AllowedAttachmentMimeType;

  @IsInt()
  @Min(1)
  readonly sizeBytes!: number;
}

/**
 * What the Worker asks for BEFORE it posts the webhook
 *
 * **The routing fields are here because the ticket has to be resolved twice.**
 * The Worker cannot presign against a ticket it does not know, and it cannot
 * resolve one — the reply token's MAC, the tenant lookup and the `In-Reply-To`
 * join all live in this gateway. So it sends the same routing facts it is about
 * to send on the webhook, and `resolveRouting` answers with the same ticket
 * both times.
 *
 * **`text`, `html` and the rest are deliberately absent.** They play no part in
 * routing, and a presign request carrying a whole message body would put the
 * mail's contents through a second endpoint for no reason.
 */
export class InboundAttachmentUploadRequestDto {
  @IsString()
  @MaxLength(MAX_EMAIL_ADDRESS_LENGTH)
  readonly to!: string;

  @IsString()
  @MaxLength(MAX_EMAIL_ADDRESS_LENGTH)
  readonly from!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_FULL_NAME_LENGTH)
  readonly fromName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_MESSAGE_ID_LENGTH)
  readonly inReplyTo?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(MAX_MESSAGE_ID_LENGTH, { each: true })
  readonly references?: string[];

  @IsArray()
  @ArrayMaxSize(MAX_PRESENTED_ATTACHMENTS)
  @ValidateNested({ each: true })
  @Type(() => InboundAttachmentDto)
  readonly files!: InboundAttachmentDto[];
}

/**
 * A file the Worker may now PUT to storage.
 *
 * A RESPONSE shape, nested in {@link InboundAttachmentUploadResponseDto} — it is
 * never bound from a request body, which is why it carries no validators.
 */
export class InboundAttachmentUploadDto {
  fileName!: string;
  uploadUrl!: string;
  /** Handed back on the webhook as `attachments[].objectPath`. */
  objectPath!: string;
}

/**
 * Why one file will not be uploaded.
 *
 * **Named rather than silently omitted**, so the Worker can put it in
 * `droppedAttachments` and the ticket can still say what was left out. "My
 * attachment vanished" is something a customer discovers before you do — the
 * same rule set when attachments were dropped wholesale.
 *
 * A RESPONSE shape, like {@link InboundAttachmentUploadDto} above.
 */
export class InboundAttachmentDeclinedDto {
  fileName!: string;
  reason!: string;
}

export class InboundAttachmentUploadResponseDto {
  uploads!: InboundAttachmentUploadDto[];
  declined!: InboundAttachmentDeclinedDto[];
}
