import { MARKDOWN_FIELD_CONTRACT } from '../../../../common/config/markdown-contract.config';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_FILE_NAME_LENGTH,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_MESSAGE_CONTENT_LENGTH,
  MAX_OBJECT_PATH_LENGTH,
  trimIfString,
  type AllowedAttachmentMimeType,
} from '@synapsedesk/common';
import { SearchPaginationDto } from '../../../../common/dto/rest/search-pagination.dto';
import { ToBoolean } from '../../../../common/decorators/to-boolean.decorator';

export class ListMessagesQueryDto extends SearchPaginationDto {}

export class CreateMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_MESSAGE_CONTENT_LENGTH)
  @Transform(trimIfString)
  @ApiProperty({ description: MARKDOWN_FIELD_CONTRACT })
  readonly content!: string;

  /**
   * Agent-only, enforced in ticket-service rather than by a route permission:
   * the route itself must stay open to end users, who post ordinary replies
   * through it.
   */
  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  @ApiPropertyOptional()
  readonly isInternalNote: boolean = false;

  /**
   * Ask for an AI draft after this message lands.
   *
   * Two writes, never one: the draft can fail without losing what the human
   * typed. Today it always fails — `rag-service` does not exist — and the
   * caller's own message still commits, which is exactly the behaviour that
   * has to survive Domain C shipping.
   */
  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  @ApiPropertyOptional()
  readonly invokeAi: boolean = false;

  /**
   * Objects already uploaded, bound to this message as it is created
   *
   *
   * **This is the ordering that makes a first-turn attachment readable.**
   * Presign then confirm-against-a-message meant the row could only exist after
   * the message did, while `invokeAi` runs during the create — so the very
   * screenshot the question was about arrived a moment too late to be seen.
   *
   * A path that fails its confirm comes back in `skippedAttachments` and the
   * message is still created, and that is why that is the only safe outcome.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ATTACHMENTS_PER_MESSAGE)
  @ValidateNested({ each: true })
  @Type(() => NewAttachmentDto)
  @ApiPropertyOptional()
  readonly attachments: NewAttachmentDto[] = [];

  /**
   * The `ai_generations` row this reply came from — `AiDraftResponseDto`'s
   * `generationId`, handed back.
   *
   * Send it when posting an AI-drafted reply so the draft is recorded ACCEPTED
   * or EDITED rather than DISCARDED. Absent for an ordinary reply.
   */
  @IsOptional()
  @IsUUID()
  readonly generatedFromId?: string;
}

/**
 * One uploaded object, waiting to be bound.
 *
 * **No size and no MIME type**, deliberately: both are read back from the
 * object at confirm rather than taken from the client. Accepting them here
 * would invite a row that records whatever the caller felt like claiming — the
 * rule `confirmAttachment` already states and this must not quietly undo.
 */
export class NewAttachmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_OBJECT_PATH_LENGTH)
  @Transform(trimIfString)
  readonly objectPath!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(MAX_ATTACHMENT_FILE_NAME_LENGTH)
  @Transform(trimIfString)
  readonly fileName!: string;
}

export class UpdateMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_MESSAGE_CONTENT_LENGTH)
  @Transform(trimIfString)
  @ApiProperty({ description: MARKDOWN_FIELD_CONTRACT })
  readonly content!: string;
}

/**
 * Attachment metadata, validated HERE as the first of two layers.
 *
 * `storage-service` will check the same things against its own `PURPOSE_POLICY`
 * in storage-service. That is not redundancy for its own sake: this
 * layer rejects a 2 GB request before it costs a network hop, and that layer
 * holds regardless of which service asks — neither can be removed on the
 * grounds that the other exists.
 */
/** Step 5 of presign → upload → confirm: the client says the bytes landed. */
export class ConfirmAttachmentDto {
  /**
   * Echoed back from the presign response.
   *
   * Not shape-validated here on purpose: ticket-service passes it to
   * storage-service, which checks it against the PendingUpload it recorded — a
   * real authorization check rather than a syntactic one. A regex here would
   * only reject well-formed paths that were never authorized, which is exactly
   * the case the real check catches better.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_OBJECT_PATH_LENGTH)
  readonly objectPath!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(MAX_ATTACHMENT_FILE_NAME_LENGTH)
  @Transform(trimIfString)
  readonly fileName!: string;
}

export class UploadAttachmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_ATTACHMENT_FILE_NAME_LENGTH)
  @Transform(trimIfString)
  readonly fileName!: string;

  /**
   * An allowlist, never a denylist. A denylist is a promise to have thought of
   * every dangerous type, which is not a promise anyone can keep.
   */
  @IsIn(ALLOWED_ATTACHMENT_MIME_TYPES)
  readonly mimeType!: AllowedAttachmentMimeType;

  /**
   * Declared by the client and therefore not trustworthy on its own — the real
   * enforcement is the signed URL's own size constraint. Checking it here still
   * earns its place: it turns "upload 2 GB, then be refused" into an immediate
   * refusal, and it documents the cap in the API contract.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ATTACHMENT_BYTES)
  readonly fileSizeBytes!: number;
}
